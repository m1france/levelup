/** Redimensionne une photo côté navigateur (orientation EXIF respectée) avant envoi. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

function render(src: CanvasImageSource & { width: number; height: number }, max: number, quality: number) {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return { data: c.toDataURL('image/jpeg', quality), w, h };
}

export async function preparePhoto(file: File) {
  const src = await decode(file);
  const full = render(src, 1800, 0.84);
  const thumb = render(src, 560, 0.78);
  return { image: full.data, thumb: thumb.data, width: full.w, height: full.h, takenAt: file.lastModified || Date.now() };
}

/** Zone non transparente d'une image, ou null si elle est entièrement opaque. */
function alphaBounds(src: CanvasImageSource & { width: number; height: number }) {
  const scale = Math.min(1, 400 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, clear = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3];
      if (a < 250) clear++;
      if (a > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  // Moins de 2 % de pixels transparents : c'est une photo classique.
  if (clear < w * h * 0.02 || x1 < 0) return null;
  return { x: x0 / scale, y: y0 / scale, w: (x1 - x0 + 1) / scale, h: (y1 - y0 + 1) / scale };
}

/**
 * Photo de joueur. Détourée (PNG transparent) : la transparence est gardée et l'image est recadrée au plus près du joueur.
 * Sinon : portrait carré, recadré au centre.
 */
export async function preparePortrait(file: File, size = 640) {
  const src = await decode(file);
  const box = alphaBounds(src);
  if (box) {
    const scale = Math.min(1, 900 / Math.max(box.w, box.h));
    const c = document.createElement('canvas');
    c.width = Math.round(box.w * scale);
    c.height = Math.round(box.h * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  const side = Math.min(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Légèrement décalé vers le haut : le visage est rarement au centre exact.
  const sy = Math.max(0, (src.height - side) * 0.3);
  ctx.drawImage(src, (src.width - side) / 2, sy, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.86);
}

/** Logo de club : PNG (transparence conservée), 512 px au plus. */
export async function prepareLogo(file: File, max = 512) {
  const src = await decode(file);
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** Photo en pied (entrée sur le terrain) : 1600 px au plus, transparence conservée. */
export async function prepareFullBody(file: File, max = 1600) {
  const src = await decode(file);
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
