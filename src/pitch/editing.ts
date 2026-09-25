import type { ExerciseData, Item, ItemKind, Path, PathKind } from '../lib/types';
import type { Positions } from './anim';
import { dist, distToSegment, itemUnit, polyLength, simplify, smooth, type Vec } from './geometry';
import { layerOf, selectionRadius } from './render';

let seq = 0;
export const shortId = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const snapV = (p: Vec, on: boolean, step = 0.5): Vec => (on ? [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step] : p);

export const clampToField = (ex: ExerciseData, p: Vec): Vec => {
  const m = Math.max(ex.field.w, ex.field.h) * 0.04 + 0.4;
  return [Math.max(-m, Math.min(ex.field.w + m, p[0])), Math.max(-m, Math.min(ex.field.h + m, p[1]))];
};

/** Déplace un élément à l'étape k (k = 0 : position de départ). */
export function setPos(ex: ExerciseData, k: number, id: string, p: Vec) {
  if (k === 0) {
    const it = ex.items.find((i) => i.id === id);
    if (it) {
      it.x = p[0];
      it.y = p[1];
    }
  } else {
    ex.frames[k].pos[id] = [p[0], p[1]];
  }
}

export function setOwner(ex: ExerciseData, k: number, ball: string, player: string | null) {
  ex.frames[k].owner[ball] = player;
}

const ATTACH_KINDS: ItemKind[] = ['player', 'coach'];

/** Joueur le plus proche capable de recevoir le ballon. */
export function attachTarget(ex: ExerciseData, pos: Positions, p: Vec): string | null {
  const u = itemUnit(ex.field);
  let best: string | null = null;
  let bestD = 1.5 * u;
  for (const it of ex.items) {
    if (!ATTACH_KINDS.includes(it.kind)) continue;
    const q = pos.get(it.id);
    if (!q) continue;
    const d = dist(q, p);
    if (d < bestD) {
      bestD = d;
      best = it.id;
    }
  }
  return best;
}

export function itemAt(ex: ExerciseData, pos: Positions, p: Vec, pxPerM: number): Item | null {
  const u = itemUnit(ex.field);
  const minR = 16 / pxPerM;
  // Score = distance relative au rayon : on attrape l'élément dont on vise le mieux le centre
  // (un joueur porteur plutôt que le ballon collé à lui). À score égal, le calque supérieur gagne.
  let best: { it: Item; score: number; z: number } | null = null;
  for (const it of ex.items) {
    const q = pos.get(it.id) ?? [it.x, it.y];
    let score: number;
    if (it.kind === 'zone') {
      // Une zone ne s'attrape que par son bord : on peut toujours poser des éléments dedans.
      const w = it.w ?? 6;
      const h = it.h ?? 6;
      const dx = Math.abs(p[0] - q[0]);
      const dy = Math.abs(p[1] - q[1]);
      if (dx > w / 2 + 0.3 * u || dy > h / 2 + 0.3 * u) continue;
      const edge = Math.min(Math.abs(dx - w / 2), Math.abs(dy - h / 2));
      const tol = Math.max(0.6 * u, 14 / pxPerM);
      if (edge > tol) continue;
      score = 1 + edge / tol;
    } else if (it.kind === 'measure') {
      const [a, b] = measureEnds(it, q);
      const tol = Math.max(0.5 * u, 12 / pxPerM);
      const d = distToSegment(p, a, b);
      if (d > tol) continue;
      score = 0.5 + d / tol;
    } else {
      const r = Math.max(selectionRadius(it, u), minR);
      const d = dist(q, p);
      if (d > r) continue;
      score = d / r;
    }
    const z = layerOf(it);
    if (!best || score < best.score - 0.05 || (Math.abs(score - best.score) <= 0.05 && z > best.z)) best = { it, score, z };
  }
  return best?.it ?? null;
}

/** Extrémités d'une mesure (segment centré sur sa position). */
export function measureEnds(it: Item, c: Vec = [it.x, it.y]): [Vec, Vec] {
  const a = ((it.rot ?? 0) * Math.PI) / 180;
  const h = (it.w ?? 5) / 2;
  return [
    [c[0] - Math.cos(a) * h, c[1] - Math.sin(a) * h],
    [c[0] + Math.cos(a) * h, c[1] + Math.sin(a) * h],
  ];
}

export function pathPoints(path: Path): Vec[] {
  return path.kind === 'pass' || path.kind === 'shot' ? [path.pts[0], path.pts[path.pts.length - 1]] : smooth(path.pts, 8);
}

export function pathAt(ex: ExerciseData, p: Vec, pxPerM: number): Path | null {
  const u = itemUnit(ex.field);
  const tol = Math.max(0.4 * u, 12 / pxPerM);
  let best: Path | null = null;
  let bestD = tol;
  for (const path of ex.paths) {
    const pts = pathPoints(path);
    for (let i = 1; i < pts.length; i++) {
      const d = distToSegment(p, pts[i - 1], pts[i]);
      if (d < bestD) {
        bestD = d;
        best = path;
      }
    }
  }
  return best;
}

/** Reconnaît le type de tracé : trait droit = passe, trait sinueux = conduite. */
export function finishPath(raw: Vec[], kind: PathKind | 'auto', u: number): Path | null {
  if (raw.length < 2 || polyLength(raw) < Math.max(0.8, 0.9 * u)) return null;
  const simple = simplify(raw, 0.18 * u);
  const chord = dist(raw[0], raw[raw.length - 1]);
  const straightness = chord / polyLength(raw);
  let k: PathKind = kind === 'auto' ? (straightness > 0.94 ? 'pass' : 'dribble') : kind;
  if (kind === 'auto' && straightness > 0.94 && simple.length <= 2) k = 'pass';
  const pts: [number, number][] = k === 'pass' || k === 'shot' ? [raw[0], raw[raw.length - 1]] : simple;
  return { id: shortId('l'), kind: k, pts: pts.map((q) => [round(q[0]), round(q[1])]) };
}

export const round = (n: number) => Math.round(n * 100) / 100;

export function deleteIds(ex: ExerciseData, ids: Set<string>) {
  ex.items = ex.items.filter((i) => !ids.has(i.id));
  ex.paths = ex.paths.filter((p) => !ids.has(p.id));
  for (const f of ex.frames) {
    for (const id of ids) {
      delete f.pos[id];
      delete f.owner[id];
      if (f.track) delete f.track[id];
    }
    for (const [b, p] of Object.entries(f.owner)) if (p && ids.has(p)) f.owner[b] = null;
  }
}

export function duplicateIds(ex: ExerciseData, ids: Set<string>, offset: Vec): Set<string> {
  const created = new Set<string>();
  for (const it of ex.items.filter((i) => ids.has(i.id))) {
    const id = shortId(it.kind[0]);
    ex.items.push({ ...it, id, x: round(it.x + offset[0]), y: round(it.y + offset[1]) });
    created.add(id);
  }
  for (const p of ex.paths.filter((q) => ids.has(q.id))) {
    const id = shortId('l');
    ex.paths.push({ ...p, id, pts: p.pts.map(([x, y]) => [round(x + offset[0]), round(y + offset[1])]) });
    created.add(id);
  }
  return created;
}

export function nextLabel(ex: ExerciseData, color: string) {
  const used = new Set(ex.items.filter((i) => i.kind === 'player' && (i.color ?? 'blue') === color).map((i) => i.label));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** Éléments dont on peut changer la couleur. */
export const COLORABLE = new Set<ItemKind>([
  'player', 'coach', 'cone', 'marker', 'pole', 'hoop', 'hurdle', 'zone', 'ladder', 'dummy', 'wall', 'flag', 'rebounder', 'minigoal', 'text', 'measure',
]);

export function newItem(ex: ExerciseData, kind: ItemKind, p: Vec, color?: string): Item {
  const it: Item = { id: shortId(kind[0]), kind, x: round(p[0]), y: round(p[1]) };
  if (kind === 'player') {
    it.color = color ?? 'blue';
    it.label = nextLabel(ex, it.color);
  } else if (color && COLORABLE.has(kind)) {
    it.color = color;
  }
  if (kind === 'goal' || kind === 'minigoal' || kind === 'rebounder') it.rot = p[0] < ex.field.w / 2 ? 180 : 0;
  if (kind === 'zone') {
    it.w = 8;
    it.h = 8;
  }
  if (kind === 'text') it.label = 'Texte';
  if (kind === 'measure') it.w = 5;
  return it;
}

/** Mesure tracée d'un point à un autre. */
export function measureBetween(ex: ExerciseData, a: Vec, b: Vec, color?: string): Item {
  const it = newItem(ex, 'measure', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], color);
  it.w = round(dist(a, b));
  it.rot = Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
  return it;
}

/** n éléments répartis sur un cercle (centre → point du bord). */
export function circlePoints(c: Vec, edge: Vec, n: number): Vec[] {
  const r = dist(c, edge);
  const a0 = Math.atan2(edge[1] - c[1], edge[0] - c[0]);
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i * Math.PI * 2) / n;
    return [round(c[0] + Math.cos(a) * r), round(c[1] + Math.sin(a) * r)] as Vec;
  });
}

/** Slalom : n piquets en zigzag entre deux points. */
export function slalomPoints(a: Vec, b: Vec, n: number, amp: number): Vec[] {
  const l = dist(a, b) || 1;
  const nx = -(b[1] - a[1]) / l;
  const ny = (b[0] - a[0]) / l;
  return distribute(a, b, n).map((p, i) => {
    const o = (i % 2 ? 1 : -1) * amp;
    return [round(p[0] + nx * o), round(p[1] + ny * o)] as Vec;
  });
}

/** Quadrillage de coupelles dans un rectangle, espacées d'environ `step` mètres. */
export function gridPoints(a: Vec, b: Vec, step: number): Vec[] {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const w = Math.abs(a[0] - b[0]);
  const h = Math.abs(a[1] - b[1]);
  const nx = Math.max(1, Math.round(w / step));
  const ny = Math.max(1, Math.round(h / step));
  const out: Vec[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) out.push([round(x0 + (w * i) / nx), round(y0 + (h * j) / ny)]);
  return out.length > 200 ? out.slice(0, 200) : out;
}

/** Tout ce qui touche un rectangle de sélection : éléments (zones par leur centre) et tracés. */
export function idsInRect(ex: ExerciseData, pos: Positions, a: Vec, b: Vec): string[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const inside = (p: Vec) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const ids: string[] = [];
  for (const it of ex.items) {
    const p = pos.get(it.id) ?? [it.x, it.y];
    if (it.kind === 'measure' ? measureEnds(it, p).some(inside) || inside(p) : inside(p)) ids.push(it.id);
  }
  for (const path of ex.paths) if (pathPoints(path).some(inside)) ids.push(path.id);
  return ids;
}

/** Répartit n éléments entre deux points (ligne de coupelles, slalom…). */
export function distribute(a: Vec, b: Vec, n: number): Vec[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => [round(a[0] + ((b[0] - a[0]) * i) / (n - 1)), round(a[1] + ((b[1] - a[1]) * i) / (n - 1))] as Vec);
}

export function rectCorners(a: Vec, b: Vec): Vec[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Position effective d'un ballon : suit-il un joueur à l'étape k ? */
export function ownerAt(ex: ExerciseData, k: number, ball: string): string | null {
  for (let j = k; j >= 0; j--) if (ball in ex.frames[j].owner) return ex.frames[j].owner[ball];
  return null;
}
