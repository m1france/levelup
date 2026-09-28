/**
 * Tête 3D d'un présentateur, sculptée à partir de sa photo :
 * - le visage est le maillage MediaPipe (468 points détectés sur la photo), texturé par la photo elle-même ;
 * - le crâne prolonge le contour du visage jusqu'à l'arrière de la tête (un seul maillage, sans couture) ;
 * - oreilles, cou, intérieur de la bouche et dents ; la mâchoire s'ouvre quand il parle, les paupières clignent ;
 * - coiffure procédurale : casquette (logo du club), frange, court, bouclé, long ou sans cheveux.
 * Sans photo ni points, une tête générique est sculptée.
 */
import * as THREE from 'three';
import type { Landmarks } from './faceDetect';
import { FACE_OVAL, FACE_TRIS, MOUTH_RING } from './faceTopology';
import { canvas, type Img } from './textures';

export type HairStyle = 'cap' | 'fringe' | 'short' | 'curly' | 'long' | 'bald';

export interface HeadOptions {
  photo: HTMLImageElement | null;
  landmarks: Landmarks | null;
  style: HairStyle;
  /** « auto » : prélevée sur la photo. */
  hair: string;
  capColor?: string;
  logo?: Img | null;
}

export interface Head {
  group: THREE.Group;
  skin: THREE.Color;
  /** Hauteur des yeux au-dessus du cou (m), pour cadrer les gros plans. */
  eyeHeight: number;
  setTalk(v: number): void;
  update(t: number, dt: number): void;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Petit bruit déterministe (cheveux, pores) : même tête à chaque chargement. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hash3(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
/** Bruit de valeur 3D lissé (touffes de cheveux). */
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let out = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        out += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return out;
}

/* ------------------------------------------------------------------ paupières, lèvres */

// Paupière supérieure → inférieure (œil droit, œil gauche), puis le pli au-dessus de la paupière.
const LIDS: [number, number][] = [
  [246, 7], [161, 163], [160, 144], [159, 145], [158, 153], [157, 154], [173, 155],
  [466, 249], [388, 390], [387, 373], [386, 374], [385, 380], [384, 381], [398, 382],
];
const CREASE: [number, number][] = [
  [247, 161], [30, 160], [29, 159], [27, 159], [28, 158], [56, 157], [190, 173],
  [467, 388], [260, 387], [259, 386], [257, 386], [258, 385], [286, 384], [414, 398],
];
const UPPER_LIP = [191, 80, 81, 82, 13, 312, 311, 310, 415, 185, 40, 39, 37, 0, 267, 269, 270, 409];
const EYES = [
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
];
const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const CHEEKS = [50, 280, 101, 330, 205, 425];

/* ------------------------------------------------------------------ géométrie du visage */

interface FaceFrame {
  /** Points du visage dans le repère de la tête (m) : x à gauche du sujet (droite de l'image), y en haut, z vers l'avant. */
  pts: THREE.Vector3[];
  /** Position dans la photo (px). */
  px: [number, number][];
}

/** Redresse le visage (roulis, lacet, tangage de la photo) et le met à l'échelle réelle. */
function faceFrame(lm: Landmarks, W: number, H: number): FaceFrame {
  const P = lm.slice(0, 468).map(([x, y, z]) => V(x * W, -y * H, -z * W));
  const X = P[454].clone().sub(P[234]).normalize();
  let Y = P[10].clone().sub(P[152]);
  Y = Y.sub(X.clone().multiplyScalar(Y.dot(X))).normalize();
  const Z = X.clone().cross(Y).normalize();
  const O = P[234].clone().add(P[454]).multiplyScalar(0.5);
  // Écart entre les coins externes des yeux : environ 9 cm.
  const s = 0.09 / P[33].distanceTo(P[263]);
  const pts = P.map((p) => {
    const d = p.clone().sub(O);
    return V(d.dot(X) * s, d.dot(Y) * s, d.dot(Z) * s);
  });
  return { pts, px: lm.slice(0, 468).map(([x, y]) => [x * W, y * H]) };
}

/* ------------------------------------------------------------------ textures */

interface FaceTex {
  map: THREE.CanvasTexture;
  gloss: THREE.CanvasTexture;
  uv: (i: number) => [number, number];
  skinUV: [number, number];
  skin: THREE.Color;
  hair: THREE.Color;
  cap: THREE.Color;
}

function sampleAvg(g: CanvasRenderingContext2D, x: number, y: number, r: number): [number, number, number] | null {
  const s = Math.max(2, Math.round(r));
  const X = Math.round(x - s), Y = Math.round(y - s);
  if (X < 0 || Y < 0 || X + 2 * s >= g.canvas.width || Y + 2 * s >= g.canvas.height) return null;
  const d = g.getImageData(X, Y, 2 * s, 2 * s).data;
  let r0 = 0, g0 = 0, b0 = 0;
  for (let i = 0; i < d.length; i += 4) (r0 += d[i]), (g0 += d[i + 1]), (b0 += d[i + 2]);
  const n = d.length / 4;
  return [r0 / n, g0 / n, b0 / n];
}
const css = (c: [number, number, number]) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const lum = (c: [number, number, number]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/**
 * Texture du visage : la photo recadrée autour du visage, exposition ramenée à une valeur commune,
 * contour fondu dans la couleur de peau (le crâne prend le relais sans démarcation).
 */
function faceTexture(photo: HTMLImageElement, f: FaceFrame, hairIn: string, capIn: string, style: HairStyle): FaceTex {
  const W = photo.naturalWidth || photo.width;
  const H = photo.naturalHeight || photo.height;
  const src = canvas(W, H);
  src.g.drawImage(photo, 0, 0, W, H);
  const ox = f.px.map((p) => p[0]);
  const oy = f.px.map((p) => p[1]);
  const minX = Math.min(...ox), maxX = Math.max(...ox), minY = Math.min(...oy), maxY = Math.max(...oy);
  const size = Math.max(maxX - minX, maxY - minY) * 1.12;
  const bx = (minX + maxX) / 2 - size / 2;
  const by = (minY + maxY) / 2 - size / 2;
  const faceH = maxY - minY;

  // Couleurs prélevées : peau (joues), cheveux (au-dessus du front et aux tempes), casquette.
  const cheeks = CHEEKS.map((i) => sampleAvg(src.g, f.px[i][0], f.px[i][1], faceH * 0.025)).filter(Boolean) as [number, number, number][];
  const skinRGB: [number, number, number] = cheeks.length
    ? [0, 1, 2].map((k) => cheeks.reduce((a, c) => a + c[k], 0) / cheeks.length) as [number, number, number]
    : [225, 180, 150];
  // Exposition : la peau est ramenée vers une luminance commune (photos au flash, en plein soleil…).
  const gain = Math.max(0.8, Math.min(1.9, 0.56 / Math.max(0.05, lum(skinRGB))));
  const up = (i: number, k: number) => [f.px[i][0], f.px[i][1] - faceH * k] as const;
  const [hx, hy] = up(10, 0.1);
  const aboveHead = sampleAvg(src.g, hx, hy, faceH * 0.05);
  const temples = [127, 356].map((i) => {
    const dir = i === 127 ? -1 : 1;
    return sampleAvg(src.g, f.px[i][0] + dir * faceH * 0.06, f.px[i][1] - faceH * 0.08, faceH * 0.03);
  }).filter(Boolean) as [number, number, number][];
  const adjust = (c: [number, number, number]) => c.map((v) => Math.min(255, v * gain)) as [number, number, number];
  const auto = (v: string, c: [number, number, number] | null | undefined, def: string) => (v && v !== 'auto' ? v : c ? css(adjust(c)) : def);
  // Sous une casquette, les cheveux se voient aux tempes ; sinon au-dessus du front.
  const hairSample = style === 'cap' ? temples.sort((p, q) => lum(p) - lum(q))[0] : aboveHead;
  const hairCss = auto(hairIn, hairSample && lum(hairSample) < 0.5 ? hairSample : null, '#3a2718');
  const capCss = auto(capIn, aboveHead, '#2a2220');
  const skinCss = css(adjust(skinRGB));

  const S = 1024;
  const k = S / size;
  const { c, g } = canvas(S, S);
  g.fillStyle = skinCss;
  g.fillRect(0, 0, S, S);
  // Photo à l'intérieur du contour (rétréci et flouté), peau autour.
  const photoLayer = canvas(S, S);
  photoLayer.g.filter = `brightness(${gain.toFixed(3)}) saturate(0.92)`;
  photoLayer.g.drawImage(src.c, bx, by, size, size, 0, 0, S, S);
  photoLayer.g.filter = 'none';
  const mask = canvas(S, S);
  const cx = ((minX + maxX) / 2 - bx) * k;
  const cy = ((minY + maxY) / 2 - by) * k;
  mask.g.filter = `blur(${Math.round(faceH * k * 0.035)}px)`;
  mask.g.beginPath();
  FACE_OVAL.forEach((i, n) => {
    const x = cx + ((f.px[i][0] - bx) * k - cx) * 0.93;
    const y = cy + ((f.px[i][1] - by) * k - cy) * 0.95;
    if (n) mask.g.lineTo(x, y);
    else mask.g.moveTo(x, y);
  });
  mask.g.closePath();
  mask.g.fillStyle = '#fff';
  mask.g.fill();
  // Couleur de peau : moyenne juste à l'intérieur du contour (là où le visage rejoint le crâne), sur la photo corrigée.
  const ring = FACE_OVAL.map((i) => {
    const x = cx + ((f.px[i][0] - bx) * k - cx) * 0.8;
    const y = cy + ((f.px[i][1] - by) * k - cy) * 0.8;
    return sampleAvg(photoLayer.g, x, y, S * 0.012);
  }).filter((v): v is [number, number, number] => !!v && lum(v) > 0.12);
  // Les 25 % les plus sombres (cheveux, ombres) et les plus clairs (reflets) sont écartés.
  const sorted = ring.sort((p, q) => lum(p) - lum(q)).slice(Math.floor(ring.length * 0.25), Math.ceil(ring.length * 0.75));
  const edgeSkin = sorted.length ? css([0, 1, 2].map((ch) => sorted.reduce((acc, v) => acc + v[ch], 0) / sorted.length) as [number, number, number]) : skinCss;
  photoLayer.g.globalCompositeOperation = 'destination-in';
  photoLayer.g.drawImage(mask.c, 0, 0);
  g.fillStyle = edgeSkin;
  g.fillRect(0, 0, S, S);
  // Les couleurs du bord du visage « bavent » vers l'extérieur avant de rejoindre la peau unie : pas de démarcation.
  for (const r of [60, 28, 12]) {
    g.filter = `blur(${r}px)`;
    g.drawImage(photoLayer.c, 0, 0);
  }
  g.filter = 'none';
  g.drawImage(photoLayer.c, 0, 0);
  // Coin réservé : peau unie pour le crâne, les oreilles et le cou.
  g.fillStyle = edgeSkin;
  g.fillRect(0, S - 24, 24, 24);

  // Brillance : yeux (cornée humide) et lèvres.
  const gl = canvas(512, 512);
  gl.g.fillStyle = '#000';
  gl.g.fillRect(0, 0, 512, 512);
  const poly = (ids: number[], fill: string) => {
    gl.g.beginPath();
    ids.forEach((i, n) => {
      const x = ((f.px[i][0] - bx) * k) / 2;
      const y = ((f.px[i][1] - by) * k) / 2;
      if (n) gl.g.lineTo(x, y);
      else gl.g.moveTo(x, y);
    });
    gl.g.closePath();
    gl.g.fillStyle = fill;
    gl.g.fill();
  };
  gl.g.filter = 'blur(2px)';
  EYES.forEach((e) => poly(e, '#fff'));
  poly(LIPS_OUTER, '#777');
  const gloss = new THREE.CanvasTexture(gl.c);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return {
    map,
    gloss,
    uv: (i) => [((f.px[i][0] - bx) * k) / S, 1 - ((f.px[i][1] - by) * k) / S],
    skinUV: [12 / S, 12 / S],
    skin: new THREE.Color(edgeSkin),
    hair: new THREE.Color(hairCss),
    cap: new THREE.Color(capCss),
  };
}

/** Micro-relief de peau (pores), en carte de normales. */
let poresTex: THREE.Texture | null = null;
function pores() {
  if (poresTex) return poresTex;
  const N = 256;
  const { c, g } = canvas(N, N);
  const img = g.createImageData(N, N);
  const h = new Float32Array(N * N);
  const r = rng(7);
  for (let i = 0; i < N * N; i++) h[i] = r();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const at = (xx: number, yy: number) => h[((yy + N) % N) * N + ((xx + N) % N)];
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * N + x) * 4;
      img.data[i] = 128 + dx * 40;
      img.data[i + 1] = 128 + dy * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  poresTex = new THREE.CanvasTexture(c);
  poresTex.wrapS = poresTex.wrapT = THREE.RepeatWrapping;
  return poresTex;
}

/** Mèches : bandes claires et sombres le long de la pousse (carte de couleur et de relief). */
function strandTextures(seed: number) {
  const W = 256, H = 256;
  const col = canvas(W, H);
  const nor = canvas(W, H);
  const r = rng(seed);
  col.g.fillStyle = '#808080';
  col.g.fillRect(0, 0, W, H);
  nor.g.fillStyle = 'rgb(128,128,255)';
  nor.g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = r() * W;
    const w = 0.6 + r() * 1.8;
    const v = Math.round(90 + r() * 110);
    col.g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    col.g.fillRect(x, 0, w, H);
    nor.g.fillStyle = `rgba(${r() > 0.5 ? 170 : 86},128,255,0.5)`;
    nor.g.fillRect(x, 0, w, H);
  }
  const map = new THREE.CanvasTexture(col.c);
  const normal = new THREE.CanvasTexture(nor.c);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, normal };
}

/* ------------------------------------------------------------------ tête */

export function buildHead(o: HeadOptions): Head {
  const group = new THREE.Group();
  const photo = o.photo;
  const lm = o.landmarks;
  const f = photo && lm ? faceFrame(lm, photo.naturalWidth || photo.width, photo.naturalHeight || photo.height) : null;
  if (!f || !photo) return genericHead(o);

  const tex = faceTexture(photo, f, o.hair, o.capColor ?? 'auto', o.style);
  const pts = f.pts;

  // Crâne : ellipsoïde calé sur le visage.
  const halfW = pts[234].distanceTo(pts[454]) / 2;
  const eyeY = (pts[33].y + pts[263].y) / 2;
  const a = halfW * 1.04;
  const b = Math.max(0.1, pts[10].y - eyeY + 0.06);
  const d = a * 1.3;
  const c = V(0, eyeY - 0.004, Math.min(pts[234].z, pts[454].z) - a * 0.28);
  const R = V(a, b, d);
  const toEll = (p: THREE.Vector3) => p.clone().sub(c).divide(R).normalize();
  const fromEll = (u: THREE.Vector3, k = 1) => u.clone().multiply(R).multiplyScalar(k).add(c);

  const positions: number[] = [];
  const uvs: number[] = [];
  pts.forEach((p, i) => {
    positions.push(p.x, p.y, p.z);
    uvs.push(...tex.uv(i));
  });
  const index: number[] = Array.from(FACE_TRIS);

  // Anneaux du contour du visage jusqu'au pôle arrière : un seul maillage, normales lissées à la jonction.
  const RINGS = 18;
  const back = V(0, 0.08, -1).normalize();
  const n = FACE_OVAL.length;
  // Direction de sortie de chaque point du contour : dans le prolongement de la surface du visage.
  const ovalSet = new Set(FACE_OVAL);
  const neigh = new Map<number, Set<number>>();
  for (let i = 0; i < FACE_TRIS.length; i += 3) {
    const tri = [FACE_TRIS[i], FACE_TRIS[i + 1], FACE_TRIS[i + 2]];
    for (const v of tri) if (ovalSet.has(v)) for (const w of tri) if (!ovalSet.has(w)) (neigh.get(v) ?? neigh.set(v, new Set()).get(v)!).add(w);
  }
  const tangent = (vi: number) => {
    const ns = [...(neigh.get(vi) ?? [])];
    if (!ns.length) return pts[vi].clone().sub(c).normalize();
    const inner = ns.reduce((acc, w) => acc.add(pts[w]), V()).multiplyScalar(1 / ns.length);
    return pts[vi].clone().sub(inner).normalize();
  };
  let prev = FACE_OVAL.slice();
  for (let r = 1; r < RINGS; r++) {
    const t = r / RINGS;
    const ring: number[] = [];
    for (const vi of FACE_OVAL) {
      const p0 = pts[vi];
      const u0 = toEll(p0);
      // Arc sur l'ellipsoïde, du bord du visage vers l'arrière.
      const axis = u0.clone().cross(back);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      const u = u0.clone().applyAxisAngle(axis.normalize(), u0.angleTo(back) * t);
      const onEll = fromEll(u);
      // Départ tangent à la surface du visage, puis la courbe rejoint le crâne.
      const along = p0.clone().add(tangent(vi).multiplyScalar(Math.min(t, 0.12) * 0.16));
      const p = along.lerp(onEll, smooth(0.0, 0.3, t));
      ring.push(positions.length / 3);
      positions.push(p.x, p.y, p.z);
      uvs.push(...tex.skinUV);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      index.push(prev[i], ring[i], prev[j], prev[j], ring[i], ring[j]);
    }
    prev = ring;
  }
  const pole = positions.length / 3;
  const pp = fromEll(back);
  positions.push(pp.x, pp.y, pp.z);
  uvs.push(...tex.skinUV);
  for (let i = 0; i < n; i++) index.push(prev[i], pole, prev[(i + 1) % n]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  // Sens des triangles : normales vers l'extérieur.
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  let out = 0;
  for (let i = 0; i < nrm.count; i++) {
    const p = V(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).sub(c);
    out += p.x * nrm.getX(i) + p.y * nrm.getY(i) + p.z * nrm.getZ(i);
  }
  if (out < 0) {
    const idx = geo.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i);
      idx.setX(i, idx.getX(i + 1));
      idx.setX(i + 1, t);
    }
    geo.computeVertexNormals();
  }

  // Morphs relatifs : mâchoire (0), clignement (1).
  const count = positions.length / 3;
  const jaw = new Float32Array(count * 3);
  const blink = new Float32Array(count * 3);
  const mouthY = (pts[61].y + pts[291].y) / 2;
  const chinY = pts[152].y;
  const pivot = V(0, eyeY - 0.03, c.z - 0.005);
  const angle = 0.2;
  const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), angle);
  for (let i = 0; i < count; i++) {
    const p = V(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const lowerLip = (i < 468 && MOUTH_RING.includes(i) && p.y < (pts[13].y + pts[14].y) / 2) ? 1 : 0;
    const w = Math.max(
      lowerLip,
      smooth(mouthY + 0.002, mouthY - (mouthY - chinY) * 0.3, p.y) * smooth(c.z - 0.02, c.z + a * 0.6, p.z) * (1 - smooth(a * 0.55, a * 0.95, Math.abs(p.x))),
    );
    if (w > 0) {
      const rel = p.clone().sub(pivot).applyQuaternion(q).add(pivot).sub(p).multiplyScalar(w);
      jaw.set([rel.x, rel.y, rel.z], i * 3);
    }
    if (i < 468 && UPPER_LIP.includes(i)) jaw[i * 3 + 1] += 0.0022;
  }
  for (const [u, l] of LIDS) {
    const dlt = pts[l].clone().sub(pts[u]).multiplyScalar(0.92);
    blink.set([dlt.x, dlt.y, dlt.z + 0.0015], u * 3);
  }
  for (const [cr, lid] of CREASE) {
    const low = LIDS.find(([u]) => u === lid)![1];
    const dlt = pts[low].clone().sub(pts[lid]).multiplyScalar(0.35);
    blink.set([dlt.x, dlt.y, dlt.z], cr * 3);
  }
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(jaw, 3), new THREE.Float32BufferAttribute(blink, 3)];
  geo.morphTargetsRelative = true;

  const faceMat = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughness: 0.52,
    normalMap: pores(),
    normalScale: new THREE.Vector2(0.12, 0.12),
    clearcoat: 1,
    clearcoatMap: tex.gloss,
    clearcoatRoughness: 0.12,
    sheen: 0.15,
    sheenColor: new THREE.Color('#ff9c86'),
    sheenRoughness: 0.6,
  });
  const face = new THREE.Mesh(geo, faceMat);
  face.morphTargetInfluences = [0, 0];
  face.castShadow = true;
  face.receiveShadow = true;
  group.add(face);

  const skinMat = new THREE.MeshPhysicalMaterial({ color: tex.skin, roughness: 0.55, sheen: 0.15, sheenColor: new THREE.Color('#ff9c86'), normalMap: pores(), normalScale: new THREE.Vector2(0.1, 0.1) });

  // Intérieur de la bouche et dents (visibles quand la mâchoire s'ouvre).
  const mc = MOUTH_RING.reduce((acc, i) => acc.add(pts[i]), V()).multiplyScalar(1 / MOUTH_RING.length);
  const mw = pts[308].distanceTo(pts[78]);
  const cavity = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#3a0f10', roughness: 0.8, side: THREE.BackSide }),
  );
  cavity.scale.set(mw * 0.55, 0.018, 0.028);
  cavity.position.copy(mc).add(V(0, -0.004, -0.024));
  group.add(cavity);
  const teethMat = new THREE.MeshPhysicalMaterial({ color: '#f3efe6', roughness: 0.25, clearcoat: 0.6 });
  const upperTeeth = new THREE.Mesh(new THREE.CylinderGeometry(mw * 0.42, mw * 0.42, 0.009, 24, 1, true, -1.1, 2.2), teethMat);
  upperTeeth.position.copy(mc).add(V(0, 0.0015, -0.028));
  const lowerTeeth = upperTeeth.clone();
  lowerTeeth.position.y -= 0.01;
  group.add(upperTeeth, lowerTeeth);

  // Oreilles.
  const earY = (eyeY + pts[2].y) / 2;
  for (const s of [-1, 1]) group.add(ear(s, V(s * a * 0.99, earY, c.z + a * 0.02), skinMat));

  // Cou.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.16, 32, 1, true), skinMat);
  neck.position.set(0, chinY - 0.03, c.z + 0.012);
  neck.castShadow = true;
  group.add(neck);

  // Coiffure.
  const hairGroup = buildHair(o.style, { a, b, d, c, eyeY, top: pts[10], pts, mesh: face }, tex.hair, tex.cap, o.logo ?? null);
  group.add(hairGroup);

  // Origine du groupe : la base du cou.
  const base = V(0, chinY - 0.1, c.z + 0.012);
  group.children.forEach((ch) => ch.position.sub(base));

  let talk = 0;
  let blinkT = 0;
  let nextBlink = 1.5 + Math.random() * 2;
  return {
    group,
    skin: tex.skin,
    eyeHeight: eyeY - base.y,
    setTalk(v) {
      talk = v;
    },
    update(t, dt) {
      const inf = face.morphTargetInfluences!;
      inf[0] += (talk - inf[0]) * Math.min(1, dt * 22);
      lowerTeeth.position.y = upperTeeth.position.y - 0.01 - inf[0] * 0.012;
      if (t > nextBlink) {
        blinkT = t;
        nextBlink = t + 2.2 + Math.random() * 3.5 + (Math.random() < 0.15 ? -1.8 : 0);
      }
      const k = (t - blinkT) / 0.16;
      inf[1] = k >= 0 && k <= 1 ? Math.sin(k * Math.PI) : 0;
    },
  };
}

/** Oreille : pavillon aplati, rebord (hélix) tout autour, conque et lobe. */
function ear(side: number, pos: THREE.Vector3, mat: THREE.Material) {
  const g = new THREE.Group();
  const pinna = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  pinna.scale.set(0.02, 0.031, 0.006);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.2, 10, 40, Math.PI * 1.7), mat);
  rim.scale.set(0.019, 0.029, 0.02);
  rim.rotation.z = -Math.PI * 0.35;
  rim.position.z = 0.002;
  const concha = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshPhysicalMaterial({ color: (mat as THREE.MeshPhysicalMaterial).color.clone().multiplyScalar(0.7), roughness: 0.6 }));
  concha.scale.set(0.009, 0.013, 0.003);
  concha.position.set(-0.003, -0.004, 0.004);
  const lobe = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
  lobe.scale.set(0.009, 0.01, 0.0055);
  lobe.position.set(0.001, -0.029, 0.001);
  g.add(pinna, rim, concha, lobe);
  g.position.copy(pos);
  // Pavillon tourné vers l'extérieur et légèrement vers l'avant.
  g.rotation.y = side * (Math.PI / 2 - 0.45);
  g.rotation.x = -0.12;
  g.traverse((m) => ((m as THREE.Mesh).castShadow = true));
  return g;
}

/* ------------------------------------------------------------------ cheveux */

interface Skull {
  a: number;
  b: number;
  d: number;
  c: THREE.Vector3;
  eyeY: number;
  top: THREE.Vector3;
  pts: THREE.Vector3[];
  /** Surface réelle de la tête (visage + crâne), pour que cheveux et casquette l'épousent. */
  mesh: THREE.Mesh;
}

/** Point de la surface de la tête dans une direction (lancer de rayon depuis l'extérieur), décalé vers l'extérieur de `off` m. */
function surfaceProbe(s: Skull) {
  const ray = new THREE.Raycaster();
  const cache = new Map<string, number>();
  return (dir: THREE.Vector3, off: number) => {
    const u = dir.clone().normalize();
    const key = `${u.x.toFixed(3)},${u.y.toFixed(3)},${u.z.toFixed(3)}`;
    let r = cache.get(key);
    if (r === undefined) {
      ray.set(s.c.clone().add(u.clone().multiplyScalar(0.5)), u.clone().negate());
      const hit = ray.intersectObject(s.mesh, false)[0];
      r = hit ? 0.5 - hit.distance : dir.length();
      cache.set(key, r);
    }
    return s.c.clone().add(u.multiplyScalar(r + off));
  };
}

function buildHair(style: HairStyle, s: Skull, hair: THREE.Color, capColor: THREE.Color, logo: Img | null) {
  const g = new THREE.Group();
  if (style === 'bald') return g;
  const strands = strandTextures(style.length * 17);
  const hl = hair.clone().lerp(new THREE.Color('#f1d3a2'), 0.35);
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: hair,
    map: strands.map,
    normalMap: strands.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.48,
    sheen: 1,
    sheenColor: hl,
    sheenRoughness: 0.35,
    side: THREE.DoubleSide,
  });
  // Position sur la tête : direction (azimut, élévation) de l'ellipsoïde, distance sondée sur la vraie surface ;
  // k = 1,05 : 5 mm au-dessus de la peau.
  const probe = surfaceProbe(s);
  const ell = (th: number, ph: number, k: number) =>
    probe(V(s.a * Math.cos(ph) * Math.sin(th), s.b * Math.sin(ph), s.d * Math.cos(ph) * Math.cos(th)), (k - 1) * 0.1);
  // Élévation de la racine des cheveux (front, tempes au-dessus des oreilles, nuque).
  const phTop = Math.asin(Math.max(-1, Math.min(1, (s.top.y - s.c.y) / s.b)));
  const hairline = (th: number, front: number, side: number, backL: number) => {
    const cf = Math.max(0, Math.cos(th));
    const cb = Math.max(0, -Math.cos(th));
    return front * Math.pow(cf, 1.3) + backL * Math.pow(cb, 1.1) + side * (1 - Math.pow(cf, 1.3) - Math.pow(cb, 1.1));
  };

  /** Coque de cheveux entre la racine et le sommet, épaissie par touffes. */
  const shell = (front: number, side: number, backL: number, thick: number, clump: number, seed: number) => {
    const NU = 120, NV = 44;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        const th = -Math.PI + (i / NU) * Math.PI * 2;
        const line = hairline(th, front, side, backL);
        const v = j / NV;
        const ph = line + (Math.PI / 2 - line) * Math.pow(v, 0.9);
        const edge = smooth(0, 0.18, v);
        const dir = V(Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th));
        const n = noise3(dir.x * 6 + seed, dir.y * 6, dir.z * 6);
        const k = 1 + (thick + clump * (n - 0.5)) * edge + 0.02;
        const p = ell(th, ph, k);
        pos.push(p.x, p.y, p.z);
        uv.push((i / NU) * 6, v * 2);
      }
    }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const A = j * (NU + 1) + i;
        const B = A + NU + 1;
        idx.push(A, B, A + 1, A + 1, B, B + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, hairMat);
    m.castShadow = true;
    return m;
  };

  /** Mèches (rubans effilés) : de la racine vers la pointe, en suivant une courbe. */
  const ribbons = (list: THREE.Vector3[][], width: (i: number) => number, color: (i: number) => THREE.Color) => {
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    list.forEach((pts, si) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const N = 10;
      const w0 = width(si);
      const cc = color(si);
      const base = pos.length / 3;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const p = curve.getPoint(t);
        const tan = curve.getTangent(t);
        const outward = p.clone().sub(s.c).normalize();
        const side = tan.clone().cross(outward).normalize().multiplyScalar(w0 * (1 - t * 0.85));
        pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
        const shade = 0.85 + 0.15 * (1 - t);
        col.push(cc.r * shade, cc.g * shade, cc.b * shade, cc.r * shade, cc.g * shade, cc.b * shade);
        uv.push(0, t, 1, t);
        if (k < N) {
          const q = base + k * 2;
          idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = hairMat.clone();
    mat.color.set('#ffffff');
    mat.vertexColors = true;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  };

  const r = rng(style.length * 31 + 5);
  const shade = (k: number) => hair.clone().lerp(k > 0 ? hl : new THREE.Color('#000'), Math.min(0.35, Math.abs(k) * 0.45));

  if (style === 'cap') {
    // Boucles qui dépassent sous la casquette (tempes, nuque).
    const curlGeo = new THREE.IcosahedronGeometry(1, 3);
    const cp = curlGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const k = 0.8 + 0.4 * hash3(cp.getX(i) * 3, cp.getY(i) * 3, cp.getZ(i) * 3);
      cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k, cp.getZ(i) * k);
    }
    curlGeo.computeVertexNormals();
    const curlMat = new THREE.MeshPhysicalMaterial({ color: hair, roughness: 0.55, sheen: 1, sheenColor: hl, sheenRoughness: 0.4 });
    const curls = new THREE.InstancedMesh(curlGeo, curlMat, 520);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 520; i++) {
      let th = (r() * 2 - 1) * Math.PI;
      // Surtout sur les côtés et la nuque, quelques-unes sur les tempes.
      if (Math.abs(th) < 0.75) th = Math.sign(th || 1) * (0.75 + r() * 0.3);
      const line = hairline(th, phTop - 0.1, -0.02, -0.5);
      const ph = line + r() * 0.28;
      const p = ell(th, ph, 1.02 + r() * 0.035);
      const sc = 0.0045 + r() * 0.0045;
      m4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), V(sc, sc * 1.3, sc));
      curls.setMatrixAt(i, m4);
    }
    curls.castShadow = true;
    g.add(shell(phTop - 0.12, -0.02, -0.52, 0.04, 0.06, 3));
    g.add(curls);
    g.add(buildCap(ell, phTop, capColor, logo));
    return g;
  }

  if (style === 'fringe') {
    g.add(shell(phTop - 0.02, -0.08, -0.5, 0.16, 0.14, 11));
    // Frange : mèches qui partent du sommet, suivent le crâne et retombent sur le front, un peu en désordre.
    const list: THREE.Vector3[][] = [];
    for (let i = 0; i < 260; i++) {
      const th = (r() * 2 - 1) * 1.15;
      const ph0 = phTop + 0.45 + r() * 0.5;
      const sway = (r() - 0.35) * 0.3;
      const tipPh = phTop - 0.01 - r() * 0.12 * (1 - Math.abs(th) * 0.6);
      const root = ell(th, ph0, 1.12);
      const mid = ell(th + sway * 0.5, (ph0 + tipPh) / 2 + 0.04, 1.13 + r() * 0.03);
      const tip = ell(th + sway, tipPh, 1.02 + r() * 0.012).add(V(0, 0, 0.007));
      list.push([root, mid, tip]);
    }
    g.add(ribbons(list, () => 0.005 + r() * 0.005, () => shade((r() - 0.3) * 0.9)));
    // Quelques mèches rebelles sur le dessus et les côtés.
    const top: THREE.Vector3[][] = [];
    for (let i = 0; i < 160; i++) {
      const th = (r() * 2 - 1) * Math.PI;
      const ph = 0.2 + r() * 1.2;
      const root = ell(th, ph, 1.14);
      const tip = ell(th + (r() - 0.5) * 0.25, ph - 0.2 - r() * 0.25, 1.16 + r() * 0.04);
      top.push([root, root.clone().lerp(tip, 0.5).add(root.clone().sub(s.c).normalize().multiplyScalar(0.005)), tip]);
    }
    g.add(ribbons(top, () => 0.008 + r() * 0.006, () => shade((r() - 0.3) * 0.8)));
    return g;
  }

  if (style === 'curly') {
    g.add(shell(phTop + 0.02, 0.1, -0.45, 0.12, 0.08, 5));
    const curls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), hairMat, 420);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 420; i++) {
      const th = (r() * 2 - 1) * Math.PI;
      const line = hairline(th, phTop + 0.02, 0.1, -0.45);
      const ph = line + r() * (Math.PI / 2 - line);
      const sc = 0.01 + r() * 0.008;
      m4.compose(ell(th, ph, 1.07 + r() * 0.03), new THREE.Quaternion(), V(sc, sc, sc));
      curls.setMatrixAt(i, m4);
    }
    curls.castShadow = true;
    g.add(curls);
    return g;
  }

  if (style === 'long') {
    g.add(shell(phTop + 0.04, 0.12, -0.5, 0.1, 0.05, 9));
    const list: THREE.Vector3[][] = [];
    for (let i = 0; i < 220; i++) {
      const th = (r() > 0.5 ? 1 : -1) * (0.9 + r() * 2.2);
      const root = ell(th, 0.6 + r() * 0.6, 1.04);
      const mid = ell(th * 1.02, -0.2, 1.12);
      const tip = ell(th * 1.05, -0.9, 1.1).add(V(0, -0.1 - r() * 0.06, -0.01));
      list.push([root, mid, tip]);
    }
    g.add(ribbons(list, () => 0.01 + r() * 0.006, () => shade((r() - 0.4) * 0.7)));
    return g;
  }

  // Court (par défaut).
  g.add(shell(phTop + 0.03, 0.1, -0.45, 0.07, 0.04, 1));
  return g;
}

/** Casquette : calotte à six panneaux (coutures, logo du club), bouton, visière incurvée. */
function buildCap(ell: (th: number, ph: number, k: number) => THREE.Vector3, phTop: number, color: THREE.Color, logo: Img | null) {
  const g = new THREE.Group();
  const W = 1024, H = 512;
  const { c: cv, g: cg } = canvas(W, H);
  cg.fillStyle = `#${color.getHexString()}`;
  cg.fillRect(0, 0, W, H);
  // Trame du tissu.
  cg.globalAlpha = 0.08;
  for (let y = 0; y < H; y += 3) {
    cg.fillStyle = y % 6 ? '#000' : '#fff';
    cg.fillRect(0, y, W, 1);
  }
  cg.globalAlpha = 1;
  // Coutures des panneaux.
  cg.strokeStyle = 'rgba(0,0,0,0.45)';
  cg.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const x = ((i + 0.5) / 6) * W;
    cg.beginPath();
    cg.moveTo(x, 0);
    cg.lineTo(x, H);
    cg.stroke();
  }
  // Logo du club sur le panneau avant (u = 0,5).
  if (logo) {
    const lw = 150;
    const lh = (logo.height / logo.width) * lw;
    cg.drawImage(logo, W / 2 - lw / 2, H * 0.62 - lh / 2, lw, lh);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.85, sheen: 0.5, sheenColor: color.clone().lerp(new THREE.Color('#fff'), 0.3), side: THREE.DoubleSide });

  // Calotte : bord avant juste au-dessus des sourcils, plus bas derrière.
  const rim = (th: number) => {
    const cf = Math.max(0, Math.cos(th));
    return (phTop - 0.2) * Math.pow(cf, 1.2) + 0.02 * (1 - Math.pow(cf, 1.2));
  };
  const NU = 96, NV = 30;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NV; j++)
    for (let i = 0; i <= NU; i++) {
      const th = -Math.PI + (i / NU) * Math.PI * 2;
      const v = j / NV;
      const line = rim(th);
      const ph = line + (Math.PI / 2 - line) * v;
      const k = 1.085 + 0.025 * Math.sin(v * Math.PI) - 0.015 * v;
      const p = ell(th, ph, k);
      pos.push(p.x, p.y, p.z);
      // u = 0,5 : panneau avant (logo).
      uv.push(i / NU, v);
    }
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const A = j * (NU + 1) + i;
      const B = A + NU + 1;
      idx.push(A, B, A + 1, A + 1, B, B + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const crown = new THREE.Mesh(geo, mat);
  crown.castShadow = true;
  g.add(crown);

  const button = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), mat);
  button.position.copy(ell(0, Math.PI / 2, 1.075));
  g.add(button);

  // Visière : part du bord avant et s'avance, bords rabattus.
  const visorMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, sheen: 0.4 });
  const VN = 32, VR = 8;
  const vp: number[] = [], vi: number[] = [];
  for (let j = 0; j <= VR; j++)
    for (let i = 0; i <= VN; i++) {
      const th = -1.05 + (i / VN) * 2.1;
      const r = j / VR;
      const base = ell(th, rim(th) + 0.01, 1.09);
      const fwd = V(Math.sin(th) * 0.35, 0, 1).normalize();
      const len = 0.075 * Math.cos(th * 0.75);
      const p = base.add(fwd.multiplyScalar(len * r)).add(V(0, -0.012 * r * r - 0.01 * Math.pow(Math.abs(th), 2) * r, 0));
      vp.push(p.x, p.y, p.z);
    }
  for (let j = 0; j < VR; j++)
    for (let i = 0; i < VN; i++) {
      const A = j * (VN + 1) + i;
      const B = A + VN + 1;
      vi.push(A, B, A + 1, A + 1, B, B + 1);
    }
  const vg = new THREE.BufferGeometry();
  vg.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
  vg.setIndex(vi);
  vg.computeVertexNormals();
  const visor = new THREE.Mesh(vg, visorMat);
  visor.castShadow = true;
  const under = visor.clone();
  under.position.y -= 0.003;
  g.add(visor, under);
  return g;
}

/** Tête générique (pas de photo) : ellipsoïde de peau, visage sculpté simplement, cheveux courts. */
function genericHead(o: HeadOptions): Head {
  const group = new THREE.Group();
  const skin = new THREE.Color('#e3b08f');
  const skinMat = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ff9c86') });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skinMat);
  head.scale.set(0.075, 0.11, 0.095);
  head.position.set(0, 0.2, 0);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 12), skinMat);
  nose.position.set(0, 0.19, 0.095);
  nose.rotation.x = Math.PI / 2 + 0.3;
  const eyes = [-1, 1].map((sx) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshPhysicalMaterial({ color: '#2a1d14', clearcoat: 1, roughness: 0.2 }));
    e.position.set(sx * 0.028, 0.215, 0.083);
    return e;
  });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.16, 24), skinMat);
  neck.position.set(0, 0.05, -0.01);
  group.add(head, nose, ...eyes, neck);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshPhysicalMaterial({ color: o.hair && o.hair !== 'auto' ? o.hair : '#3a2718', roughness: 0.5, sheen: 1 }));
  hair.scale.set(0.079, 0.115, 0.1);
  hair.position.copy(head.position);
  hair.rotation.x = -0.35;
  if (o.style !== 'bald') group.add(hair);
  group.traverse((m) => ((m as THREE.Mesh).castShadow = true));
  let talk = 0;
  return {
    group,
    skin,
    eyeHeight: 0.215,
    setTalk(v) {
      talk = v;
    },
    update(t) {
      head.scale.y = 0.11 + talk * 0.004 + Math.sin(t) * 0.0002;
    },
  };
}
