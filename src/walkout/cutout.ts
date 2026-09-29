// Fichiers WebAssembly servis par l'application (le paquet ne les exporte pas : chemin relatif, copiés au build).
const wasmLoaderPath = new URL('../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', import.meta.url).href;
const wasmBinaryPath = new URL('../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', import.meta.url).href;

/**
 * Détourage automatique d'une photo en pied, dans le navigateur (MediaPipe, modèle « selfie multiclass »).
 * Deux passes : la première repère l'enfant sur toute la photo, la seconde affine le masque sur un recadrage
 * autour de lui (bien plus de détails qu'un masque de 256 px sur la photo entière).
 * Le modèle (≈ 16 Mo) est téléchargé à la première utilisation puis mis en cache par le navigateur.
 */

const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

type Segmenter = import('@mediapipe/tasks-vision').ImageSegmenter;
let segmenter: Promise<Segmenter> | null = null;

function load() {
  segmenter ??= import('@mediapipe/tasks-vision').then(({ ImageSegmenter }) =>
    ImageSegmenter.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false },
    ),
  );
  segmenter.catch(() => (segmenter = null));
  return segmenter;
}

/** Probabilité « enfant » (1 − fond) d'une image, à la résolution du modèle. */
async function personMask(src: HTMLCanvasElement) {
  const seg = await load();
  const res = seg.segment(src);
  const mask = res.confidenceMasks?.[0];
  if (!mask) {
    res.close();
    throw new Error('Détourage impossible');
  }
  const bg = mask.getAsFloat32Array();
  const out = { w: mask.width, h: mask.height, a: new Float32Array(bg.length) };
  for (let i = 0; i < bg.length; i++) out.a[i] = 1 - bg[i];
  res.close();
  return out;
}

/** Masque (w × h) → canvas de la taille voulue, lissé par le redimensionnement. */
function maskCanvas(m: { w: number; h: number; a: Float32Array }, W: number, H: number) {
  const small = document.createElement('canvas');
  small.width = m.w;
  small.height = m.h;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(m.w, m.h);
  for (let i = 0; i < m.a.length; i++) {
    img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, m.a[i])) * 255);
  }
  sctx.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = W;
  big.height = H;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, W, H);
  return big;
}

function bounds(m: { w: number; h: number; a: Float32Array }, threshold = 0.5) {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.a[y * m.w + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x0: x0 / m.w, y0: y0 / m.h, x1: (x1 + 1) / m.w, y1: (y1 + 1) / m.h };
}

/** Photo → PNG transparent recadré sur l'enfant. */
export async function cutoutPhoto(photo: HTMLCanvasElement) {
  const W = photo.width;
  const H = photo.height;
  // 1re passe : où est l'enfant ?
  const coarse = await personMask(photo);
  const b = bounds(coarse, 0.4);
  if (!b) throw new Error('Personne n’a été trouvé sur la photo');
  // 2e passe : recadrage carré autour de l'enfant (avec de la marge), pour un masque plus fin.
  const cx = ((b.x0 + b.x1) / 2) * W;
  const cy = ((b.y0 + b.y1) / 2) * H;
  const side = Math.max((b.x1 - b.x0) * W, (b.y1 - b.y0) * H) * 1.15;
  const sx = Math.round(cx - side / 2);
  const sy = Math.round(cy - side / 2);
  const crop = document.createElement('canvas');
  crop.width = crop.height = Math.round(side);
  const cctx = crop.getContext('2d')!;
  cctx.drawImage(photo, -sx, -sy);
  const fine = await personMask(crop);

  // Masque fin replacé sur la photo, contours resserrés (courbe en S) pour éviter le halo.
  const m = maskCanvas(fine, crop.width, crop.height);
  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const fctx = full.getContext('2d')!;
  fctx.drawImage(m, sx, sy);
  const data = fctx.getImageData(0, 0, W, H);
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i] / 255;
    const t = Math.min(1, Math.max(0, (a - 0.45) / 0.3));
    d[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  fctx.putImageData(data, 0, 0);
  fctx.globalCompositeOperation = 'source-in';
  fctx.drawImage(photo, 0, 0);
  return trimAlpha(full);
}

/** Recadre sur la partie non transparente (petite marge, pieds au ras du bas). */
export function trimAlpha(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y += 2)
    for (let x = 0; x < c.width; x += 2)
      if (data[(y * c.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return c;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(c.width, x1 + m);
  y1 = Math.min(c.height, y1 + 2);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d')!.drawImage(c, -x0, -y0);
  return out;
}

/** L'image a-t-elle un fond transparent ? (bords majoritairement transparents) */
export function hasTransparentEdges(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const { data } = ctx.getImageData(0, 0, w, h);
  let clear = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 60));
  for (let i = 0; i < w; i += step) {
    for (const y of [0, h - 1]) {
      n++;
      if (data[(y * w + i) * 4 + 3] < 200) clear++;
    }
  }
  for (let i = 0; i < h; i += step) {
    for (const x of [0, w - 1]) {
      n++;
      if (data[(i * w + x) * 4 + 3] < 200) clear++;
    }
  }
  return clear / n > 0.5;
}
