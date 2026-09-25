import type { ExerciseData, Frame } from '../lib/types';
import { itemUnit, lerpV, type Vec } from './geometry';

export type Positions = Map<string, Vec>;

export interface Timeline {
  /** Position de repos de chaque élément à chaque étape. */
  rest: Positions[];
  owners: Map<string, string | null>[];
  /** Instant (ms) où chaque étape est atteinte. */
  at: number[];
  total: number;
  ballOffset: Vec;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 2;

export function ballOffsetFor(ex: Pick<ExerciseData, 'field'>): Vec {
  const u = itemUnit(ex.field);
  return [0.78 * u, 0.28 * u];
}

export function buildTimeline(ex: ExerciseData): Timeline {
  const off = ballOffsetFor(ex);
  const balls = ex.items.filter((i) => i.kind === 'ball');
  const others = ex.items.filter((i) => i.kind !== 'ball');
  const rest: Positions[] = [];
  const owners: Map<string, string | null>[] = [];
  const at: number[] = [];
  let t = 0;
  ex.frames.forEach((f, k) => {
    const prev = rest[k - 1];
    const pos: Positions = new Map();
    for (const it of others) pos.set(it.id, k === 0 ? [it.x, it.y] : (f.pos[it.id] ?? prev.get(it.id)!));
    const own = new Map(k === 0 ? [] : owners[k - 1]);
    for (const [b, p] of Object.entries(f.owner)) own.set(b, p);
    for (const b of balls) {
      const o = own.get(b.id);
      const op = o ? pos.get(o) : undefined;
      if (op) pos.set(b.id, [op[0] + off[0], op[1] + off[1]]);
      else pos.set(b.id, k === 0 ? [b.x, b.y] : (f.pos[b.id] ?? prev.get(b.id)!));
    }
    t += k === 0 ? 0 : Math.max(100, f.dur);
    rest.push(pos);
    owners.push(own);
    at.push(t);
  });
  return { rest, owners, at, total: t, ballOffset: off };
}

function sampleTrack(track: [number, number, number][], p: number): Vec {
  if (p <= track[0][2]) return [track[0][0], track[0][1]];
  for (let i = 1; i < track.length; i++) {
    const b = track[i];
    if (p <= b[2]) {
      const a = track[i - 1];
      const u = b[2] > a[2] ? (p - a[2]) / (b[2] - a[2]) : 1;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    }
  }
  const l = track[track.length - 1];
  return [l[0], l[1]];
}

/** Positions de tous les éléments pendant la transition vers l'étape k (p ∈ 0..1). */
export function interpolate(ex: ExerciseData, tl: Timeline, k: number, p: number): Positions {
  if (k <= 0) return tl.rest[0];
  if (p >= 1) return tl.rest[k];
  const f: Frame = ex.frames[k];
  const a = tl.rest[k - 1];
  const b = tl.rest[k];
  const out: Positions = new Map();
  const e = easeInOut(p);
  const nonBall = (id: string): Vec => {
    const tr = f.track?.[id];
    if (tr && tr.length) return sampleTrack(tr, p);
    return lerpV(a.get(id)!, b.get(id)!, e);
  };
  for (const it of ex.items) if (it.kind !== 'ball') out.set(it.id, nonBall(it.id));
  const off = tl.ballOffset;
  for (const it of ex.items) {
    if (it.kind !== 'ball') continue;
    const tr = f.track?.[it.id];
    if (tr && tr.length) {
      out.set(it.id, sampleTrack(tr, p));
      continue;
    }
    const o0 = tl.owners[k - 1].get(it.id) ?? null;
    const o1 = tl.owners[k].get(it.id) ?? null;
    if (o0 && o0 === o1 && out.has(o0)) {
      const op = out.get(o0)!;
      out.set(it.id, [op[0] + off[0], op[1] + off[1]]);
    } else {
      out.set(it.id, lerpV(a.get(it.id)!, b.get(it.id)!, easeOut(p)));
    }
  }
  return out;
}

/** Positions à l'instant t (ms) de l'animation complète. */
export function evaluate(ex: ExerciseData, tl: Timeline, t: number): { pos: Positions; k: number; p: number } {
  if (t <= 0 || tl.at.length < 2) return { pos: tl.rest[0], k: 0, p: 1 };
  for (let k = 1; k < tl.at.length; k++) {
    if (t < tl.at[k]) {
      const p = (t - tl.at[k - 1]) / (tl.at[k] - tl.at[k - 1]);
      return { pos: interpolate(ex, tl, k, p), k, p };
    }
  }
  const last = tl.at.length - 1;
  return { pos: tl.rest[last], k: last, p: 1 };
}
