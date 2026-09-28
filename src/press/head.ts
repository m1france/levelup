/**
 * Tête 3D réaliste d'un présentateur, entièrement sculptée (aucune photo) :
 * - crâne, front, arcades, pommettes, nez (narines creusées), lèvres, menton, mâchoire, oreilles et cou
 *   sont des volumes fondus entre eux (champ de distance) puis maillés finement ;
 * - peau peinte par sommet (teint, rougeurs, lèvres, barbe naissante, cernes) avec occlusion ambiante calculée ;
 * - yeux : sclérotique veinée, iris fibreux, pupille, cornée transparente, cils ; sourcils poil à poil ;
 * - la mâchoire s'ouvre quand il parle, les paupières clignent (déformation dans le shader) ;
 * - coiffures : casquette (logo du club), frange, court, bouclé, long ou sans cheveux.
 * Repère : origine entre les deux oreilles (tragus), y en haut, z vers l'avant, en mètres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { len3, len2, bounded, cone, ellipsoid, noise3, smax, smin, sphere, surfaceNets, type MeshData, type Sdf } from './sdf';
import { canvas, type Img } from './textures';

export type HairStyle = 'cap' | 'fringe' | 'short' | 'curly' | 'long' | 'bald';

export interface HeadOptions {
  style: HairStyle;
  /** « auto » : brun foncé. */
  hair: string;
  capColor?: string;
  logo?: Img | null;
  /** Teint : 0 très clair → 1 très mat. */
  tone?: number;
  /** Barbe naissante : 0 → 1. */
  beard?: number;
  /** Graine : petites variations du visage d'une personne à l'autre. */
  seed?: number;
  /** Finesse du maillage (m) : 1,3 mm pour les présentateurs, plus grossier pour la salle. */
  cell?: number;
  /** Détails (cils, sourcils poil à poil, dents) : seulement pour les gros plans. */
  detail?: boolean;
}

export interface Head {
  /** Groupe à placer sur le cou : son origine est le pivot de la tête (au niveau du col). */
  group: THREE.Group;
  skin: THREE.Color;
  skinMaterial: THREE.MeshPhysicalMaterial;
  /** Hauteur des yeux au-dessus du pivot (m), pour cadrer les plans. */
  eyeHeight: number;
  /** Avancée des yeux devant le pivot (m). */
  eyeForward: number;
  setTalk(v: number): void;
  /** `look` : point regardé (repère monde), ou null. */
  update(t: number, dt: number, look?: THREE.Vector3 | null): void;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Petit générateur déterministe : même tête à chaque chargement. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ------------------------------------------------------------------ anatomie */

/** Rayon du globe oculaire et centres des yeux. */
const EYE_R = 0.0121;
/** Pivot de la mâchoire (articulation temporo-mandibulaire) et du cou. */
const JAW_PIVOT = V(0, 0.004, -0.012);
const NECK_PIVOT = V(0, -0.13, -0.022);

interface Face {
  sdf: Sdf;
  eye: THREE.Vector3;
  /** Hauteur de la fente des lèvres selon x. */
  mouthY: (x: number) => number;
  /** Paupières : ouverture (haut, bas) dans le repère angulaire de l'œil. */
  lidUp: (u: number) => number;
  lidLo: (u: number) => number;
  brow: (x: number) => number;
  cranium: { c: THREE.Vector3; r: THREE.Vector3 };
}

/**
 * Champ de distance de la tête. Les mesures suivent un homme adulte moyen :
 * 15,5 cm de large, 19,5 cm de profondeur, 23,5 cm du menton au sommet, yeux à 6,3 cm d'écart.
 */
function faceSdf(seed: number): Face {
  const r = rng(seed * 7919 + 13);
  const j = (a: number) => 1 + (r() - 0.5) * 2 * a;
  // Variations de morphologie (largeur de mâchoire, nez, lèvres, menton).
  const jawW = j(0.08), noseL = j(0.1), noseW = j(0.1), lipF = j(0.12), chin = j(0.1), cheek = j(0.08);

  const E = V(0.0318, 0.02, 0.0655);
  const dz = (k: number, amp: number) => (k - 1) * amp;
  const cranC = V(0, 0.036, -0.009);
  const cranR = V(0.0765, 0.094, 0.097);
  const mouthY = (x: number) => -0.0552 - 0.002 * Math.min(1, (x / 0.025) ** 2);

  // Crâne et masse du visage.
  const cranium = ellipsoid([cranC.x, cranC.y, cranC.z], [cranR.x, cranR.y, cranR.z]);
  const forehead = ellipsoid([0, 0.05, 0.035], [0.066, 0.06, 0.056]);
  const occiput = ellipsoid([0, 0.02, -0.055], [0.062, 0.06, 0.05]);
  const maxilla = ellipsoid([0, -0.03, 0.036], [0.05, 0.052, 0.054]);
  const temple = ellipsoid([0.071, 0.034, 0.03], [0.012, 0.03, 0.03]);

  // Pommettes, joues, arcades.
  const zygo = cone([0.046, 0.004, 0.053], [0.062, 0.006, 0.012], 0.0105 * cheek, 0.0085);
  // Bas du visage : un seul volume ample (joues, lèvres, menton) sur lequel les reliefs se posent sans bourrelet.
  const lowerFace = ellipsoid([0, -0.036, 0.046], [0.05, 0.05, 0.044]);
  const malar = ellipsoid([0.05, -0.002, 0.045], [0.018, 0.015, 0.02]);
  const muzzle = ellipsoid([0, -0.05, 0.074], [0.024, 0.02, 0.017]);
  const browL = cone([0.004, 0.036, 0.087], [0.05, 0.039, 0.071], 0.0095, 0.0068);

  // Mâchoire et menton.
  const ramus = cone([0.051 * jawW, 0.0, -0.012], [0.045 * jawW, -0.064, -0.002], 0.009, 0.0105);
  const chinZ = 0.075 + dz(chin, 0.03);
  const body = cone([0.045 * jawW, -0.062, -0.002], [0.015, -0.088, chinZ], 0.0102, 0.011);
  const mentum = ellipsoid([0, -0.086, chinZ], [0.02, 0.019, 0.017]);
  const underJaw = ellipsoid([0, -0.073, 0.03], [0.034, 0.016, 0.036]);

  // Nez : arête, pointe, ailes, columelle ; narines creusées.
  const tipZ = 0.112 + dz(noseL, 0.03);
  const nw = 1 + dz(noseW, 1);
  const bridge = cone([0, 0.028, 0.0875], [0, -0.016, tipZ - 0.004], 0.006, 0.008);
  const tip = ellipsoid([0, -0.021, tipZ - 0.004], [0.0102 * nw, 0.0092, 0.0092]);
  const ala = ellipsoid([0.011 * nw, -0.028, 0.0975], [0.0066, 0.0064, 0.008], [0, 0.35, 0]);
  const columella = cone([0, -0.025, tipZ - 0.006], [0, -0.0335, 0.096], 0.0042, 0.0045);
  const nostril = ellipsoid([0.0066 * nw, -0.0318, 0.1015], [0.0029, 0.0021, 0.005], [-0.5, 0.3, 0]);

  // Lèvres : ourlets supérieur et inférieur, philtrum ; fente et intérieur de la bouche.
  const lf = lipF;
  const upperLip = cone([0.0255, mouthY(0.0255) + 0.0012, 0.083], [0, -0.0505, 0.094], 0.0032 * lf, 0.0052 * lf);
  const lowerLip = cone([0.023, mouthY(0.023) - 0.0012, 0.083], [0, -0.0612, 0.0915], 0.0032 * lf, 0.0064 * lf);
  const philtrum = cone([0.004, -0.037, 0.0955], [0.0046, -0.0485, 0.0952], 0.0021, 0.0021);
  const lipBase = ellipsoid([0, -0.053, 0.078], [0.025, 0.017, 0.013]);
  const slit = ellipsoid([0, -0.0555, 0.093], [0.0262, 0.00085, 0.02]);
  const cavity = ellipsoid([0, -0.056, 0.064], [0.022, 0.011, 0.022]);
  const chinFold = ellipsoid([0, -0.071, chinZ + 0.016], [0.014, 0.0022, 0.006]);

  // Orbites, paupières (coque autour du globe, ouverte en amande), pli de la paupière.
  const orbit = ellipsoid([E.x, E.y + 0.001, E.z + 0.017], [0.0205, 0.0145, 0.012]);
  const pocket = sphere([E.x, E.y, E.z], EYE_R + 0.0022);
  const fat = ellipsoid([E.x + 0.002, E.y + 0.0138, E.z + 0.0078], [0.0165, 0.0042, 0.0072]);
  const bag = ellipsoid([E.x + 0.001, E.y - 0.012, E.z + 0.0085], [0.013, 0.0032, 0.006]);
  // Amande : bord supérieur plus haut côté tempe (inclinaison), coin interne plus bas.
  const lidUp = (u: number) => 0.46 * Math.pow(Math.max(0, 1 - ((u - 0.05) / 0.95) ** 2), 0.62) + 0.03 * u - 0.02;
  const lidLo = (u: number) => -0.33 * Math.pow(Math.max(0, 1 - ((u - 0.07) / 0.94) ** 2), 0.8) + 0.035 * u - 0.03;
  const lidR = EYE_R + 0.0019;
  const lids: Sdf = (x, y, z) => {
    const dx = x - E.x, dy = y - E.y, dz = z - E.z;
    const l = len3(dx, dy, dz);
    const shell = l - lidR;
    if (dz < 0 || l < 1e-6) return shell;
    // Coordonnées angulaires : u vers la tempe, v vers le haut.
    const u = dx / l, v = dy / l;
    const inside = Math.max(v - lidUp(u), lidLo(u) - v, Math.abs(u - 0.02) - 0.97);
    return Math.max(shell, -inside * EYE_R * 1.1);
  };

  // Oreille (côté +x ; l'autre par symétrie). Repère de l'oreille : w vers l'extérieur, ey vers le haut, ez vers l'avant.
  const antihelix = cone([0.0006, 0.017, -0.004], [0.0006, -0.012, -0.0035], 0.0017, 0.0019);
  const lobe = ellipsoid([0, -0.027, -0.002], [0.0036, 0.0085, 0.0088]);
  const concha = ellipsoid([0.0045, -0.004, 0.004], [0.005, 0.0105, 0.0085]);
  const tragus = ellipsoid([0.001, -0.005, 0.0125], [0.0035, 0.0045, 0.003]);
  const ear: Sdf = (x, y, z) => {
    const ez = z + 0.017, ey = y - 0.004, ex = x - 0.0685;
    // Le pavillon s'écarte de la tête vers l'arrière et vers le haut.
    const mid = 0.003 + Math.max(0, -ez - 0.004) * 0.5 + Math.max(0, ey) * 0.08;
    const w = ex - mid;
    // Contour : ovale plus étroit en bas (lobe).
    const ry = 0.0305, rz = 0.0165 - Math.max(0, -ey) * 0.09;
    const e2 = (len2((ez + 0.001) / rz, ey / ry) - 1) * Math.min(rz, ry);
    const plate = Math.max(e2, Math.abs(w) - 0.0014);
    // Hélix : bord roulé, sauf à l'avant où l'oreille rejoint la tête.
    const rim = len2(e2 + 0.0024, w - 0.0008) - 0.0027;
    const front = smooth(0.004, 0.012, ez);
    let d = smin(plate, rim + front * 0.01, 0.002);
    d = smin(d, antihelix(w, ey, ez), 0.002);
    d = smin(d, lobe(w, ey, ez), 0.003);
    d = smax(d, -concha(w, ey, ez), 0.0015);
    return smin(d, tragus(w, ey, ez), 0.0015);
  };

  // Cou : colonne, sterno-cléido-mastoïdiens, pomme d'Adam.
  // Le cou descend légèrement vers l'arrière : sa base rejoint le haut du buste, derrière le sternum.
  const neck = cone([0, -0.05, -0.028], [0, -0.215, -0.042], 0.05, 0.057);
  const scm = cone([0.052, -0.03, -0.028], [0.012, -0.19, 0.018], 0.011, 0.0115);
  const adam = ellipsoid([0, -0.138, 0.036], [0.011, 0.016, 0.0095]);
  const nape = ellipsoid([0, -0.09, -0.05], [0.048, 0.06, 0.035]);

  // Groupes bornés : chaque point n'évalue que les volumes proches.
  const faceFront = bounded([0, -0.03, 0.085], 0.06, (x, y, z) => {
    const ax = Math.abs(x);
    let d = smin(bridge(ax, y, z), tip(ax, y, z), 0.006);
    d = smin(d, ala(ax, y, z), 0.0065);
    d = smin(d, columella(ax, y, z), 0.003);
    d = smax(d, -nostril(ax, y, z), 0.0015);
    let lips = smin(upperLip(ax, y, z), lowerLip(ax, y, z), 0.0025);
    lips = smin(lips, philtrum(ax, y, z), 0.003);
    lips = smin(lips, lipBase(ax, y, z), 0.006);
    return smin(d, lips, 0.006);
  });
  const eyeZone = bounded([E.x, E.y, E.z + 0.008], 0.03, (ax, y, z) => {
    let d = smin(fat(ax, y, z), bag(ax, y, z), 0.004);
    return smin(d, lids(ax, y, z), 0.0025);
  });

  const sdf: Sdf = (x, y, z) => {
    const ax = Math.abs(x);
    let d = smin(cranium(x, y, z), forehead(x, y, z), 0.02);
    d = smin(d, occiput(x, y, z), 0.02);
    d = smin(d, maxilla(x, y, z), 0.02);
    d = smin(d, zygo(ax, y, z), 0.018);
    d = smin(d, lowerFace(x, y, z), 0.03);
    d = smin(d, malar(ax, y, z), 0.022);
    d = smin(d, muzzle(x, y, z), 0.03);
    d = smin(d, browL(ax, y, z), 0.012);
    d = smax(d, -temple(ax, y, z), 0.01);
    d = smin(d, ramus(ax, y, z), 0.022);
    d = smin(d, body(ax, y, z), 0.02);
    d = smin(d, mentum(x, y, z), 0.014);
    d = smin(d, underJaw(x, y, z), 0.016);
    if (y < 0) {
      d = smin(d, neck(x, y, z), 0.018);
      d = smin(d, scm(ax, y, z), 0.016);
      d = smin(d, adam(x, y, z), 0.012);
      d = smin(d, nape(x, y, z), 0.02);
    }
    // Orbite creusée puis paupières.
    if (len3(ax - E.x, y - E.y, z - E.z - 0.012) < 0.04) {
      d = smax(d, -orbit(ax, y, z), 0.007);
      d = smax(d, -pocket(ax, y, z), 0.0012);
      d = smin(d, eyeZone(ax, y, z), 0.004);
    }
    d = smin(d, faceFront(x, y, z), 0.008);
    // Bouche : fente entre les lèvres et cavité ; pli du menton.
    if (Math.abs(y + 0.056) < 0.03 && z > 0.035 && ax < 0.04) {
      d = smax(d, -slit(x, y, z), 0.0007);
      d = smax(d, -cavity(x, y, z), 0.002);
      d = smax(d, -chinFold(x, y, z), 0.003);
    }
    if (ax > 0.05 && y > -0.045 && y < 0.05 && z < 0.02 && z > -0.05) d = smin(d, ear(ax, y, z), 0.003);
    // Nuque : le cou se termine dans le col (bas coupé).
    return Math.max(d, -0.235 - y);
  };

  const brow = (x: number) => 0.0355 + 0.0055 * Math.sin(Math.min(1, Math.max(0, (x - 0.01) / 0.05)) * Math.PI * 0.85);
  return { sdf, eye: E, mouthY, lidUp, lidLo, brow, cranium: { c: cranC, r: cranR } };
}

/* ------------------------------------------------------------------ peau */

interface SkinTones {
  base: THREE.Color;
  lip: THREE.Color;
  red: THREE.Color;
  beard: THREE.Color;
  under: THREE.Color;
  inner: THREE.Color;
  brow: THREE.Color;
}

function tones(tone: number, hair: THREE.Color): SkinTones {
  const light = new THREE.Color('#e7b99c');
  const mid = new THREE.Color('#c58e6b');
  const dark = new THREE.Color('#7b4a31');
  const base = tone < 0.5 ? light.clone().lerp(mid, tone * 2) : mid.clone().lerp(dark, (tone - 0.5) * 2);
  return {
    base,
    lip: base.clone().lerp(new THREE.Color('#ad4f4a'), 0.68 - tone * 0.2),
    red: base.clone().lerp(new THREE.Color('#d06a5a'), 0.45),
    beard: base.clone().lerp(hair.clone().lerp(new THREE.Color('#3a4250'), 0.4), 0.42),
    under: base.clone().lerp(new THREE.Color('#7d5a6a'), 0.22),
    inner: new THREE.Color('#5a1c1f'),
    brow: base.clone().lerp(hair, 0.75),
  };
}

/** Teint de base d'une tête (mains assorties). */
export const skinTone = (tone: number) => tones(tone, new THREE.Color('#2b1d14')).base;

/** Teinte de peau d'un point de la surface (repère de la tête). */
function skinColor(f: Face, t: SkinTones, beard: number, x: number, y: number, z: number, out: THREE.Color) {
  const ax = Math.abs(x);
  out.copy(t.base);
  // Variations lentes du teint.
  const n = noise3(x * 60, y * 60, z * 60) - 0.5;
  out.multiplyScalar(1 + n * 0.08);
  // Rougeurs : nez, pommettes, oreilles, menton.
  const blob = (cx: number, cy: number, cz: number, r: number) => Math.exp(-((ax - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (r * r));
  const red = Math.min(0.75, blob(0, -0.022, 0.108, 0.018) * 0.6 + blob(0.044, -0.01, 0.066, 0.022) * 0.4 + smooth(0.062, 0.075, ax) * 0.5 * smooth(-0.04, -0.01, y) * smooth(0.06, 0.04, y) + blob(0, -0.086, 0.085, 0.02) * 0.2 + blob(f.eye.x, f.eye.y + 0.006, f.eye.z + 0.012, 0.007) * 0.25);
  out.lerp(t.red, red);
  // Cernes.
  out.lerp(t.under, blob(f.eye.x + 0.002, f.eye.y - 0.013, f.eye.z + 0.011, 0.009) * 0.6);
  // Sourcils : la peau sous les poils est plus sombre (densité).
  if (ax > 0.006 && ax < 0.064 && z > 0.05) {
    const k = clamp01((ax - 0.008) / 0.052);
    const half = mix(0.0042, 0.0016, k);
    const by = f.brow(ax);
    out.lerp(t.brow, smooth(half + 0.0012, half * 0.4, Math.abs(y - by)) * mix(0.45, 0.2, k));
  }
  // Barbe naissante : bas des joues, menton, moustache (pas sur les lèvres).
  const cheekLine = -0.022 - Math.max(0, ax - 0.03) * 0.35 + Math.max(0, 0.02 - ax) * 0.3;
  let bm = smooth(cheekLine + 0.004, cheekLine - 0.012, y) * smooth(-0.012, 0.01, z) * smooth(-0.175, -0.12, y);
  const must = smooth(-0.031, -0.035, y) * smooth(-0.053, -0.049, y) * smooth(0.027, 0.02, ax) * smooth(0.08, 0.09, z);
  bm = Math.max(bm, must);
  // Lèvres.
  const my = f.mouthY(ax);
  const upH = 0.0082 * Math.max(0, 1 - (ax / 0.0262) ** 2.2) + (ax < 0.008 ? -0.0012 * (1 - ax / 0.008) : 0);
  const loH = 0.0098 * Math.max(0, 1 - (ax / 0.0245) ** 2);
  const lipM = z > 0.08 ? smooth(0.0009, -0.0004, Math.max(y - (my + upH), my - loH - y)) * smooth(0.028, 0.024, ax) : 0;
  bm *= 1 - smooth(0, 0.6, lipM) * 1;
  bm *= 1 - blob(0, -0.067, 0.09, 0.006) * 0.8;
  out.lerp(t.beard, bm * beard);
  out.lerp(t.lip, lipM);
  // Intérieur de la bouche (derrière les lèvres seulement), des narines, coin de l'œil.
  const lipFront = 0.092 - 0.014 * (ax / 0.025) ** 2;
  const inMouth = ax < 0.022 && Math.abs(y - my) < 0.01 && z > 0.05 ? smooth(lipFront - 0.003, lipFront - 0.01, z) : 0;
  out.lerp(t.inner, inMouth);
  if (Math.abs(y + 0.031) < 0.006 && ax < 0.013 && z > 0.093) {
    const nd = len3((ax - 0.0066) / 0.0029, (y + 0.0318) / 0.0021, (z - 0.1015) / 0.005);
    out.lerp(t.inner, smooth(1.3, 0.7, nd) * 0.85);
  }
  const caruncle = blob(f.eye.x - EYE_R * 0.93, f.eye.y - 0.001, f.eye.z + 0.004, 0.0028);
  out.lerp(new THREE.Color('#c77f7c'), caruncle * 0.8);
  return out;
}

/** Occlusion ambiante d'un point, estimée par le champ de distance le long de la normale. */
function sdfAO(f: Sdf, x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  let occ = 0;
  let w = 1;
  for (const h of [0.002, 0.005, 0.01, 0.018]) {
    const d = f(x + nx * h, y + ny * h, z + nz * h);
    occ += (h - Math.max(-h, d)) * w / h;
    w *= 0.6;
  }
  return clamp01(1 - occ * 0.3);
}

/** Micro-relief (pores), en carte de normales répétée. */
let poresTex: THREE.Texture | null = null;
export function pores() {
  if (poresTex) return poresTex;
  const N = 512;
  const { c, g } = canvas(N, N);
  const img = g.createImageData(N, N);
  const h = new Float32Array(N * N);
  const r = rng(7);
  // Pores : petits creux ; ridules : bruit fin.
  for (let i = 0; i < N * N; i++) h[i] = r() * 0.35;
  for (let i = 0; i < 2600; i++) {
    const cx = Math.floor(r() * N), cy = Math.floor(r() * N);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) h[((cy + dy + N) % N) * N + ((cx + dx + N) % N)] -= dx || dy ? 0.35 : 0.8;
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const at = (xx: number, yy: number) => h[((yy + N) % N) * N + ((xx + N) % N)];
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * N + x) * 4;
      img.data[i] = 128 + dx * 60;
      img.data[i + 1] = 128 + dy * 60;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  poresTex = new THREE.CanvasTexture(c);
  poresTex.wrapS = poresTex.wrapT = THREE.RepeatWrapping;
  return poresTex;
}

/** Matériau de peau : couleurs par sommet, pores, reflet légèrement gras ; mâchoire et paupières animées dans le shader. */
export function skinMaterial(rig = false) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    normalMap: pores(),
    normalScale: new THREE.Vector2(0.34, 0.34),
    sheen: 0.4,
    sheenColor: new THREE.Color('#ff8a74'),
    sheenRoughness: 0.5,
    specularIntensity: 0.5,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
    // Lumière diffusée sous la peau : les ombres restent chaudes au lieu de devenir grises.
    emissive: new THREE.Color('#5a1d10'),
    emissiveIntensity: 0.12,
  });
  if (rig) {
    const uniforms = {
      uJaw: { value: 0 },
      uBlink: { value: 0 },
      uJawPivot: { value: JAW_PIVOT.clone() },
      uEyeL: { value: V() },
      uEyeR: { value: V() },
    };
    m.userData.rig = uniforms;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = injectRig(sh.vertexShader, true);
    };
    m.customProgramCacheKey = () => 'skin-rig';
  }
  return m;
}

/** Déformation du visage : rotation de la mâchoire (poids x) et des paupières supérieures (poids y, œil z). */
function injectRig(src: string, normals: boolean) {
  const head = /* glsl */ `
    attribute vec3 aRig;
    uniform float uJaw;
    uniform float uBlink;
    uniform vec3 uJawPivot;
    uniform vec3 uEyeL;
    uniform vec3 uEyeR;
    vec3 rigRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
  `;
  let out = src.replace('#include <common>', `#include <common>\n${head}`);
  out = out.replace(
    '#include <begin_vertex>',
    /* glsl */ `#include <begin_vertex>
    if (aRig.x > 0.0) transformed = uJawPivot + rigRotX(transformed - uJawPivot, uJaw * aRig.x);
    if (aRig.y > 0.0) { vec3 e = aRig.z > 0.0 ? uEyeL : uEyeR; transformed = e + rigRotX(transformed - e, uBlink * aRig.y); }`,
  );
  if (normals)
    out = out.replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `#include <beginnormal_vertex>
      if (aRig.x > 0.0) objectNormal = rigRotX(objectNormal, uJaw * aRig.x);
      if (aRig.y > 0.0) objectNormal = rigRotX(objectNormal, uBlink * aRig.y);`,
    );
  return out;
}

/* ------------------------------------------------------------------ yeux */

function eyeTexture(irisHex: string, seed: number, size = 512) {
  const iris = { r: parseInt(irisHex.slice(1, 3), 16) / 255, g: parseInt(irisHex.slice(3, 5), 16) / 255, b: parseInt(irisHex.slice(5, 7), 16) / 255 };
  const W = size, H = size;
  const { c, g } = canvas(W, H);
  const r = rng(seed);
  // v (vertical de la texture) = angle depuis l'axe de l'œil : pupille, iris, limbe, blanc de l'œil.
  const img = g.createImageData(W, H);
  const irisV = 0.168, pupilV = 0.052;
  const fibers = Array.from({ length: W }, () => r());
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let R: number, G: number, B: number;
      if (v < pupilV) (R = 6), (G = 5), (B = 6);
      else if (v < irisV) {
        const k = (v - pupilV) / (irisV - pupilV);
        const fib = 0.72 + 0.5 * fibers[x] * (0.6 + 0.4 * Math.sin(k * 18 + fibers[(x * 7) % W] * 6));
        const ring = 1 - 0.45 * smooth(0.82, 1, k) - 0.25 * smooth(0.25, 0, k);
        const warm = smooth(0.35, 0, k) * 0.35;
        R = (iris.r * 255 * (1 + warm) * fib * ring) | 0;
        G = (iris.g * 255 * (1 + warm * 0.6) * fib * ring) | 0;
        B = (iris.b * 255 * fib * ring) | 0;
      } else {
        const k = smooth(irisV, 0.55, v);
        R = 238 - k * 8;
        G = 232 - k * 26;
        B = 226 - k * 30;
        const limbal = smooth(irisV + 0.02, irisV, v);
        R = mix(R, 90, limbal * 0.6);
        G = mix(G, 80, limbal * 0.6);
        B = mix(B, 78, limbal * 0.6);
      }
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Petits vaisseaux vers les coins.
  g.strokeStyle = 'rgba(190, 70, 70, 0.35)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = r() * W;
    let y = H * (0.3 + r() * 0.2);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 30;
      y -= 12 + r() * 16;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildEye(tex: THREE.Texture) {
  const g = new THREE.Group();
  // L'axe de la sphère (pôle nord de la texture) pointe vers l'avant.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(EYE_R, 48, 32),
    new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.05, specularIntensity: 0.4 }),
  );
  ball.rotation.x = Math.PI / 2;
  g.add(ball);
  // Cornée : calotte transparente bombée devant l'iris (reflets humides).
  const cornea = new THREE.Mesh(
    new THREE.SphereGeometry(0.0079, 40, 20, 0, Math.PI * 2, 0, 0.95),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: 0.0006, ior: 1.376, roughness: 0.0, specularIntensity: 1 }),
  );
  cornea.rotation.x = Math.PI / 2;
  cornea.position.z = EYE_R - 0.0079 + 0.0021;
  g.add(cornea);
  return g;
}

/* ------------------------------------------------------------------ poils */

/** Points de la surface : lancer depuis l'extérieur vers l'intérieur (marche sur le champ de distance). */
function probeSurface(f: Sdf) {
  return (from: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null => {
    const p = from.clone();
    const d = dir.clone().normalize();
    for (let i = 0; i < 90; i++) {
      const s = f(p.x, p.y, p.z);
      if (s < 0.0002) return p;
      p.addScaledVector(d, Math.max(0.0004, s * 0.9));
      if (p.distanceTo(from) > 0.4) return null;
    }
    return p;
  };
}

function normalAt(f: Sdf, p: THREE.Vector3) {
  const e = 0.0006;
  return V(f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z), f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z), f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e)).normalize();
}

/** Poils : rubans très fins (effilés), une géométrie pour tout un sourcil ou une rangée de cils. */
function strands(list: { pts: THREE.Vector3[]; w: number; color: THREE.Color }[], mat: THREE.Material) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const nor: number[] = [];
  for (const s of list) {
    const curve = new THREE.CatmullRomCurve3(s.pts);
    const N = 4;
    const base = pos.length / 3;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const side = tan.clone().cross(V(0, 0, 1)).normalize();
      if (side.lengthSq() < 0.1) side.set(1, 0, 0);
      const w = s.w * (1 - t * 0.8);
      pos.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      const nn = side.clone().cross(tan).normalize();
      nor.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z);
      col.push(s.color.r, s.color.g, s.color.b, s.color.r, s.color.g, s.color.b);
      if (k < N) {
        const q = base + k * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ tête */

/** Paramètres qui déterminent le maillage de la peau (calculé dans un worker, mis en cache). */
export interface HeadMeshParams {
  seed: number;
  cell: number;
  tone: number;
  beard: number;
  hair: string;
}

export function headParams(o: HeadOptions): HeadMeshParams {
  return {
    seed: o.seed ?? 1,
    cell: o.cell ?? 0.0013,
    tone: o.tone ?? 0.25,
    beard: o.beard ?? 0.55,
    hair: `#${new THREE.Color(o.hair && o.hair !== 'auto' ? o.hair : '#2b1d14').getHexString()}`,
  };
}

/**
 * Maillage de la peau (sans DOM : exécutable dans un worker) : surface, teint peint par sommet avec occlusion,
 * UV des pores, et poids de déformation (mâchoire, paupières).
 */
export function headMesh(p: HeadMeshParams): MeshData {
  const face = faceSdf(p.seed);
  const t = tones(p.tone, new THREE.Color(p.hair));
  const m = surfaceNets(face.sdf, [-0.1, -0.24, -0.125], [0.1, 0.145, 0.135], p.cell);
  const n = m.positions.length / 3;
  const colors = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const rig = new Float32Array(n * 3);
  const c = new THREE.Color();
  const E = face.eye;
  const ao = p.cell < 0.0025;
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    skinColor(face, t, p.beard, x, y, z, c);
    if (ao) c.multiplyScalar(0.5 + 0.5 * sdfAO(face.sdf, x, y, z, m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    // UV sphériques (pores répétés).
    uvs[i * 2] = (Math.atan2(x, z) / Math.PI) * 6;
    uvs[i * 2 + 1] = y * 26;
    // Mâchoire : tout ce qui est sous la fente des lèvres, en avant de l'oreille, jusqu'au haut du cou.
    const ax = Math.abs(x);
    const my = face.mouthY(ax);
    let wj = smooth(my + 0.0006, my - 0.0012, y) * smooth(-0.025, 0.02, z) * smooth(-0.16, -0.1, y);
    wj *= 1 - smooth(0.03, 0.058, ax) * smooth(my - 0.03, my + 0.004, y) * 0.8;
    // Paupière supérieure : autour du globe, au-dessus de la ligne médiane de l'amande.
    const dx = ax - E.x, dy = y - E.y, dz = z - E.z;
    const l = len3(dx, dy, dz);
    let wl = 0;
    if (dz > -0.002 && l < EYE_R + 0.012) {
      const u = dx / l, v = dy / l;
      const midV = (face.lidUp(u) + face.lidLo(u)) / 2;
      wl = smooth(midV - 0.02, midV + 0.04, v) * (1 - smooth(EYE_R + 0.0032, EYE_R + 0.011, l));
    }
    rig[i * 3] = wj;
    rig[i * 3 + 1] = wl;
    rig[i * 3 + 2] = x > 0 ? 1 : -1;
  }
  return { ...m, colors, uvs, rig };
}

/** Assemble la tête (peau déjà maillée, yeux, cils, sourcils, dents, cheveux). */
export function buildHead(o: HeadOptions, geo: THREE.BufferGeometry): Head {
  const seed = o.seed ?? 1;
  const hair = new THREE.Color(o.hair && o.hair !== 'auto' ? o.hair : '#2b1d14');
  const t = tones(o.tone ?? 0.25, hair);
  const face = faceSdf(seed);
  const E = face.eye;

  const group = new THREE.Group();
  // Contenu dans un sous-groupe centré sur les oreilles, décalé pour que l'origine du groupe soit le pivot du cou.
  const inner = new THREE.Group();
  inner.position.copy(NECK_PIVOT).multiplyScalar(-1);
  group.add(inner);

  const skinMat = skinMaterial(true);
  const rig = skinMat.userData.rig as Record<string, { value: number | THREE.Vector3 }>;
  (rig.uEyeL.value as THREE.Vector3).set(E.x, E.y, E.z);
  (rig.uEyeR.value as THREE.Vector3).set(-E.x, E.y, E.z);
  const skin = new THREE.Mesh(geo, skinMat);
  skin.castShadow = true;
  skin.receiveShadow = true;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rig);
    sh.vertexShader = injectRig(sh.vertexShader, false);
  };
  skin.customDepthMaterial = depth;
  inner.add(skin);

  // Yeux.
  const irisCol = ['#6a4426', '#4f6f86', '#5d6a3c', '#7a5230', '#3a2618'][seed % 5];
  const eyeTex = eyeTexture(irisCol, seed + 3, o.detail === false ? 128 : 512);
  const eyes = [-1, 1].map((s) => {
    const e = buildEye(eyeTex);
    e.position.set(s * E.x, E.y, E.z);
    inner.add(e);
    return e;
  });

  // Cils (suivent la paupière supérieure) et sourcils.
  const lashGroups: THREE.Group[] = [];
  const probe = probeSurface(face.sdf);
  const r = rng(seed * 31 + 7);
  if (o.detail !== false) {
    const lashMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    const dark = hair.clone().multiplyScalar(0.45);
    for (const s of [-1, 1]) {
      const lg = new THREE.Group();
      lg.position.set(s * E.x, E.y, E.z);
      const list: { pts: THREE.Vector3[]; w: number; color: THREE.Color }[] = [];
      for (let i = 0; i < 70; i++) {
        const u = -0.86 + (i / 69) * 1.72 + (r() - 0.5) * 0.02;
        const v = face.lidUp(u) - 0.01;
        const dir = V(u, v, Math.sqrt(Math.max(0.05, 1 - u * u - v * v))).normalize();
        const root = dir.clone().multiplyScalar(EYE_R + 0.0019);
        const len = 0.0075 * (0.55 + 0.45 * Math.sin(((u + 0.9) / 1.8) * Math.PI)) * (0.85 + r() * 0.3);
        const out = dir.clone().multiplyScalar(len * 0.7).add(V(0, len * 0.3, 0));
        const tip = root.clone().add(out).add(V(0, len * 0.45, -len * 0.1));
        const mid = root.clone().add(out.clone().multiplyScalar(0.55)).add(V(0, len * 0.08, 0));
        list.push({ pts: [root, mid, tip].map((p) => V(p.x * s, p.y, p.z)), w: 0.00012, color: dark });
      }
      // Cils inférieurs, plus courts et plus clairsemés (ils ne suivent pas le clignement).
      const lower: typeof list = [];
      for (let i = 0; i < 28; i++) {
        const u = -0.7 + (i / 27) * 1.45;
        const v = face.lidLo(u) + 0.01;
        const dir = V(u, v, Math.sqrt(Math.max(0.05, 1 - u * u - v * v))).normalize();
        const root = dir.clone().multiplyScalar(EYE_R + 0.0019);
        const tip = root.clone().add(dir.clone().multiplyScalar(0.0025)).add(V(0, -0.0016, 0));
        lower.push({ pts: [root, root.clone().lerp(tip, 0.5).add(V(0, -0.0003, 0.0003)), tip].map((p) => V(p.x * s, p.y, p.z)), w: 0.00008, color: dark });
      }
      lg.add(strands(list, lashMat));
      const lowerMesh = strands(lower, lashMat);
      lowerMesh.position.set(s * E.x, E.y, E.z);
      inner.add(lowerMesh);
      inner.add(lg);
      lashGroups.push(lg);
    }
    // Sourcils : poils couchés, orientés vers le haut côté nez puis vers la tempe.
    const browMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const list: { pts: THREE.Vector3[]; w: number; color: THREE.Color }[] = [];
      for (let i = 0; i < 520; i++) {
        const k = Math.pow(r(), 1.2);
        const x = 0.009 + k * 0.052;
        const thick = mix(0.0085, 0.003, k);
        const y = face.brow(x) + (r() - 0.5) * thick;
        const hit = probe(V(x, y, 0.2), V(0, 0, -1));
        if (!hit) continue;
        const n = normalAt(face.sdf, hit);
        const dir = V(mix(0.25, 1, smooth(0, 0.35, k)), mix(1, 0.18, smooth(0, 0.4, k)), 0).normalize();
        const along = dir.clone().sub(n.clone().multiplyScalar(dir.dot(n))).normalize();
        const len = 0.0065 * (0.7 + r() * 0.6);
        const root = hit.clone().addScaledVector(n, 0.0003);
        const mid = root.clone().addScaledVector(along, len * 0.5).addScaledVector(n, 0.0007);
        const tip = root.clone().addScaledVector(along, len).addScaledVector(n, 0.0004);
        const shade = hair.clone().lerp(t.base, 0.15 + r() * 0.2).multiplyScalar(0.7 + r() * 0.35);
        list.push({ pts: [root, mid, tip].map((p) => V(p.x * s, p.y, p.z)), w: 0.00018, color: shade });
      }
      inner.add(strands(list, browMat));
    }
  }

  // Dents et langue (visibles quand la bouche s'ouvre) ; les dents du bas suivent la mâchoire.
  const teethMat = new THREE.MeshPhysicalMaterial({ color: '#efe6d6', roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const arch = (y: number, down: boolean) => {
    const g = new THREE.Group();
    const widths = [0.0085, 0.0068, 0.0078, 0.0075, 0.0072];
    let a = 0;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i] * (down ? 0.72 : 1);
      a += (w / 0.024) * 0.5;
      for (const s of [-1, 1]) {
        const ang = s * a;
        const tooth = new THREE.Mesh(new RoundedBoxGeometry(w * 0.92, 0.0095, 0.006, 2, 0.0015), teethMat);
        tooth.position.set(Math.sin(ang) * 0.024, y + (down ? 0.0005 : -0.0005) * i, 0.064 + Math.cos(ang) * 0.024 - 0.0075);
        tooth.rotation.y = ang;
        g.add(tooth);
      }
      a += (w / 0.024) * 0.5;
    }
    return g;
  };
  const upperTeeth = arch(-0.0482, false);
  const jaw = new THREE.Group();
  jaw.position.copy(JAW_PIVOT);
  const lowerTeeth = arch(-0.0615, true);
  lowerTeeth.position.sub(JAW_PIVOT);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#9a4648', roughness: 0.4, clearcoat: 0.6 }));
  tongue.scale.set(0.019, 0.0065, 0.024);
  tongue.position.set(0, -0.063, 0.062).sub(JAW_PIVOT);
  jaw.add(lowerTeeth, tongue);
  inner.add(upperTeeth, jaw);

  // Coiffure.
  const c = face.cranium.c;
  const R = face.cranium.r;
  const hairGroup = buildHair(o.style, { a: R.x, b: R.y, d: R.z, c, top: V(0, 0.085, 0.082), probe }, hair, new THREE.Color(o.capColor && o.capColor !== 'auto' ? o.capColor : '#15171c'), o.logo ?? null, o.detail !== false);
  inner.add(hairGroup);

  inner.traverse((m) => {
    if ((m as THREE.Mesh).isMesh && m !== skin) m.castShadow = true;
  });

  let talk = 0;
  let jawA = 0;
  let blinkT = -1;
  let nextBlink = 1.2 + r() * 2;
  let saccade = V();
  let nextSaccade = 0;
  const tmp = V();
  const q = new THREE.Quaternion();
  const baseQ = new THREE.Quaternion();
  return {
    group,
    skin: t.base,
    skinMaterial: skinMat,
    eyeHeight: E.y - NECK_PIVOT.y,
    eyeForward: E.z - NECK_PIVOT.z,
    setTalk(v) {
      talk = v;
    },
    update(time, dt, look) {
      // Mâchoire : suit le niveau de la voix, avec un peu d'inertie.
      jawA += (talk * 0.16 - jawA) * Math.min(1, dt * 18);
      rig.uJaw.value = jawA;
      jaw.rotation.x = jawA;
      // Clignements irréguliers (parfois doubles).
      if (time > nextBlink) {
        blinkT = time;
        nextBlink = time + 2.4 + Math.random() * 3.6 + (Math.random() < 0.15 ? -2 : 0);
      }
      const k = (time - blinkT) / 0.17;
      const b = k >= 0 && k <= 1 ? Math.sin(k * Math.PI) ** 0.8 : 0;
      rig.uBlink.value = b * 0.7;
      for (const lg of lashGroups) lg.rotation.x = b * 0.7;
      // Regard : vers la caméra (ou le point donné), avec de petites saccades.
      if (time > nextSaccade) {
        nextSaccade = time + 0.4 + Math.random() * 1.6;
        saccade = V((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, 0);
      }
      for (const e of eyes) {
        let yaw = saccade.x;
        let pitch = saccade.y;
        if (look) {
          e.getWorldPosition(tmp);
          const to = look.clone().sub(tmp);
          e.parent!.getWorldQuaternion(q);
          to.applyQuaternion(q.invert());
          yaw += Math.max(-0.45, Math.min(0.45, Math.atan2(to.x, to.z)));
          pitch += Math.max(-0.3, Math.min(0.3, Math.atan2(to.y, len2(to.x, to.z))));
        }
        baseQ.setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
        e.quaternion.slerp(baseQ, Math.min(1, dt * 20));
      }
    },
  };
}

/* ------------------------------------------------------------------ cheveux */

interface Skull {
  a: number;
  b: number;
  d: number;
  c: THREE.Vector3;
  top: THREE.Vector3;
  probe: (from: THREE.Vector3, dir: THREE.Vector3) => THREE.Vector3 | null;
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
  for (let i = 0; i < 1400; i++) {
    const x = r() * W;
    const w = 0.5 + r() * 1.4;
    const v = Math.round(80 + r() * 120);
    col.g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    col.g.fillRect(x, 0, w, H);
    nor.g.fillStyle = `rgba(${r() > 0.5 ? 170 : 86},128,255,0.5)`;
    nor.g.fillRect(x, 0, w, H);
  }
  const map = new THREE.CanvasTexture(col.c);
  const normal = new THREE.CanvasTexture(nor.c);
  for (const t of [map, normal]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, normal };
}

function buildHair(style: HairStyle, s: Skull, hair: THREE.Color, capColor: THREE.Color, logo: Img | null, detail: boolean) {
  const g = new THREE.Group();
  if (style === 'bald') return g;
  const strandsTex = strandTextures(style.length * 17);
  const hl = hair.clone().lerp(new THREE.Color('#f1d3a2'), 0.3);
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: hair,
    map: strandsTex.map,
    normalMap: strandsTex.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.55,
    sheen: 0.45,
    sheenColor: hl,
    sheenRoughness: 0.35,
    side: THREE.DoubleSide,
  });
  // Point de la surface dans une direction (azimut th, élévation ph), décalé de (k - 1) × 10 cm.
  const hitCache = new Map<string, THREE.Vector3>();
  const ell = (th: number, ph: number, k: number) => {
    const dir = V(s.a * Math.cos(ph) * Math.sin(th), s.b * Math.sin(ph), s.d * Math.cos(ph) * Math.cos(th)).normalize();
    const key = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}`;
    let hit = hitCache.get(key);
    if (!hit) {
      hit = s.probe(s.c.clone().addScaledVector(dir, 0.25), dir.clone().negate()) ?? s.c.clone().addScaledVector(dir, 0.09);
      hitCache.set(key, hit);
    }
    return s.c.clone().add(hit.clone().sub(s.c).addScaledVector(dir, (k - 1) * 0.1));
  };
  const phTop = Math.asin(Math.max(-1, Math.min(1, (s.top.y - s.c.y) / s.b)));
  const hairline = (th: number, front: number, side: number, backL: number) => {
    const cf = Math.max(0, Math.cos(th));
    const cb = Math.max(0, -Math.cos(th));
    return front * Math.pow(cf, 1.3) + backL * Math.pow(cb, 1.1) + side * (1 - Math.pow(cf, 1.3) - Math.pow(cb, 1.1));
  };
  const rr = rng(style.length * 31 + 5);

  /** Coque de cheveux entre la racine et le sommet, épaissie par touffes. */
  const shell = (front: number, side: number, backL: number, thick: number, clump: number, seed: number) => {
    const NU = detail ? 128 : 40, NV = detail ? 48 : 16;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NV; j++)
      for (let i = 0; i <= NU; i++) {
        const th = -Math.PI + (i / NU) * Math.PI * 2;
        const line = hairline(th, front, side, backL);
        const v = j / NV;
        const ph = line + (Math.PI / 2 - line) * Math.pow(v, 0.9);
        const edge = smooth(0, 0.22, v);
        const dir = V(Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th));
        const n = noise3(dir.x * 7 + seed, dir.y * 7, dir.z * 7);
        const k = 1 + (thick + clump * (n - 0.5)) * edge + 0.012;
        const p = ell(th, ph, k);
        pos.push(p.x, p.y, p.z);
        uv.push((i / NU) * 8, v * 2.5);
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
  const ribbons = (list: THREE.Vector3[][], width: () => number, color: () => THREE.Color) => {
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const pts of list) {
      const curve = new THREE.CatmullRomCurve3(pts);
      const N = 10;
      const w0 = width();
      const cc = color();
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
    }
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
  const shade = (k: number) => hair.clone().lerp(k > 0 ? hl : new THREE.Color('#000'), Math.min(0.35, Math.abs(k) * 0.45));

  if (style === 'cap') {
    // Cheveux courts visibles sous la casquette (tempes, nuque).
    g.add(shell(phTop - 0.14, -0.05, -0.62, 0.035, 0.03, 3));
    g.add(buildCap(ell, phTop, capColor, logo));
    return g;
  }

  if (style === 'fringe') {
    // Coupe courte, frange peignée vers l'avant qui descend sur le front.
    g.add(shell(phTop - 0.13, -0.08, -0.55, 0.09, 0.08, 11));
    const list: THREE.Vector3[][] = [];
    for (let i = 0; i < (detail ? 700 : 40); i++) {
      const th = (rr() * 2 - 1) * 1.05;
      const ph0 = phTop + 0.25 + rr() * 0.45;
      const sway = (rr() - 0.4) * 0.25;
      const tipPh = phTop - 0.13 - rr() * 0.06 * (1 - Math.abs(th) * 0.6);
      const root = ell(th, ph0, 1.085);
      const mid = ell(th + sway * 0.5, (ph0 + tipPh) / 2, 1.095 + rr() * 0.01);
      const tip = ell(th + sway, tipPh, 1.03 + rr() * 0.01);
      list.push([root, mid, tip]);
    }
    g.add(ribbons(list, () => 0.0018 + rr() * 0.0024, () => shade((rr() - 0.3) * 0.9)));
    return g;
  }

  if (style === 'curly') {
    g.add(shell(phTop + 0.02, 0.08, -0.5, 0.11, 0.08, 5));
    const curls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), hairMat, 520);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 520; i++) {
      const th = (rr() * 2 - 1) * Math.PI;
      const line = hairline(th, phTop + 0.02, 0.08, -0.5);
      const ph = line + rr() * (Math.PI / 2 - line);
      const sc = 0.008 + rr() * 0.007;
      m4.compose(ell(th, ph, 1.07 + rr() * 0.03), new THREE.Quaternion(), V(sc, sc, sc));
      curls.setMatrixAt(i, m4);
    }
    curls.castShadow = true;
    g.add(curls);
    return g;
  }

  if (style === 'long') {
    g.add(shell(phTop + 0.04, 0.1, -0.55, 0.09, 0.05, 9));
    const list: THREE.Vector3[][] = [];
    for (let i = 0; i < 260; i++) {
      const th = (rr() > 0.5 ? 1 : -1) * (0.9 + rr() * 2.2);
      const root = ell(th, 0.6 + rr() * 0.6, 1.04);
      const mid = ell(th * 1.02, -0.2, 1.12);
      const tip = ell(th * 1.05, -0.9, 1.1).add(V(0, -0.08 - rr() * 0.05, -0.01));
      list.push([root, mid, tip]);
    }
    g.add(ribbons(list, () => 0.009 + rr() * 0.005, () => shade((rr() - 0.4) * 0.7)));
    return g;
  }

  // Court (par défaut) : dégradé sur les côtés, un peu de volume dessus.
  g.add(shell(phTop + 0.02, -0.02, -0.55, 0.05, 0.035, 1));
  const top: THREE.Vector3[][] = [];
  for (let i = 0; i < (detail ? 700 : 30); i++) {
    const th = (rr() * 2 - 1) * 0.9;
    const ph = phTop + 0.15 + rr() * 0.7;
    const root = ell(th, ph, 1.05);
    const tip = ell(th + (rr() - 0.5) * 0.2, ph - 0.12 - rr() * 0.15, 1.065);
    top.push([root, root.clone().lerp(tip, 0.5).add(root.clone().sub(s.c).normalize().multiplyScalar(0.004)), tip]);
  }
  g.add(ribbons(top, () => 0.002 + rr() * 0.0025, () => shade((rr() - 0.3) * 0.8)));
  return g;
}

/** Casquette : calotte à six panneaux (coutures, logo du club), bouton, visière incurvée. */
function buildCap(ell: (th: number, ph: number, k: number) => THREE.Vector3, phTop: number, color: THREE.Color, logo: Img | null) {
  const g = new THREE.Group();
  const W = 1024, H = 512;
  const { c: cv, g: cg } = canvas(W, H);
  cg.fillStyle = `#${color.getHexString()}`;
  cg.fillRect(0, 0, W, H);
  cg.globalAlpha = 0.08;
  for (let y = 0; y < H; y += 3) {
    cg.fillStyle = y % 6 ? '#000' : '#fff';
    cg.fillRect(0, y, W, 1);
  }
  cg.globalAlpha = 1;
  cg.strokeStyle = 'rgba(0,0,0,0.45)';
  cg.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const x = ((i + 0.5) / 6) * W;
    cg.beginPath();
    cg.moveTo(x, 0);
    cg.lineTo(x, H);
    cg.stroke();
  }
  if (logo) {
    const lw = 150;
    const lh = (logo.height / logo.width) * lw;
    cg.drawImage(logo, W / 2 - lw / 2, H * 0.6 - lh / 2, lw, lh);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.85, sheen: 0.5, sheenColor: color.clone().lerp(new THREE.Color('#fff'), 0.3), side: THREE.DoubleSide });
  const rim = (th: number) => {
    const cf = Math.max(0, Math.cos(th));
    return (phTop - 0.2) * Math.pow(cf, 1.2) + 0.0 * (1 - Math.pow(cf, 1.2));
  };
  const NU = 96, NV = 30;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NV; j++)
    for (let i = 0; i <= NU; i++) {
      const th = -Math.PI + (i / NU) * Math.PI * 2;
      const v = j / NV;
      const line = rim(th);
      const ph = line + (Math.PI / 2 - line) * v;
      const k = 1.075 + 0.025 * Math.sin(v * Math.PI) - 0.015 * v;
      const p = ell(th, ph, k);
      pos.push(p.x, p.y, p.z);
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
  button.position.copy(ell(0, Math.PI / 2, 1.07));
  g.add(button);
  const visorMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, sheen: 0.4 });
  const VN = 32, VR = 8;
  const vp: number[] = [], vi: number[] = [];
  for (let j = 0; j <= VR; j++)
    for (let i = 0; i <= VN; i++) {
      const th = -1.05 + (i / VN) * 2.1;
      const rr = j / VR;
      const base = ell(th, rim(th) + 0.01, 1.08);
      const fwd = V(Math.sin(th) * 0.35, 0, 1).normalize();
      const len = 0.075 * Math.cos(th * 0.75);
      const p = base.add(fwd.multiplyScalar(len * rr)).add(V(0, -0.012 * rr * rr - 0.01 * Math.pow(Math.abs(th), 2) * rr, 0));
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
