/**
 * Sculpture par champs de distance signée (SDF) : les formes du corps (crâne, nez, lèvres, épaules, doigts…)
 * sont des primitives fondues entre elles, puis converties en maillage lisse par « surface nets ».
 * Tout est en mètres, sans allocation dans les fonctions de distance (elles sont appelées des millions de fois).
 */
import * as THREE from 'three';

export type Sdf = (x: number, y: number, z: number) => number;
type V3 = [number, number, number];

/* ------------------------------------------------------------------ opérateurs */

/** Longueurs (Math.hypot est beaucoup plus lent dans les boucles chaudes). */
export const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
export const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** Union lisse (raccord arrondi de rayon ~k). */
export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
/** Soustraction / intersection lisse. */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/* ------------------------------------------------------------------ primitives */

export function sphere(c: V3, r: number): Sdf {
  const [cx, cy, cz] = c;
  return (x, y, z) => len3(x - cx, y - cy, z - cz) - r;
}

/** Ellipsoïde (approximation d'Inigo Quilez, bonne près de la surface), orientable par angles d'Euler XYZ. */
export function ellipsoid(c: V3, r: V3, rot?: V3): Sdf {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const m = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).invert().elements : null;
  return (x, y, z) => {
    let px = x - cx, py = y - cy, pz = z - cz;
    if (m) {
      const qx = m[0] * px + m[4] * py + m[8] * pz;
      const qy = m[1] * px + m[5] * py + m[9] * pz;
      const qz = m[2] * px + m[6] * py + m[10] * pz;
      px = qx, py = qy, pz = qz;
    }
    const k0 = len3(px / rx, py / ry, pz / rz);
    const k1 = len3(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

/** Segment arrondi effilé (rayon r1 en a, r2 en b) : bras, doigts, mâchoire. */
export function cone(a: V3, b: V3, r1: number, r2: number): Sdf {
  const [ax, ay, az] = a;
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

/** Pavé arrondi (demi-tailles h, rayon d'arrondi r), orientable. */
export function box(c: V3, h: V3, r: number, rot?: V3): Sdf {
  const [cx, cy, cz] = c;
  const m = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).invert().elements : null;
  return (x, y, z) => {
    let px = x - cx, py = y - cy, pz = z - cz;
    if (m) {
      const qx = m[0] * px + m[4] * py + m[8] * pz;
      const qy = m[1] * px + m[5] * py + m[9] * pz;
      const qz = m[2] * px + m[6] * py + m[10] * pz;
      px = qx, py = qy, pz = qz;
    }
    const qx = Math.abs(px) - h[0] + r, qy = Math.abs(py) - h[1] + r, qz = Math.abs(pz) - h[2] + r;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

/** Chaîne de segments effilés (bras, doigt) : points et rayons, fondus avec un raccord k. */
export function chain(pts: V3[], radii: number[], k = 0): Sdf {
  const parts = pts.slice(1).map((b, i) => cone(pts[i], b, radii[i], radii[i + 1]));
  return (x, y, z) => {
    let d = parts[0](x, y, z);
    for (let i = 1; i < parts.length; i++) d = k ? smin(d, parts[i](x, y, z), k) : Math.min(d, parts[i](x, y, z));
    return d;
  };
}

/**
 * Groupe borné : les primitives ne sont évaluées que près de leur sphère englobante (gros gain de temps).
 * Au-delà de la marge, le groupe renvoie une grande valeur : il ne compte plus dans les unions lisses (rayon < marge).
 */
export function bounded(c: V3, r: number, f: Sdf, pad = 0.02): Sdf {
  const [cx, cy, cz] = c;
  return (x, y, z) => (len3(x - cx, y - cy, z - cz) - r > pad ? 1e3 : f(x, y, z));
}

/** Bruit de valeur 3D lissé (plis de tissu, relief de peau). */
function hash3(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function noise3(x: number, y: number, z: number) {
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

/* ------------------------------------------------------------------ maillage */

export interface SdfMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Surface nets : un sommet par cellule traversée par la surface, une face par arête qui la traverse.
 * Bande étroite : la grille fine n'est évaluée que dans les blocs proches de la surface (repérés sur une grille grossière).
 * Chaque sommet est ensuite projeté sur la surface et reçoit la normale du champ (ombrage parfaitement lisse).
 */
export function surfaceNets(f: Sdf, min: V3, max: V3, cell: number): SdfMesh {
  const K = 4;
  const nx = Math.ceil((max[0] - min[0]) / cell / K) * K + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell / K) * K + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell / K) * K + 1;
  const [ox, oy, oz] = min;
  const N = nx * ny * nz;
  const val = new Float32Array(N).fill(NaN);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  // Grille grossière.
  const cx = (nx - 1) / K + 1, cy = (ny - 1) / K + 1, cz = (nz - 1) / K + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        const v = f(ox + i * K * cell, oy + j * K * cell, oz + k * K * cell);
        coarse[i + cx * (j + cy * k)] = v;
        val[at(i * K, j * K, k * K)] = v;
      }
  // Blocs actifs : un coin assez proche de la surface (marge de sécurité : champs approchés).
  const reach = K * cell * Math.sqrt(3) * 1.05;
  for (let k = 0; k < cz - 1; k++)
    for (let j = 0; j < cy - 1; j++)
      for (let i = 0; i < cx - 1; i++) {
        let near = false;
        let neg = false, pos = false;
        for (let c = 0; c < 8 && !near; c++) {
          const v = coarse[i + (c & 1) + cx * (j + ((c >> 1) & 1) + cy * (k + ((c >> 2) & 1)))];
          if (Math.abs(v) < reach) near = true;
          if (v < 0) neg = true;
          else pos = true;
        }
        if (!near && !(neg && pos)) continue;
        for (let kk = 0; kk <= K; kk++)
          for (let jj = 0; jj <= K; jj++)
            for (let ii = 0; ii <= K; ii++) {
              const I = i * K + ii, J = j * K + jj, Kz = k * K + kk;
              const n = at(I, J, Kz);
              if (Number.isNaN(val[n])) val[n] = f(ox + I * cell, oy + J * cell, oz + Kz * cell);
            }
      }
  // Hors de la bande : le signe du coin grossier le plus proche suffit.
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const n = at(i, j, k);
        if (Number.isNaN(val[n])) val[n] = coarse[Math.round(i / K) + cx * (Math.round(j / K) + cy * Math.round(k / K))] < 0 ? -1 : 1;
      }

  // Un sommet par cellule traversée.
  const cellIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + (((b & 1) - (a & 1)) * t);
          sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
          sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
          n++;
        }
        cellIdx[cid(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
      }

  // Faces : chaque arête de la grille qui traverse la surface relie les 4 cellules qui la partagent.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = val[at(i, j, k)] < 0;
        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && v0 !== val[at(i + 1, j, k)] < 0)
          quad(cellIdx[cid(i, j - 1, k - 1)], cellIdx[cid(i, j, k - 1)], cellIdx[cid(i, j - 1, k)], cellIdx[cid(i, j, k)], !v0);
        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && v0 !== val[at(i, j + 1, k)] < 0)
          quad(cellIdx[cid(i - 1, j, k - 1)], cellIdx[cid(i - 1, j, k)], cellIdx[cid(i, j, k - 1)], cellIdx[cid(i, j, k)], !v0);
        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && v0 !== val[at(i, j, k + 1)] < 0)
          quad(cellIdx[cid(i - 1, j - 1, k)], cellIdx[cid(i, j - 1, k)], cellIdx[cid(i - 1, j, k)], cellIdx[cid(i, j, k)], !v0);
      }

  // Projection sur la surface (un pas de Newton) et normales du champ.
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.35;
  const lim = cell * 0.6;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v], y = positions[v + 1], z = positions[v + 2];
    const d = f(x, y, z);
    const gx = f(x + e, y, z) - f(x - e, y, z);
    const gy = f(x, y + e, z) - f(x, y - e, z);
    const gz = f(x, y, z + e) - f(x, y, z - e);
    const g2 = gx * gx + gy * gy + gz * gz;
    if (g2 < 1e-14) continue;
    const s = (d * 2 * e) / g2;
    // Pas limité : le sommet reste dans le voisinage de sa cellule.
    positions[v] = x - Math.max(-lim, Math.min(lim, gx * s));
    positions[v + 1] = y - Math.max(-lim, Math.min(lim, gy * s));
    positions[v + 2] = z - Math.max(-lim, Math.min(lim, gz * s));
    const l = Math.sqrt(g2);
    normals[v] = gx / l;
    normals[v + 1] = gy / l;
    normals[v + 2] = gz / l;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

/** Maillage prêt à transférer (worker → page) : attributs en tableaux typés. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  rig?: Float32Array;
}

/** UV : projection cylindrique autour de l'axe vertical, pour les textures répétées (tissu, pores). */
export function cylUV(m: SdfMesh, uvScale = 8): MeshData {
  const uvs = new Float32Array((m.positions.length / 3) * 2);
  for (let i = 0, v = 0; i < m.positions.length; i += 3, v += 2) {
    uvs[v] = ((Math.atan2(m.positions[i], m.positions[i + 2]) / (Math.PI * 2)) + 0.5) * uvScale;
    uvs[v + 1] = m.positions[i + 1] * uvScale * 1.6;
  }
  return { ...m, uvs };
}

export function toGeometry(d: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  if (d.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  if (d.colors) g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  if (d.rig) g.setAttribute('aRig', new THREE.BufferAttribute(d.rig, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Tableaux à transférer sans copie. */
export const transferables = (d: MeshData) => [d.positions, d.normals, d.indices, d.uvs, d.colors, d.rig].filter(Boolean).map((a) => a!.buffer);
