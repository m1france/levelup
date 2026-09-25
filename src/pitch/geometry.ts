import type { ExerciseData, FieldPreset, ItemKind } from '../lib/types';

export type Vec = [number, number];

export const PRESETS: Record<FieldPreset, { label: string; hint: string; w: number; h: number }> = {
  foot5: { label: 'Foot à 5', hint: 'U6 – U9 · 35 × 25 m', w: 35, h: 25 },
  foot8: { label: 'Foot à 8', hint: 'U10 – U13 · 60 × 45 m', w: 60, h: 45 },
  half: { label: 'Demi-terrain', hint: 'à 11 · 52 × 68 m', w: 52.5, h: 68 },
  full: { label: 'Terrain à 11', hint: '105 × 68 m', w: 105, h: 68 },
  square: { label: 'Carré d’atelier', hint: '20 × 20 m', w: 20, h: 20 },
  free: { label: 'Zone libre', hint: 'dimensions au choix', w: 30, h: 20 },
};

export const COLORS: Record<string, { hex: string; label: string; ink: string }> = {
  blue: { hex: '#3b5bdb', label: 'Bleu', ink: '#fff' },
  red: { hex: '#e03131', label: 'Rouge', ink: '#fff' },
  yellow: { hex: '#f5c518', label: 'Jaune', ink: '#1c1c1c' },
  green: { hex: '#2b8a3e', label: 'Vert', ink: '#fff' },
  orange: { hex: '#f76707', label: 'Orange', ink: '#fff' },
  purple: { hex: '#7048e8', label: 'Violet', ink: '#fff' },
  pink: { hex: '#e64980', label: 'Rose', ink: '#fff' },
  white: { hex: '#f4f4f0', label: 'Blanc', ink: '#1c1c1c' },
  black: { hex: '#25262b', label: 'Noir', ink: '#fff' },
};
export const PLAYER_COLORS = ['blue', 'red', 'yellow', 'green', 'orange', 'purple', 'white', 'black'];
export const colorHex = (c?: string, fallback = 'blue') => (COLORS[c ?? fallback] ?? COLORS[fallback]).hex;

export const ITEM_LABELS: Record<ItemKind, string> = {
  player: 'Joueur',
  coach: 'Éducateur',
  ball: 'Ballon',
  cone: 'Coupelle',
  marker: 'Plot',
  pole: 'Piquet',
  hoop: 'Cerceau',
  hurdle: 'Haie',
  ladder: 'Échelle',
  minigoal: 'Mini-but',
  goal: 'But',
  dummy: 'Mannequin',
  zone: 'Zone',
  flag: 'Drapeau',
  rebounder: 'Rebondisseur',
  wall: 'Mur',
  ballbag: 'Sac de ballons',
  text: 'Texte',
  measure: 'Mesure',
};

export const THEMES = [
  'Échauffement', 'Coordination', 'Conduite', 'Passe', 'Dribble / 1c1', 'Tir', 'Jeu', 'Défense', 'Gardien', 'Retour au calme',
];

/** Taille des éléments : relative au terrain pour rester lisible de 20 m à 105 m. */
export const itemUnit = (f: { w: number; h: number }) => Math.min(2.8, Math.max(0.5, Math.max(f.w, f.h) / 36));

export interface View {
  /** Pixels CSS par mètre. */
  s: number;
  ox: number;
  oy: number;
  /** Terrain tourné de 90° pour remplir un écran en portrait. */
  rot: boolean;
  width: number;
  height: number;
  fw: number;
  fh: number;
  pad: number;
}

export function computeView(field: { w: number; h: number }, width: number, height: number, allowRotate = true, padM?: number): View {
  const pad = padM ?? Math.max(field.w, field.h) * 0.04 + 0.6;
  const W = field.w + pad * 2;
  const H = field.h + pad * 2;
  const s1 = Math.min(width / W, height / H);
  const s2 = Math.min(width / H, height / W);
  const rot = allowRotate && s2 > s1 * 1.12;
  const s = rot ? s2 : s1;
  const drawnW = (rot ? H : W) * s;
  const drawnH = (rot ? W : H) * s;
  return { s, rot, width, height, fw: field.w, fh: field.h, pad, ox: (width - drawnW) / 2 + pad * s, oy: (height - drawnH) / 2 + pad * s };
}

export function toScreen(v: View, x: number, y: number): Vec {
  return v.rot ? [v.ox + (v.fh - y) * v.s, v.oy + x * v.s] : [v.ox + x * v.s, v.oy + y * v.s];
}

export function toWorld(v: View, sx: number, sy: number): Vec {
  return v.rot ? [(sy - v.oy) / v.s, v.fh - (sx - v.ox) / v.s] : [(sx - v.ox) / v.s, (sy - v.oy) / v.s];
}

/** Applique la transformation monde → écran au contexte canvas (en tenant compte du DPR). */
export function applyView(ctx: CanvasRenderingContext2D, v: View, dpr: number) {
  if (v.rot) {
    ctx.setTransform(0, v.s * dpr, -v.s * dpr, 0, (v.ox + v.fh * v.s) * dpr, v.oy * dpr);
  } else {
    ctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, v.ox * dpr, v.oy * dpr);
  }
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpV = (a: Vec, b: Vec, t: number): Vec => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

export function distToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker : simplifie un tracé au doigt. */
export function simplify(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

export function polyLength(pts: Vec[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Courbe Catmull-Rom échantillonnée : tracés arrondis et naturels. */
export function smooth(pts: Vec[], perSeg = 10): Vec[] {
  if (pts.length < 3) return pts;
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function emptyExercise(): ExerciseData {
  return {
    title: '',
    objective: '',
    instructions: '',
    easier: '',
    harder: '',
    themes: [],
    duration: 10,
    players: 8,
    field: { preset: 'square', w: 20, h: 20 },
    items: [],
    paths: [],
    frames: [{ id: 'f0', dur: 0, pos: {}, owner: {} }],
  };
}

/** Matériel nécessaire, compté à partir du schéma. */
export function equipmentOf(ex: Pick<ExerciseData, 'items'>) {
  const counts = new Map<string, number>();
  const bibs = new Map<string, number>();
  for (const it of ex.items) {
    if (it.kind === 'zone' || it.kind === 'coach' || it.kind === 'text' || it.kind === 'measure') continue;
    if (it.kind === 'player') {
      const c = it.color ?? 'blue';
      bibs.set(c, (bibs.get(c) ?? 0) + 1);
      continue;
    }
    counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  }
  const order: ItemKind[] = [
    'ball', 'ballbag', 'cone', 'marker', 'pole', 'flag', 'hoop', 'hurdle', 'ladder', 'minigoal', 'goal', 'rebounder', 'dummy', 'wall',
  ];
  const list = order.filter((k) => counts.has(k)).map((k) => ({ kind: k, label: ITEM_LABELS[k], count: counts.get(k)! }));
  return { list, bibs: [...bibs.entries()].map(([color, count]) => ({ color, count })) };
}

export function pluralize(n: number, word: string) {
  if (n <= 1) return `${n} ${word.toLowerCase()}`;
  const w = word.toLowerCase();
  const irregular: Record<string, string> = { cerceau: 'cerceaux', 'sac de ballons': 'sacs de ballons', drapeau: 'drapeaux' };
  return `${n} ${irregular[w] ?? (w.endsWith('s') || w.endsWith('x') ? w : `${w}s`)}`;
}
