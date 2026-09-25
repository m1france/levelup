import type { ExerciseData, Item, Path } from '../lib/types';
import type { Positions } from './anim';
import { COLORS, applyView, colorHex, itemUnit, polyLength, smooth, type Vec, type View } from './geometry';

export interface RenderOptions {
  view: View;
  dpr: number;
  pos: Positions;
  showPaths?: boolean;
  /** Éléments et tracés sélectionnés (éditeur). */
  selected?: Set<string>;
  /** Positions fantômes de l'étape précédente (éditeur). */
  ghost?: Positions;
  /** Aperçu pendant un tracé ou un outil « ligne ». */
  draft?: { path?: Path; items?: Item[]; rect?: [Vec, Vec] };
  /** Couleur de fond de tout le canvas (export vidéo). */
  bg?: string;
  /** Couleurs du terrain (ex. version sombre pour la une de l'accueil). */
  palette?: Partial<PitchPalette>;
}

export interface PitchPalette { grass: string; grass2: string; surround: string; line: string }
const DEFAULT_PALETTE: PitchPalette = { grass: '#3f7f56', grass2: '#44875c', surround: '#37714c', line: 'rgba(255,255,255,0.86)' };
export const HERO_PALETTE: Partial<PitchPalette> = { grass: '#1f5446', grass2: '#225a4b', surround: 'transparent', line: 'rgba(214,244,190,0.38)' };

function pitch(ctx: CanvasRenderingContext2D, ex: ExerciseData, v: View, pal: PitchPalette) {
  const { grass: GRASS, grass2: GRASS_2, surround: SURROUND, line: LINE } = pal;
  const { w, h, preset } = ex.field;
  const lw = 1.6 / v.s;
  const pad = v.pad;
  if (SURROUND !== 'transparent') {
    ctx.fillStyle = SURROUND;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
  }
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, w, h);
  // Bandes de tonte
  const stripes = preset === 'free' || preset === 'square' ? Math.max(4, Math.round(w / 5)) : 12;
  ctx.fillStyle = GRASS_2;
  for (let i = 0; i < stripes; i += 2) ctx.fillRect((w / stripes) * i, 0, w / stripes, h);

  ctx.strokeStyle = LINE;
  ctx.fillStyle = LINE;
  ctx.lineWidth = lw;
  ctx.setLineDash([]);
  if (preset === 'free') {
    ctx.setLineDash([6 / v.s, 6 / v.s]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(0, 0, w, h);
    ctx.setLineDash([]);
    return;
  }
  ctx.strokeRect(0, 0, w, h);
  if (preset === 'square') return;

  const spot = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.18, 2 / v.s), 0, Math.PI * 2);
    ctx.fill();
  };
  const box = (depth: number, width: number, side: 0 | 1) => {
    const x = side === 0 ? 0 : w - depth;
    ctx.strokeRect(x, (h - width) / 2, depth, width);
  };

  if (preset === 'half') {
    // Moitié de terrain : but à gauche, ligne médiane à droite.
    ctx.beginPath();
    ctx.arc(w, h / 2, 9.15, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.stroke();
    spot(w, h / 2);
    box(16.5, 40.32, 0);
    box(5.5, 18.32, 0);
    spot(11, h / 2);
    ctx.beginPath();
    ctx.arc(11, h / 2, 9.15, -0.925, 0.925);
    ctx.stroke();
    return;
  }

  const dims = {
    foot5: { r: 4, pa: [6, 12] as const, ga: null, pk: 6 },
    foot8: { r: 6, pa: [13, 26] as const, ga: [5, 12] as const, pk: 9 },
    full: { r: 9.15, pa: [16.5, 40.32] as const, ga: [5.5, 18.32] as const, pk: 11 },
  }[preset as 'foot5' | 'foot8' | 'full'];

  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, dims.r, 0, Math.PI * 2);
  ctx.stroke();
  spot(w / 2, h / 2);
  for (const side of [0, 1] as const) {
    box(dims.pa[0], dims.pa[1], side);
    if (dims.ga) box(dims.ga[0], dims.ga[1], side);
    spot(side === 0 ? dims.pk : w - dims.pk, h / 2);
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, size: number) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(a - 0.45), to[1] - size * Math.sin(a - 0.45));
  ctx.lineTo(to[0] - size * Math.cos(a + 0.45), to[1] - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Point d'une polyligne à une distance donnée depuis le début. */
function walk(pts: Vec[], d: number): { p: Vec; dir: Vec } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= d && l > 0) {
      const t = (d - acc) / l;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    }
    acc += l;
  }
  const n = pts.length;
  const a = pts[n - 2] ?? pts[0];
  const b = pts[n - 1];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: b, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
}

export const PATH_STYLE: Record<Path['kind'], { label: string; color: string }> = {
  pass: { label: 'Passe', color: '#ffffff' },
  dribble: { label: 'Conduite', color: '#ffffff' },
  run: { label: 'Course', color: '#ffffff' },
  shot: { label: 'Tir', color: '#ffd43b' },
};

export function drawPath(ctx: CanvasRenderingContext2D, path: Path, v: View, u: number, selected = false, alpha = 1) {
  if (path.pts.length < 2) return;
  const px = 1 / v.s;
  const color = path.color ? colorHex(path.color) : PATH_STYLE[path.kind].color;
  const width = (path.kind === 'shot' ? 3.2 : 2.2) * px * (selected ? 1.6 : 1);
  const head = Math.max(0.45 * u, 9 * px);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const straight = path.kind === 'pass' || path.kind === 'shot';
  const pts: Vec[] = straight ? [path.pts[0], path.pts[path.pts.length - 1]] : smooth(path.pts, 12);
  const len = polyLength(pts);
  const end = walk(pts, Math.max(0, len - head * 0.6));
  const tip = pts[pts.length - 1];

  ctx.beginPath();
  if (path.kind === 'dribble') {
    const amp = 0.2 * u;
    const wave = 1.5 * u;
    const stop = Math.max(0, len - head * 1.2);
    ctx.moveTo(pts[0][0], pts[0][1]);
    const step = Math.max(0.06, wave / 10);
    for (let d = step; d <= stop; d += step) {
      const { p, dir } = walk(pts, d);
      const o = Math.sin((d / wave) * Math.PI * 2) * amp * Math.min(1, d / wave, (stop - d) / wave + 0.2);
      ctx.lineTo(p[0] - dir[1] * o, p[1] + dir[0] * o);
    }
    ctx.lineTo(end.p[0], end.p[1]);
  } else {
    if (path.kind === 'run') ctx.setLineDash([7 * px, 6 * px]);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1, -1)) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(end.p[0], end.p[1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  arrowHead(ctx, [tip[0] - end.dir[0], tip[1] - end.dir[1]], tip, path.kind === 'shot' ? head * 1.25 : head);
  ctx.restore();
}

const FONT = 'ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", sans-serif';

function label(ctx: CanvasRenderingContext2D, v: View, text: string, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  if (v.rot) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, size * 0.04);
  ctx.restore();
}

/** Éclaircit (amt > 0) ou assombrit (amt < 0) une couleur hexadécimale. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number) => Math.round(c + (t - c) * p);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/** Éléments dessinés « debout » : ils restent droits à l'écran quand le terrain pivote. */
const UPRIGHT = new Set<Item['kind']>(['player', 'coach', 'marker', 'pole', 'dummy', 'flag', 'wall', 'text']);

export function drawItem(ctx: CanvasRenderingContext2D, it: Item, p: Vec, v: View, u: number, alpha = 1) {
  const [x, y] = p;
  const px = 1 / v.s;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (it.kind === 'zone') {
    drawZone(ctx, it, x, y, v, u, px, alpha);
  } else if (it.kind === 'measure') {
    drawMeasure(ctx, it, x, y, v, u, px);
  } else {
    ctx.translate(x, y);
    if (v.rot && UPRIGHT.has(it.kind)) ctx.rotate(-Math.PI / 2);
    ctx.rotate(((it.rot ?? 0) * Math.PI) / 180);
    const sc = it.scale ?? 1;
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ART[it.kind]?.(ctx, it, u, px / sc);
  }
  ctx.restore();
}

type Art = (ctx: CanvasRenderingContext2D, it: Item, u: number, px: number) => void;

/* ------------------------------------------------------------------ joueurs & éducateur */

function shirtPath(ctx: CanvasRenderingContext2D, k: number, keeper: boolean) {
  const side = (m: 1 | -1) => {
    ctx.lineTo(m * 0.64 * k, -0.84 * k);
    if (keeper) {
      ctx.lineTo(m * 0.98 * k, -0.52 * k);
      ctx.lineTo(m * 1.06 * k, 0.3 * k);
      ctx.lineTo(m * 0.78 * k, 0.33 * k);
      ctx.lineTo(m * 0.6 * k, -0.26 * k);
    } else {
      ctx.lineTo(m * 1.02 * k, -0.46 * k);
      ctx.lineTo(m * 0.8 * k, -0.14 * k);
      ctx.lineTo(m * 0.6 * k, -0.3 * k);
    }
  };
  ctx.beginPath();
  ctx.moveTo(-0.3 * k, -0.92 * k);
  ctx.quadraticCurveTo(0, -0.62 * k, 0.3 * k, -0.92 * k);
  side(1);
  ctx.lineTo(0.6 * k, 0.82 * k);
  ctx.quadraticCurveTo(0.6 * k, 0.94 * k, 0.48 * k, 0.94 * k);
  ctx.lineTo(-0.48 * k, 0.94 * k);
  ctx.quadraticCurveTo(-0.6 * k, 0.94 * k, -0.6 * k, 0.82 * k);
  // côté gauche, parcouru à l'envers
  if (keeper) {
    ctx.lineTo(-0.6 * k, -0.26 * k);
    ctx.lineTo(-0.78 * k, 0.33 * k);
    ctx.lineTo(-1.06 * k, 0.3 * k);
    ctx.lineTo(-0.98 * k, -0.52 * k);
  } else {
    ctx.lineTo(-0.6 * k, -0.3 * k);
    ctx.lineTo(-0.8 * k, -0.14 * k);
    ctx.lineTo(-1.02 * k, -0.46 * k);
  }
  ctx.lineTo(-0.64 * k, -0.84 * k);
  ctx.closePath();
}

const drawPlayer: Art = (ctx, it, u, px) => {
  const k = 0.88 * u;
  const c = COLORS[it.color ?? 'blue'] ?? COLORS.blue;
  const keeper = !!it.keeper;
  const sec = it.color === 'white' || it.color === 'yellow' ? '#25262b' : '#ffffff';

  // Liseré blanc : se détache sur l'herbe, même pour les maillots verts.
  shirtPath(ctx, k, keeper);
  ctx.strokeStyle = it.color === 'white' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(0.16 * k, 2.4 * px);
  ctx.stroke();
  ctx.fillStyle = c.hex;
  ctx.fill();

  ctx.save();
  ctx.clip();
  const kit = it.kit ?? 'plain';
  ctx.fillStyle = sec;
  ctx.globalAlpha *= 0.92;
  if (kit === 'stripes') for (let i = -3; i <= 3; i += 2) ctx.fillRect((i * 0.2 - 0.1) * k, -k, 0.2 * k, 2 * k);
  if (kit === 'hoops') for (let i = -1; i < 4; i += 2) ctx.fillRect(-1.2 * k, (-0.62 + i * 0.26) * k, 2.4 * k, 0.26 * k);
  if (kit === 'halves') ctx.fillRect(0, -k, 1.2 * k, 2 * k);
  ctx.globalAlpha /= 0.92;
  ctx.restore();

  // Col et poignets
  ctx.strokeStyle = shade(c.hex, -0.35);
  ctx.lineWidth = 0.12 * k;
  ctx.beginPath();
  ctx.moveTo(-0.3 * k, -0.92 * k);
  ctx.quadraticCurveTo(0, -0.62 * k, 0.3 * k, -0.92 * k);
  ctx.stroke();
  shirtPath(ctx, k, keeper);
  ctx.lineWidth = Math.max(0.04 * k, 0.8 * px);
  ctx.stroke();

  if (keeper) {
    for (const m of [-1, 1]) {
      ctx.fillStyle = '#c5ec3f';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(0.04 * k, 0.8 * px);
      ctx.beginPath();
      ctx.ellipse(m * 0.93 * k, 0.46 * k, 0.17 * k, 0.2 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (it.label) {
    const size = (it.label.length > 2 ? 0.58 : 0.8) * k;
    ctx.font = `750 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (kit !== 'plain') {
      // Sur un maillot à motif, le numéro repose sur un écusson uni pour rester lisible.
      const w = Math.max(ctx.measureText(it.label).width + 0.22 * k, 0.62 * k);
      ctx.fillStyle = c.hex;
      ctx.strokeStyle = shade(c.hex, -0.3);
      ctx.lineWidth = Math.max(0.03 * k, 0.6 * px);
      ctx.beginPath();
      ctx.roundRect(-w / 2, 0.14 * k - size * 0.56, w, size * 1.12, 0.14 * k);
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = 0.14 * k;
    ctx.strokeStyle = c.ink === '#fff' ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.55)';
    ctx.strokeText(it.label, 0, 0.14 * k);
    ctx.fillStyle = c.ink;
    ctx.fillText(it.label, 0, 0.14 * k);
  }
};

const SKIN = '#e9b48f';

const drawCoach: Art = (ctx, it, u, px) => {
  const k = 1.08 * u;
  const suit = colorHex(it.color, 'black');
  const dark = shade(suit, -0.35);
  const lw = Math.max(0.035 * k, 0.8 * px);

  // Jambes et chaussures
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-0.27 * k, 0.28 * k, 0.22 * k, 0.64 * k, 0.08 * k);
  ctx.roundRect(0.05 * k, 0.28 * k, 0.22 * k, 0.64 * k, 0.08 * k);
  ctx.fill();
  ctx.fillStyle = '#fafafa';
  ctx.beginPath();
  ctx.ellipse(-0.18 * k, 0.94 * k, 0.15 * k, 0.07 * k, 0, 0, Math.PI * 2);
  ctx.ellipse(0.18 * k, 0.94 * k, 0.15 * k, 0.07 * k, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bras gauche le long du corps
  ctx.strokeStyle = suit;
  ctx.lineWidth = 0.19 * k;
  ctx.beginPath();
  ctx.moveTo(-0.4 * k, -0.28 * k);
  ctx.lineTo(-0.5 * k, 0.28 * k);
  ctx.stroke();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(-0.51 * k, 0.36 * k, 0.09 * k, 0, Math.PI * 2);
  ctx.fill();

  // Veste de survêtement
  ctx.fillStyle = suit;
  ctx.beginPath();
  ctx.moveTo(-0.42 * k, -0.34 * k);
  ctx.quadraticCurveTo(-0.44 * k, -0.46 * k, -0.24 * k, -0.48 * k);
  ctx.lineTo(0.24 * k, -0.48 * k);
  ctx.quadraticCurveTo(0.44 * k, -0.46 * k, 0.42 * k, -0.34 * k);
  ctx.lineTo(0.38 * k, 0.36 * k);
  ctx.lineTo(-0.38 * k, 0.36 * k);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  ctx.stroke();
  // Fermeture éclair et bandes latérales
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(0.03 * k, 0.7 * px);
  ctx.beginPath();
  ctx.moveTo(0, -0.44 * k);
  ctx.lineTo(0, 0.34 * k);
  ctx.moveTo(-0.36 * k, -0.34 * k);
  ctx.lineTo(-0.34 * k, 0.3 * k);
  ctx.stroke();
  ctx.fillStyle = dark;
  ctx.fillRect(-0.38 * k, 0.28 * k, 0.76 * k, 0.08 * k);

  // Sifflet autour du cou
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = Math.max(0.02 * k, 0.6 * px);
  ctx.beginPath();
  ctx.moveTo(-0.13 * k, -0.47 * k);
  ctx.lineTo(-0.16 * k, -0.12 * k);
  ctx.lineTo(-0.05 * k, -0.47 * k);
  ctx.stroke();
  ctx.fillStyle = '#d4d8dd';
  ctx.beginPath();
  ctx.ellipse(-0.16 * k, -0.08 * k, 0.07 * k, 0.05 * k, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Bras droit plié, tenant la plaquette tactique
  ctx.strokeStyle = suit;
  ctx.lineWidth = 0.19 * k;
  ctx.beginPath();
  ctx.moveTo(0.4 * k, -0.28 * k);
  ctx.lineTo(0.48 * k, 0.05 * k);
  ctx.lineTo(0.26 * k, 0.1 * k);
  ctx.stroke();
  ctx.save();
  ctx.translate(0.3 * k, -0.06 * k);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath();
  ctx.roundRect(-0.2 * k, -0.24 * k, 0.4 * k, 0.5 * k, 0.04 * k);
  ctx.fill();
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(-0.16 * k, -0.18 * k, 0.32 * k, 0.4 * k);
  ctx.strokeStyle = '#3f7f56';
  ctx.lineWidth = Math.max(0.02 * k, 0.5 * px);
  ctx.strokeRect(-0.12 * k, -0.13 * k, 0.24 * k, 0.3 * k);
  ctx.beginPath();
  ctx.moveTo(-0.12 * k, 0.02 * k);
  ctx.lineTo(0.12 * k, 0.02 * k);
  ctx.stroke();
  ctx.fillStyle = '#b8bcc2';
  ctx.fillRect(-0.08 * k, -0.27 * k, 0.16 * k, 0.07 * k);
  ctx.restore();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0.22 * k, 0.1 * k, 0.09 * k, 0, Math.PI * 2);
  ctx.fill();

  // Tête et casquette
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -0.7 * k, 0.24 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = suit;
  ctx.beginPath();
  ctx.arc(0, -0.74 * k, 0.25 * k, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.12 * k, -0.74 * k, 0.26 * k, 0.06 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(0, -0.87 * k, 0.035 * k, 0, Math.PI * 2);
  ctx.fill();

  if (it.label) {
    const size = 0.36 * k;
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(it.label).width + 0.28 * k;
    ctx.fillStyle = 'rgba(20,22,21,0.82)';
    ctx.beginPath();
    ctx.roundRect(-w / 2, 1.08 * k, w, 0.46 * k, 0.23 * k);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, 0, 1.32 * k);
  }
};

/* ------------------------------------------------------------------ ballon */

function drawBallAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, px: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  const pent = (cx: number, cy: number, pr: number, a0: number) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i * Math.PI * 2) / 5;
      ctx.lineTo(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#1f2023';
  pent(0, 0, 0.36 * r, -Math.PI / 2);
  ctx.strokeStyle = 'rgba(40,40,44,0.55)';
  ctx.lineWidth = Math.max(0.05 * r, 0.5 * px);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const b = a + Math.PI / 5;
    pent(Math.cos(b) * 1.02 * r, Math.sin(b) * 1.02 * r, 0.34 * r, b + Math.PI);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.36 * r, Math.sin(a) * 0.36 * r);
    ctx.lineTo(Math.cos(a) * 0.78 * r, Math.sin(a) * 0.78 * r);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(0.06 * r, 0.8 * px);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const drawBall: Art = (ctx, _it, u, px) => {
  const r = 0.42 * u;
  drawBallAt(ctx, 0, 0, r, px);
};

const drawBallbag: Art = (ctx, _it, u, px) => {
  const r = 0.26 * u;
  const spots: Vec[] = [[0, 0], [-0.5, -0.1], [0.48, -0.16], [-0.24, 0.44], [0.3, 0.42], [0.04, -0.5], [-0.46, -0.52]];
  for (const [bx, by] of spots) drawBallAt(ctx, bx * u, by * u, r, px);
  // Filet du sac
  ctx.strokeStyle = 'rgba(30,30,30,0.55)';
  ctx.lineWidth = Math.max(0.025 * u, 0.6 * px);
  ctx.beginPath();
  ctx.ellipse(0, -0.02 * u, 0.86 * u, 0.82 * u, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -0.02 * u, 0.86 * u, 0.82 * u, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(30,30,30,0.28)';
  ctx.beginPath();
  for (let d = -1.8; d <= 1.8; d += 0.3) {
    ctx.moveTo((d - 1) * u, -u);
    ctx.lineTo((d + 1) * u, u);
    ctx.moveTo((d + 1) * u, -u);
    ctx.lineTo((d - 1) * u, u);
  }
  ctx.stroke();
  ctx.restore();
  // Cordon de serrage
  ctx.strokeStyle = '#e8e2d0';
  ctx.lineWidth = Math.max(0.05 * u, 1 * px);
  ctx.beginPath();
  ctx.moveTo(0.6 * u, 0.56 * u);
  ctx.quadraticCurveTo(1.0 * u, 0.9 * u, 1.1 * u, 0.62 * u);
  ctx.stroke();
};

/* ------------------------------------------------------------------ petit matériel */

const drawCone: Art = (ctx, it, u, px) => {
  const r = Math.max(0.4 * u, 3 * px);
  const c = colorHex(it.color, 'orange');
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Nervures de la coupelle
  ctx.strokeStyle = shade(c, -0.18);
  ctx.lineWidth = Math.max(0.04 * r, 0.5 * px);
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    ctx.moveTo(Math.cos(a) * 0.52 * r, Math.sin(a) * 0.52 * r);
    ctx.lineTo(Math.cos(a) * 0.9 * r, Math.sin(a) * 0.9 * r);
  }
  ctx.stroke();
  // Trou central : on voit l'herbe à travers.
  ctx.fillStyle = shade(c, -0.3);
  ctx.beginPath();
  ctx.arc(0, 0, 0.46 * r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a7550';
  ctx.beginPath();
  ctx.arc(0.03 * r, 0.04 * r, 0.3 * r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(c, -0.35);
  ctx.lineWidth = Math.max(0.06 * r, 0.7 * px);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
};

const drawMarker: Art = (ctx, it, u, px) => {
  const s = 0.62 * u;
  const c = colorHex(it.color, 'orange');
  // Socle carré en perspective
  ctx.fillStyle = shade(c, -0.28);
  ctx.beginPath();
  ctx.moveTo(-0.86 * s, 0.72 * s);
  ctx.lineTo(0.86 * s, 0.72 * s);
  ctx.lineTo(0.74 * s, 0.92 * s);
  ctx.lineTo(-0.74 * s, 0.92 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(c, -0.1);
  ctx.beginPath();
  ctx.moveTo(-0.72 * s, 0.56 * s);
  ctx.lineTo(0.72 * s, 0.56 * s);
  ctx.lineTo(0.86 * s, 0.72 * s);
  ctx.lineTo(-0.86 * s, 0.72 * s);
  ctx.closePath();
  ctx.fill();
  // Corps conique, éclairé à gauche
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(-0.1 * s, -1.08 * s);
  ctx.quadraticCurveTo(0, -1.16 * s, 0.1 * s, -1.08 * s);
  ctx.lineTo(0.6 * s, 0.66 * s);
  ctx.quadraticCurveTo(0, 0.76 * s, -0.6 * s, 0.66 * s);
  ctx.closePath();
  ctx.fill();
  // Bandes réfléchissantes
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(-s, -0.42 * s, 2 * s, 0.2 * s);
  ctx.fillRect(-s, 0.08 * s, 2 * s, 0.16 * s);
  ctx.restore();
  ctx.strokeStyle = shade(c, -0.4);
  ctx.lineWidth = Math.max(0.03 * s, 0.6 * px);
  ctx.stroke();
};

const drawPole: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'yellow');
  const H = 1.5 * u;
  const W = 0.15 * u;
  // Socle lesté
  ctx.fillStyle = '#26282c';
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.3 * u, 0.1 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a3d42';
  ctx.beginPath();
  ctx.ellipse(0, -0.04 * u, 0.24 * u, 0.07 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tige cylindrique
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.roundRect(-W / 2, -H, W, H - 0.02 * u, W / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const t of [0.22, 0.52]) ctx.fillRect(-W / 2, -H + H * t, W, 0.08 * u);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.02 * u, 0.5 * px);
  ctx.beginPath();
  ctx.roundRect(-W / 2, -H, W, H - 0.02 * u, W / 2);
  ctx.stroke();
};

const drawFlag: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'red');
  const H = 1.7 * u;
  ctx.fillStyle = '#26282c';
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.22 * u, 0.08 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-0.045 * u, -H, 0.09 * u, H);
  // Fanion ondulé
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0.04 * u, -H);
  ctx.bezierCurveTo(0.35 * u, -H - 0.12 * u, 0.6 * u, -H + 0.1 * u, 0.92 * u, -H + 0.02 * u);
  ctx.lineTo(0.92 * u, -H + 0.6 * u);
  ctx.bezierCurveTo(0.6 * u, -H + 0.68 * u, 0.35 * u, -H + 0.46 * u, 0.04 * u, -H + 0.58 * u);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(c, -0.35);
  ctx.lineWidth = Math.max(0.02 * u, 0.5 * px);
  ctx.stroke();
  ctx.fillStyle = '#e8e8e8';
  ctx.beginPath();
  ctx.arc(0, -H, 0.07 * u, 0, Math.PI * 2);
  ctx.fill();
};

const drawHoop: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'yellow');
  const r = 0.75 * u;
  const t = 0.15 * u;
  ctx.strokeStyle = c;
  ctx.lineWidth = t;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  // Raccords du cerceau
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.03 * u, 0.7 * px);
  ctx.beginPath();
  for (const a of [0.3, 2.4, 4.4]) {
    ctx.moveTo(Math.cos(a) * (r - t / 2), Math.sin(a) * (r - t / 2));
    ctx.lineTo(Math.cos(a) * (r + t / 2), Math.sin(a) * (r + t / 2));
  }
  ctx.stroke();
};

const drawHurdle: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'orange');
  const L = 1.3 * u;
  // Pieds (vue de dessus) : deux arceaux de part et d'autre de la barre.
  for (const m of [-1, 1]) {
    ctx.fillStyle = shade(c, -0.3);
    ctx.beginPath();
    ctx.roundRect(-0.34 * u, m * L * 0.5 - 0.07 * u, 0.68 * u, 0.14 * u, 0.07 * u);
    ctx.fill();
  }
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.roundRect(-0.11 * u, -L / 2, 0.22 * u, L, 0.08 * u);
  ctx.fill();
  ctx.strokeStyle = shade(c, -0.4);
  ctx.lineWidth = Math.max(0.025 * u, 0.6 * px);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const t of [-0.18, 0.18]) ctx.fillRect(-0.11 * u, t * L - 0.04 * u, 0.22 * u, 0.08 * u);
};

const drawLadder: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'yellow');
  const L = 5 * u;
  const W = 0.9 * u;
  const n = 9;
  // Sangles latérales
  ctx.strokeStyle = '#2b2d31';
  ctx.lineWidth = Math.max(0.07 * u, 1.2 * px);
  ctx.beginPath();
  ctx.moveTo(-L / 2, -W / 2);
  ctx.lineTo(L / 2, -W / 2);
  ctx.moveTo(-L / 2, W / 2);
  ctx.lineTo(L / 2, W / 2);
  ctx.stroke();
  // Barreaux plats en plastique
  for (let i = 0; i < n; i++) {
    const xx = -L / 2 + (L * (i + 0.5)) / n;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(xx - 0.08 * u, -W / 2 - 0.04 * u, 0.16 * u, W + 0.08 * u, 0.05 * u);
    ctx.fill();
  }
  // Boucles d'extrémité
  ctx.fillStyle = '#2b2d31';
  for (const m of [-1, 1]) for (const n2 of [-1, 1]) {
    ctx.beginPath();
    ctx.arc((m * L) / 2, (n2 * W) / 2, 0.07 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  void px;
};

function netMesh(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, step: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w + h; d += step) {
    ctx.moveTo(x0 + d, y0);
    ctx.lineTo(x0 + d + h, y0 + h);
    ctx.moveTo(x0 + d + h, y0);
    ctx.lineTo(x0 + d, y0 + h);
  }
  ctx.stroke();
  ctx.restore();
}

const drawGoal: Art = (ctx, it, u, px) => {
  const big = it.kind === 'goal';
  const W = (big ? 4 : 2.2) * u;
  const D = (big ? 1.3 : 0.9) * u;
  const frame = colorHex(it.color, 'white');
  const post = Math.max((big ? 0.16 : 0.12) * u, 2 * px);
  // Filet losangé, plus dense au fond
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, -W / 2, D, W);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(0.02 * u, 0.6 * px);
  netMesh(ctx, 0, -W / 2, D, W, Math.max(0.22 * u, 3.5 * px));
  // Montants arrière
  ctx.strokeStyle = shade(frame, -0.25);
  ctx.lineWidth = post * 0.55;
  ctx.beginPath();
  ctx.moveTo(0, -W / 2);
  ctx.lineTo(D, -W / 2);
  ctx.lineTo(D, W / 2);
  ctx.lineTo(0, W / 2);
  ctx.stroke();
  // Barre transversale (ligne de but)
  ctx.beginPath();
  ctx.moveTo(0, -W / 2);
  ctx.lineTo(0, W / 2);
  ctx.strokeStyle = frame;
  ctx.lineWidth = post;
  ctx.stroke();
  // Poteaux
  for (const m of [-1, 1]) {
    ctx.fillStyle = frame;
    ctx.beginPath();
    ctx.arc(0, (m * W) / 2, post * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.02 * u, 0.5 * px);
    ctx.stroke();
  }
};

const drawRebounder: Art = (ctx, it, u, px) => {
  const c = colorHex(it.color, 'blue');
  const W = 2 * u;
  const D = 0.34 * u;
  // Béquilles arrière
  ctx.strokeStyle = '#2b2d31';
  ctx.lineWidth = Math.max(0.06 * u, 1 * px);
  ctx.beginPath();
  for (const m of [-1, 1]) {
    ctx.moveTo(0, (m * W) / 2 - m * 0.1 * u);
    ctx.lineTo(0.62 * u, (m * W) / 2 - m * 0.18 * u);
  }
  ctx.stroke();
  // Toile élastique
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(-D / 2, -W / 2, D, W);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(0.02 * u, 0.5 * px);
  netMesh(ctx, -D / 2, -W / 2, D, W, Math.max(0.16 * u, 3 * px));
  // Cadre
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(0.1 * u, 1.6 * px);
  ctx.beginPath();
  ctx.roundRect(-D / 2, -W / 2, D, W, 0.08 * u);
  ctx.stroke();
};

function mannequin(ctx: CanvasRenderingContext2D, c: string, k: number, px: number) {
  // Silhouette de mannequin d'entraînement, sur pied
  ctx.fillStyle = '#2b2d31';
  ctx.beginPath();
  ctx.ellipse(0, 0.92 * k, 0.34 * k, 0.1 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9ea3a8';
  ctx.fillRect(-0.04 * k, 0.4 * k, 0.08 * k, 0.52 * k);
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(0, -0.72 * k, 0.2 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.14 * k, -0.52 * k);
  ctx.quadraticCurveTo(-0.46 * k, -0.5 * k, -0.44 * k, -0.28 * k);
  ctx.lineTo(-0.3 * k, 0.46 * k);
  ctx.quadraticCurveTo(0, 0.54 * k, 0.3 * k, 0.46 * k);
  ctx.lineTo(0.44 * k, -0.28 * k);
  ctx.quadraticCurveTo(0.46 * k, -0.5 * k, 0.14 * k, -0.52 * k);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(c, -0.4);
  ctx.lineWidth = Math.max(0.03 * k, 0.6 * px);
  ctx.stroke();
}

const drawDummy: Art = (ctx, it, u, px) => {
  const k = 0.95 * u;
  mannequin(ctx, colorHex(it.color, 'yellow'), k, px);
};

const drawWall: Art = (ctx, it, u, px) => {
  const k = 0.8 * u;
  const c = colorHex(it.color, 'yellow');
  const n = 4;
  const gap = 0.96 * k;
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect((-(n - 1) * gap) / 2 - 0.2 * k, 0.86 * k, (n - 1) * gap + 0.4 * k, 0.1 * k);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate((i - (n - 1) / 2) * gap, 0);
    mannequin(ctx, c, k, px);
    ctx.restore();
  }
};

const drawText: Art = (ctx, it, u) => {
  const text = it.label || 'Texte';
  const size = 0.9 * u;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const c = colorHex(it.color, 'white');
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = it.color === 'white' || !it.color ? 'rgba(12,30,20,0.5)' : 'rgba(255,255,255,0.85)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = c;
  ctx.fillText(text, 0, 0);
};

const ART: Partial<Record<Item['kind'], Art>> = {
  player: drawPlayer,
  coach: drawCoach,
  ball: drawBall,
  ballbag: drawBallbag,
  cone: drawCone,
  marker: drawMarker,
  pole: drawPole,
  flag: drawFlag,
  hoop: drawHoop,
  hurdle: drawHurdle,
  ladder: drawLadder,
  goal: drawGoal,
  minigoal: drawGoal,
  rebounder: drawRebounder,
  dummy: drawDummy,
  wall: drawWall,
  text: drawText,
};

function drawZone(ctx: CanvasRenderingContext2D, it: Item, x: number, y: number, v: View, u: number, px: number, alpha: number) {
  const w = it.w ?? 6;
  const h = it.h ?? 6;
  const c = colorHex(it.color, 'white');
  ctx.fillStyle = c;
  ctx.globalAlpha = alpha * 0.16;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = alpha * 0.75;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.setLineDash([]);
  if (it.label) {
    ctx.globalAlpha = alpha;
    label(ctx, v, it.label, x, y, Math.min(w, h) * 0.18 + 0.3 * u, '#fff');
  }
}

/** Longueur affichée d'une mesure, en mètres. */
export const formatMeters = (m: number) => `${(Math.round(m * 2) / 2).toString().replace('.', ',')} m`;

function drawMeasure(ctx: CanvasRenderingContext2D, it: Item, x: number, y: number, v: View, u: number, px: number) {
  const L = it.w ?? 5;
  const a = ((it.rot ?? 0) * Math.PI) / 180;
  const c = colorHex(it.color, 'white');
  const tick = 0.35 * u;
  ctx.translate(x, y);
  ctx.save();
  ctx.rotate(a);
  ctx.lineCap = 'round';
  const seg = () => {
    ctx.beginPath();
    ctx.moveTo(-L / 2, 0);
    ctx.lineTo(L / 2, 0);
    ctx.moveTo(-L / 2, -tick);
    ctx.lineTo(-L / 2, tick);
    ctx.moveTo(L / 2, -tick);
    ctx.lineTo(L / 2, tick);
    ctx.stroke();
  };
  ctx.strokeStyle = c;
  ctx.lineWidth = 2 * px;
  seg();
  // Pointes de flèches aux deux bouts
  ctx.fillStyle = c;
  const hs = Math.max(0.42 * u, 8 * px);
  arrowHead(ctx, [0, 0], [L / 2, 0], hs);
  arrowHead(ctx, [0, 0], [-L / 2, 0], hs);
  ctx.restore();
  // Étiquette toujours lisible à l'écran
  if (v.rot) ctx.rotate(-Math.PI / 2);
  const size = Math.max(0.5 * u, 10 * px) * (it.scale ?? 1);
  const text = formatMeters(L);
  ctx.font = `700 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width + size * 0.8;
  ctx.fillStyle = 'rgba(20,22,21,0.8)';
  ctx.beginPath();
  ctx.roundRect(-tw / 2, -size * 0.7, tw, size * 1.4, size * 0.7);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, size * 0.04);
}

const Z: Record<Item['kind'], number> = {
  zone: 0, measure: 1, ladder: 1, hurdle: 2, hoop: 2, cone: 3, marker: 3, pole: 3, flag: 3, ballbag: 3,
  minigoal: 4, goal: 4, rebounder: 4, dummy: 4, wall: 4, coach: 5, player: 6, ball: 7, text: 8,
};
export const layerOf = (it: Item) => Z[it.kind];
export const byLayer = (a: Item, b: Item) => Z[a.kind] - Z[b.kind];

export function selectionRadius(it: Item, u: number) {
  const sc = it.scale ?? 1;
  switch (it.kind) {
    case 'player': return 0.95 * u * sc;
    case 'coach': return 1.15 * u * sc;
    case 'dummy': return 1.05 * u * sc;
    case 'ball': return 0.55 * u * sc;
    case 'ladder': return 2.6 * u * sc;
    case 'goal': return 2.1 * u * sc;
    case 'minigoal': case 'rebounder': return 1.25 * u * sc;
    case 'wall': return 1.9 * u * sc;
    case 'hoop': case 'ballbag': case 'flag': case 'pole': return 0.95 * u * sc;
    case 'hurdle': return 0.8 * u * sc;
    case 'text': return Math.max(1, (it.label || 'Texte').length * 0.3) * u * sc;
    case 'measure': return (it.w ?? 5) / 2;
    case 'zone': return Math.max(it.w ?? 6, it.h ?? 6) / 2;
    default: return 0.55 * u * sc;
  }
}

export function drawScene(ctx: CanvasRenderingContext2D, ex: ExerciseData, o: RenderOptions) {
  const { view: v, dpr } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.width, v.height);
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, v.width, v.height);
  }
  applyView(ctx, v, dpr);
  const u = itemUnit(ex.field);
  pitch(ctx, ex, v, { ...DEFAULT_PALETTE, ...o.palette });

  const items = [...ex.items].sort(byLayer);
  for (const it of items) {
    if (it.kind !== 'zone') continue;
    const p = o.pos.get(it.id) ?? [it.x, it.y];
    drawItem(ctx, it, p, v, u);
    if (o.selected?.has(it.id)) {
      // Zone choisie : son contour passe en trait plein.
      ctx.save();
      ctx.strokeStyle = colorHex(it.color, 'white');
      ctx.lineWidth = 2 / v.s;
      ctx.strokeRect(p[0] - (it.w ?? 6) / 2, p[1] - (it.h ?? 6) / 2, it.w ?? 6, it.h ?? 6);
      ctx.restore();
    }
  }

  if (o.showPaths !== false) for (const p of ex.paths) drawPath(ctx, p, v, u, o.selected?.has(p.id));
  if (o.draft?.path) drawPath(ctx, o.draft.path, v, u, false, 0.75);

  if (o.ghost) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4 / v.s;
    ctx.setLineDash([3 / v.s, 4 / v.s]);
    for (const it of items) {
      const g = o.ghost.get(it.id);
      const p = o.pos.get(it.id);
      if (!g || !p || (Math.abs(g[0] - p[0]) < 0.05 && Math.abs(g[1] - p[1]) < 0.05)) continue;
      drawItem(ctx, it, g, v, u, 0.28);
      ctx.beginPath();
      ctx.moveTo(g[0], g[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const it of items) {
    if (it.kind === 'zone') continue;
    const p = o.pos.get(it.id) ?? [it.x, it.y];
    drawItem(ctx, it, p, v, u);
  }
  for (const it of o.draft?.items ?? []) drawItem(ctx, it, [it.x, it.y], v, u, 0.6);

  if (o.draft?.rect) {
    const [a, b] = o.draft.rect;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2 / v.s;
    ctx.setLineDash([4 / v.s, 3 / v.s]);
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    ctx.restore();
  }
}
