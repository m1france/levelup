/**
 * Corps sculptés (champs de distance) aux proportions d'un adulte :
 * - présentateur assis à la table : veste de survêtement noire (col montant, fermeture éclair, logo du club sur le cœur),
 *   pantalon noir, mains posées sur la table (phalanges, ongles, pouce opposé) ;
 * - public : journalistes assis, photographes et cadreurs debout, en manteaux de couleurs variées.
 * Repère : sol de l'estrade (ou de la salle), z vers la table / la caméra, en mètres.
 */
import * as THREE from 'three';
import { len3, len2, box, cone, cylUV, ellipsoid, noise3, smax, smin, surfaceNets, sphere, type MeshData, type Sdf } from './sdf';
import { canvas, type Img } from './textures';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
type V3 = [number, number, number];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ tissus */

/** Maille fine du tissu technique (relief répété). */
let fabricTex: THREE.Texture | null = null;
function fabricNormal() {
  if (fabricTex) return fabricTex;
  const N = 256;
  const { c, g } = canvas(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      // Sergé : diagonales fines et un peu de grain.
      const d = Math.sin(((x + y) / N) * Math.PI * 2 * 64);
      const n = Math.random() - 0.5;
      img.data[i] = 128 + d * 26 + n * 18;
      img.data[i + 1] = 128 - d * 26 + n * 18;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  fabricTex = new THREE.CanvasTexture(c);
  fabricTex.wrapS = fabricTex.wrapT = THREE.RepeatWrapping;
  return fabricTex;
}

export function fabric(color: string, { sheen = 0.8, roughness = 0.62 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    sheen,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#9aa3b5'), 0.45),
    normalMap: fabricNormal(),
    normalScale: new THREE.Vector2(0.12, 0.12),
    specularIntensity: 0.35,
  });
}

/** Plis : ondulations irrégulières du tissu (dans le champ de distance). */
const folds = (x: number, y: number, z: number, amp: number) => (noise3(x * 22, y * 9, z * 22) - 0.5) * amp + (noise3(x * 55 + 3, y * 30, z * 55) - 0.5) * amp * 0.35;

/* ------------------------------------------------------------------ présentateur */

/** Repères du présentateur assis (x = 0 au milieu du siège). */
export const SEAT = {
  /** Pivot de la tête : centre du cou au niveau du col. */
  neck: V(0, 1.16, -0.664),
  table: 0.787,
};

export interface Presenter3D {
  root: THREE.Group;
  torso: THREE.Mesh;
}

const cache = new Map<string, unknown>();
/** Géométries coûteuses mises en cache (l'aperçu des réglages reconstruit souvent la scène). */
function cached<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

/** Buste en veste (sans les mains) : épaules, poitrine, bras pliés, avant-bras posés sur la table, col montant. */
function jacketSdf(): Sdf {
  const pelvis = ellipsoid([0, 0.62, -0.79], [0.175, 0.1, 0.13]);
  const belly = ellipsoid([0, 0.77, -0.745], [0.158, 0.13, 0.118], [0.08, 0, 0]);
  const chest = ellipsoid([0, 0.97, -0.705], [0.168, 0.165, 0.118], [0.12, 0, 0]);
  const pecs = ellipsoid([0.075, 1.0, -0.65], [0.08, 0.07, 0.06], [0.1, 0, 0]);
  // Haut du buste (sternum, clavicules) : le cou s'y enfonce, rien ne dépasse sous le col.
  const sternum = ellipsoid([0, 1.075, -0.668], [0.11, 0.07, 0.068]);
  const lats = ellipsoid([0.12, 0.93, -0.72], [0.06, 0.12, 0.09]);
  const trap = cone([0.045, 1.15, -0.7], [0.18, 1.1, -0.675], 0.042, 0.046);
  const deltoid = ellipsoid([0.195, 1.06, -0.66], [0.05, 0.068, 0.056], [0, 0, 0.15]);
  const upperArm = cone([0.2, 1.06, -0.66], [0.232, 0.845, -0.43], 0.053, 0.048);
  const elbow = V(0.232, 0.845, -0.43);
  const wrist = V(0.118, 0.822, -0.165);
  const forearm = cone([elbow.x, elbow.y, elbow.z], [wrist.x, wrist.y, wrist.z], 0.05, 0.038);
  const cuff = cone([0.135, 0.825, -0.2], [0.112, 0.822, -0.15], 0.04, 0.039);
  // Poignet de la manche : coupe nette perpendiculaire à l'avant-bras (l'ouverture laisse sortir la main).
  const axis = wrist.clone().sub(elbow).normalize();
  const cutAt = wrist.clone().addScaledVector(axis, 0.012);
  const elbowPuff = ellipsoid([0.232, 0.85, -0.435], [0.05, 0.045, 0.05]);
  // Col montant : anneau incliné (plus haut derrière), et trou du cou dans le buste.
  const collarC = V(0, 1.15, -0.662);
  // Col plus haut derrière que devant.
  const tilt = -0.32;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const collar: Sdf = (x, y, z) => {
    const qx = x - collarC.x, qy0 = y - collarC.y, qz0 = z - collarC.z;
    const qy = qy0 * ct - qz0 * st;
    const qz = qy0 * st + qz0 * ct;
    const rr = len2(qx, qz / 1.1);
    // Col fin (4 mm), légèrement évasé vers le haut.
    return Math.max(Math.abs(rr - 0.071 - Math.max(0, qy) * 0.12) - 0.005, Math.abs(qy) - 0.029);
  };
  const neckHole: Sdf = (x, y, z) => {
    const qy0 = y - collarC.y, qz0 = z - collarC.z;
    const qz = qy0 * st + qz0 * ct;
    // Trou du cou : seulement à l'intérieur du col (le buste reste fermé dessous).
    return Math.max(len2(x, qz / 1.1) - 0.066, -(qy0 * ct - qz0 * st) - 0.03, 1.12 - y);
  };
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = smin(pelvis(x, y, z), belly(x, y, z), 0.06);
    d = smin(d, chest(x, y, z), 0.07);
    d = smin(d, pecs(ax, y, z), 0.04);
    d = smin(d, sternum(x, y, z), 0.04);
    d = smin(d, lats(ax, y, z), 0.05);
    d = smin(d, trap(ax, y, z), 0.05);
    d = smin(d, deltoid(ax, y, z), 0.04);
    let arm = smin(upperArm(ax, y, z), forearm(ax, y, z), 0.03);
    arm = smin(arm, elbowPuff(ax, y, z), 0.03);
    arm = smin(arm, cuff(ax, y, z), 0.01);
    arm = smax(arm, (ax - cutAt.x) * axis.x + (y - cutAt.y) * axis.y + (z - cutAt.z) * axis.z, 0.004);
    // L'avant-bras s'aplatit sur la table.
    arm = smax(arm, SEAT.table + 0.001 - y, 0.01);
    d = smin(d, arm, 0.035);
    // Plis : taille, creux du coude, dos.
    d += folds(x, y, z, 0.006) * (1 - smooth(1.02, 1.12, y));
    d = smax(d, -neckHole(x, y, z), 0.008);
    d = smin(d, collar(x, y, z), 0.012);
    // Coupé sur l'assise (le bassin repose sur la chaise).
    return Math.max(d, 0.52 - y);
  };
}

/** Jambes en pantalon (sous la table) et chaussures. */
function legsSdf(): Sdf {
  const thigh = cone([0.1, 0.6, -0.76], [0.115, 0.575, -0.3], 0.085, 0.058);
  const shin = cone([0.115, 0.56, -0.3], [0.125, 0.1, -0.27], 0.056, 0.04);
  const shoe = ellipsoid([0.125, 0.045, -0.2], [0.05, 0.045, 0.13]);
  const seat = ellipsoid([0, 0.6, -0.8], [0.18, 0.09, 0.13]);
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = smin(thigh(ax, y, z), shin(ax, y, z), 0.04);
    d = smin(d, seat(x, y, z), 0.05);
    d = smin(d, shoe(ax, y, z), 0.03);
    return Math.max(d, -y);
  };
}

/**
 * Main gauche au repos, paume vers le bas (repère : poignet à l'origine, doigts vers +z, pouce vers -x).
 * Longueur 19 cm, paume 8,5 cm de large : proportions d'une main d'homme.
 */
function handSdf(): { sdf: Sdf; nail: (x: number, y: number, z: number) => number } {
  const palm = box([0.0, 0.0, 0.055], [0.04, 0.0125, 0.048], 0.012, [0.05, 0, 0]);
  const wrist = ellipsoid([0, 0.001, -0.005], [0.032, 0.019, 0.04]);
  const thenar = ellipsoid([-0.024, -0.004, 0.035], [0.02, 0.012, 0.03]);
  const hypothenar = ellipsoid([0.028, -0.006, 0.045], [0.014, 0.012, 0.035]);
  // Doigts : jointures (MCP), phalanges pliées vers la table, légèrement écartés.
  const fingers: { pts: V3[]; r: number[] }[] = [];
  const specs = [
    { x: -0.027, len: [0.043, 0.025, 0.021], r: 0.0095, spread: -0.08 },
    { x: -0.0085, len: [0.047, 0.029, 0.022], r: 0.0098, spread: -0.02 },
    { x: 0.0095, len: [0.044, 0.028, 0.021], r: 0.0092, spread: 0.04 },
    { x: 0.026, len: [0.035, 0.02, 0.019], r: 0.0082, spread: 0.1 },
  ];
  const tips: V3[] = [];
  for (const s of specs) {
    let p: V3 = [s.x, 0.001, 0.1];
    const pts: V3[] = [p];
    // Main détendue à plat : les doigts s'arrondissent à peine, le bout touche la table.
    let pitch = 0;
    const yaw = s.spread;
    s.len.forEach((l, k) => {
      pitch += [0.02, 0.12, 0.1][k];
      p = [p[0] + Math.sin(yaw) * l * Math.cos(pitch), p[1] - Math.sin(pitch) * l, p[2] + Math.cos(yaw) * l * Math.cos(pitch)];
      pts.push(p);
    });
    tips.push(p);
    fingers.push({ pts, r: [s.r, s.r * 0.92, s.r * 0.84, s.r * 0.76] });
  }
  const segs = fingers.flatMap((f) => f.pts.slice(1).map((b, i) => cone(f.pts[i], b, f.r[i], f.r[i + 1])));
  const knuckles = specs.map((s) => sphere([s.x, 0.006, 0.1], s.r * 1.05));
  const thumb = [
    cone([-0.028, -0.003, 0.018], [-0.05, -0.006, 0.056], 0.0145, 0.0115),
    cone([-0.05, -0.006, 0.056], [-0.058, -0.007, 0.082], 0.0112, 0.0098),
    cone([-0.058, -0.007, 0.082], [-0.06, -0.006, 0.1], 0.0097, 0.0085),
  ];
  const thumbTip: V3 = [-0.06, -0.006, 0.1];
  const sdf: Sdf = (x, y, z) => {
    let d = smin(palm(x, y, z), wrist(x, y, z), 0.02);
    d = smin(d, thenar(x, y, z), 0.015);
    d = smin(d, hypothenar(x, y, z), 0.012);
    for (const k of knuckles) d = smin(d, k(x, y, z), 0.006);
    let f = 1e3;
    for (const s of segs) f = smin(f, s(x, y, z), 0.004);
    d = smin(d, f, 0.008);
    let t = 1e3;
    for (const s of thumb) t = smin(t, s(x, y, z), 0.004);
    return smin(d, t, 0.012);
  };
  // Ongle : dessus de la dernière phalange.
  const all = [...tips, thumbTip];
  const nail = (x: number, y: number, z: number) => {
    let best = 0;
    for (const [tx, ty, tz] of all) {
      const d = len3(x - tx, (y - ty - 0.004) * 1.6, z - tz + 0.007);
      best = Math.max(best, smooth(0.0085, 0.006, d) * smooth(ty - 0.001, ty + 0.004, y));
    }
    return best;
  };
  return { sdf, nail };
}

/** Maillage de la main : couleurs par sommet (teint, jointures rosées, ongles), occlusion entre les doigts. */
export function handMesh(skinHex: string): MeshData {
  const skin = new THREE.Color(skinHex);
  const { sdf, nail } = handSdf();
  const m = surfaceNets(sdf, [-0.08, -0.06, -0.05], [0.055, 0.03, 0.2], 0.0019);
  const n = m.positions.length / 3;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  const knuckle = skin.clone().lerp(new THREE.Color('#c86d5e'), 0.3);
  const nailC = skin.clone().lerp(new THREE.Color('#f3d2c8'), 0.55);
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    c.copy(skin).multiplyScalar(1 + (noise3(x * 90, y * 90, z * 90) - 0.5) * 0.08);
    c.lerp(knuckle, smooth(0.004, 0.0, Math.abs(z - 0.1)) * smooth(0.0, 0.008, y) * 0.8);
    c.lerp(nailC, nail(x, y, z));
    let occ = 0;
    const nx = m.normals[i * 3], ny = m.normals[i * 3 + 1], nz = m.normals[i * 3 + 2];
    for (const h of [0.003, 0.007, 0.012]) occ += (h - Math.max(-h, sdf(x + nx * h, y + ny * h, z + nz * h))) / h;
    c.multiplyScalar(0.45 + 0.55 * clamp01(1 - occ * 0.3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  return { ...cylUV(m, 60), colors: col };
}

/** Surface du buste le long d'une ligne (fermeture éclair) : points projetés sur la veste. */
function traceFront(f: Sdf, pts: THREE.Vector3[]) {
  return pts.map((p) => {
    const q = p.clone().add(V(0, 0, 0.25));
    for (let i = 0; i < 80; i++) {
      const d = f(q.x, q.y, q.z);
      if (d < 0.0005) break;
      q.z -= Math.max(0.001, d * 0.9);
    }
    return q;
  });
}

/** Écusson brodé posé sur la veste : petite grille qui épouse la poitrine, texturée par le logo. */
function logoPatch(f: Sdf, center: THREE.Vector3, w: number, h: number) {
  const NX = 28, NY = 28;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const p = V(center.x + (i / NX - 0.5) * w, center.y + (0.5 - j / NY) * h, 0.4);
      for (let k = 0; k < 100; k++) {
        const d = f(p.x, p.y, p.z);
        if (d < 0.0003) break;
        p.z -= Math.max(0.0008, d * 0.9);
      }
      p.z += 0.0032;
      pos.push(p.x, p.y, p.z);
      uv.push(i / NX, 1 - j / NY);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function zipGeometry(f: Sdf) {
  const pts = traceFront(f, Array.from({ length: 30 }, (_, i) => V(0, 0.64 + (i / 29) * (1.095 - 0.64), 0)));
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.add(V(0, 0, 0.0015))));
  return { geo: new THREE.TubeGeometry(curve, 120, 0.0028, 6, false), top: pts[pts.length - 1] };
}

export interface PresenterMeshes {
  jacket: THREE.BufferGeometry;
  legs: THREE.BufferGeometry;
  hand: THREE.BufferGeometry;
}

/**
 * Présentateur assis (sans la tête) : buste en veste noire, jambes, mains.
 * La tête se pose sur `SEAT.neck`. Les maillages lourds sont calculés à part (workers).
 */
export function buildPresenterBody(logo: Img, skinMat: THREE.Material, g: PresenterMeshes): Presenter3D {
  const f = cached('jacket-sdf', jacketSdf);
  const zipper = cached('zip', () => zipGeometry(f));
  const k = logo.width / logo.height;
  const lw = k >= 1 ? 0.075 : 0.075 * k;
  const logoGeo = cached(`logo:${k.toFixed(3)}`, () => logoPatch(f, V(0.085, 1.02, 0), lw, lw / k));
  const upper = g.jacket;
  const legsGeo = g.legs;
  const handGeo = g.hand;
  const root = new THREE.Group();
  const jacket = fabric('#101114', { sheen: 0.9, roughness: 0.58 });
  const torso = new THREE.Mesh(upper, jacket);
  torso.castShadow = torso.receiveShadow = true;
  root.add(torso);
  const pants = new THREE.Mesh(legsGeo, fabric('#16171b', { sheen: 0.5, roughness: 0.75 }));
  pants.castShadow = pants.receiveShadow = true;
  root.add(pants);

  // Fermeture éclair et tirette.
  const metal = new THREE.MeshStandardMaterial({ color: '#8f949c', metalness: 0.9, roughness: 0.3 });
  const zip = new THREE.Mesh(zipper.geo, new THREE.MeshStandardMaterial({ color: '#1d1f24', metalness: 0.6, roughness: 0.4 }));
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.022, 0.003), metal);
  pull.position.copy(zipper.top).add(V(0, -0.012, 0.004));
  pull.rotation.x = -0.25;
  root.add(zip, pull);

  // Logo du club sur le cœur (côté gauche du présentateur).
  const lt = new THREE.CanvasTexture(logo as HTMLCanvasElement);
  lt.colorSpace = THREE.SRGBColorSpace;
  lt.anisotropy = 8;
  const patch = new THREE.Mesh(logoGeo, new THREE.MeshPhysicalMaterial({ map: lt, transparent: true, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#ffffff'), alphaTest: 0.05 }));
  patch.receiveShadow = true;
  root.add(patch);

  // Mains posées sur la table, doigts vers l'avant et vers le milieu.
  for (const s of [-1, 1]) {
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.castShadow = hand.receiveShadow = true;
    hand.scale.x = s;
    hand.position.set(s * 0.112, SEAT.table + 0.022, -0.175);
    hand.rotation.set(0.0, -s * 0.41, 0, 'YXZ');
    root.add(hand);
  }
  return { root, torso };
}

/* ------------------------------------------------------------------ public */

type Pose = 'seated' | 'standing';

/** Silhouette en manteau, assise (journaliste) ou debout (photographe, cadreur) ; les bras levés du photographe sont à part. */
function crowdSdf(pose: Pose): Sdf {
  if (pose === 'seated') {
    const hips = ellipsoid([0, 0.52, -0.02], [0.17, 0.1, 0.14]);
    const torso = ellipsoid([0, 0.85, -0.03], [0.17, 0.26, 0.12], [0.06, 0, 0]);
    const shoulders = cone([0.05, 1.08, -0.04], [0.19, 1.04, -0.03], 0.055, 0.058);
    const upper = cone([0.2, 1.03, -0.03], [0.21, 0.78, 0.1], 0.052, 0.045);
    const fore = cone([0.21, 0.78, 0.1], [0.08, 0.78, 0.28], 0.045, 0.036);
    const thigh = cone([0.1, 0.52, 0.0], [0.11, 0.5, 0.42], 0.08, 0.06);
    const shin = cone([0.11, 0.5, 0.42], [0.12, 0.06, 0.44], 0.055, 0.042);
    const neck = cone([0, 1.08, -0.03], [0, 1.2, -0.02], 0.052, 0.05);
    return (x, y, z) => {
      const ax = Math.abs(x);
      let d = smin(hips(x, y, z), torso(x, y, z), 0.08);
      d = smin(d, shoulders(ax, y, z), 0.06);
      d = smin(d, smin(upper(ax, y, z), fore(ax, y, z), 0.03), 0.04);
      d = smin(d, smin(thigh(ax, y, z), shin(ax, y, z), 0.04), 0.05);
      d = smin(d, neck(x, y, z), 0.03);
      return d + folds(x, y, z, 0.01);
    };
  }
  const legs = cone([0.1, 0.9, 0], [0.11, 0.05, 0.02], 0.075, 0.05);
  const hips = ellipsoid([0, 0.95, 0], [0.17, 0.12, 0.12]);
  const torso = ellipsoid([0, 1.28, 0], [0.18, 0.28, 0.12]);
  const shoulders = cone([0.05, 1.5, -0.01], [0.2, 1.46, 0], 0.056, 0.06);
  const neck = cone([0, 1.5, 0], [0, 1.62, 0.01], 0.052, 0.05);
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = smin(legs(ax, y, z), hips(x, y, z), 0.06);
    d = smin(d, torso(x, y, z), 0.08);
    d = smin(d, shoulders(ax, y, z), 0.06);
    d = smin(d, neck(x, y, z), 0.03);
    return d + folds(x, y, z, 0.01);
  };
}

/** Maillages du corps calculables à part (dans un worker). */
export type BodyPart = 'jacket' | 'legs' | 'crowd-seated' | 'crowd-standing' | 'arms';

export function bodyMesh(part: BodyPart): MeshData {
  if (part === 'jacket') return cylUV(surfaceNets(jacketSdf(), [-0.3, 0.5, -0.96], [0.3, 1.2, -0.1], 0.0038), 10);
  if (part === 'legs') return cylUV(surfaceNets(legsSdf(), [-0.23, 0, -0.97], [0.23, 0.72, -0.05], 0.009), 10);
  if (part === 'crowd-seated') return cylUV(surfaceNets(crowdSdf('seated'), [-0.3, 0.3, -0.2], [0.3, 1.24, 0.55], 0.012), 8);
  if (part === 'crowd-standing') return cylUV(surfaceNets(crowdSdf('standing'), [-0.3, 0, -0.2], [0.3, 1.66, 0.2], 0.012), 8);
  // Bras levés tenant l'appareil devant le visage (photographe).
  const upperArm = cone([0.2, 1.47, 0], [0.2, 1.33, 0.2], 0.05, 0.044);
  const fore = cone([0.2, 1.33, 0.2], [0.07, 1.6, 0.21], 0.042, 0.036);
  const f: Sdf = (x, y, z) => {
    const ax = Math.abs(x);
    return smin(upperArm(ax, y, z), fore(ax, y, z), 0.03);
  };
  return cylUV(surfaceNets(f, [-0.28, 1.2, -0.08], [0.28, 1.68, 0.3], 0.01), 8);
}
