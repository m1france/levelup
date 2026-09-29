import { SHAPE, TIERS } from '../components/FutCard';
import type { PlayerCard } from '../lib/types';
import { WALKOUT_FONT } from './fonts';
import { rgba } from './textures';

/**
 * Carte Ultimate Team dessinée sur un canvas (texture de la carte 3D de l'estrade).
 * Même mise en page que <FutCard>, en plus fin : dorure, filigrane du logo, reflets.
 */

export const CARD_VIEW = { w: 250, h: 350 };
const SCALE = 4;

export function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const font = (weight: number, size: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px "${WALKOUT_FONT}", "Barlow Condensed", "Arial Narrow", system-ui, sans-serif`;

function canvas() {
  const c = document.createElement('canvas');
  c.width = CARD_VIEW.w * SCALE;
  c.height = CARD_VIEW.h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** Image recadrée façon `object-fit: cover`, calée en haut. */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, alignY = 0) {
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * alignY, sw, sh, x, y, w, h);
}

function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, cx: number, cy: number, size: number) {
  const k = Math.min(size / img.width, size / img.height);
  ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
}

function goldText(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff4c9');
  g.addColorStop(0.45, '#f6d77a');
  g.addColorStop(1, '#c9982f');
  return g;
}

/** Face avant. `photo` : portrait carré de l'enfant (sinon silhouette). */
export function drawCardFront(card: PlayerCard, team: { category: string; color: string }, photo: HTMLImageElement | null, logo: HTMLImageElement | null) {
  const { c, ctx } = canvas();
  const t = TIERS[card.award.tier] ?? TIERS.gold;
  const shape = new Path2D(SHAPE);

  // Fond : dégradé du palier, halo derrière la photo, rayures, filigrane du logo.
  const bg = ctx.createLinearGradient(0, 0, 250, 350);
  bg.addColorStop(0, t.from);
  bg.addColorStop(0.5, t.mid);
  bg.addColorStop(1, t.to);
  ctx.fillStyle = bg;
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  const halo = ctx.createRadialGradient(165, 105, 4, 165, 105, 150);
  halo.addColorStop(0, 'rgba(255, 228, 150, 0.32)');
  halo.addColorStop(1, 'rgba(255, 228, 150, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 250, 350);
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 12;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(-70 + i * 40, 350);
    ctx.lineTo(30 + i * 40, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) {
    ctx.beginPath();
    ctx.moveTo(-120 + i * 6, 350);
    ctx.lineTo(-20 + i * 6, 0);
    ctx.stroke();
  }
  if (logo) {
    ctx.globalAlpha = 0.07;
    drawContain(ctx, logo, 125, 270, 150);
  }
  ctx.globalAlpha = 1;

  // Photo (ou silhouette), fondue vers le bas.
  const px = 82.5;
  const py = 28;
  const pw = 155;
  const ph = 175;
  const layer = document.createElement('canvas');
  layer.width = pw * SCALE;
  layer.height = ph * SCALE;
  const lc = layer.getContext('2d')!;
  lc.scale(SCALE, SCALE);
  lc.imageSmoothingQuality = 'high';
  if (photo) drawCover(lc, photo, 0, 0, pw, ph, 0);
  else {
    lc.fillStyle = t.line;
    lc.globalAlpha = 0.9;
    const k = Math.min((pw * 0.88) / 100, ph / 110);
    const ox = (pw - 100 * k) / 2;
    const oy = ph - 110 * k;
    lc.beginPath();
    lc.arc(ox + 50 * k, oy + 34 * k, 20 * k, 0, Math.PI * 2);
    lc.fill();
    lc.beginPath();
    lc.moveTo(ox + 12 * k, oy + 110 * k);
    lc.quadraticCurveTo(ox + 14 * k, oy + 66 * k, ox + 50 * k, oy + 62 * k);
    lc.quadraticCurveTo(ox + 86 * k, oy + 66 * k, ox + 88 * k, oy + 110 * k);
    lc.closePath();
    lc.fill();
  }
  lc.globalCompositeOperation = 'destination-in';
  const fade = lc.createLinearGradient(0, 0, 0, ph);
  fade.addColorStop(0, '#000');
  fade.addColorStop(0.72, '#000');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  lc.fillStyle = fade;
  lc.fillRect(0, 0, pw, ph);
  ctx.drawImage(layer, px, py, pw, ph);
  ctx.restore();

  // Double filet intérieur.
  ctx.save();
  ctx.translate(125, 175);
  ctx.scale(0.93, 0.93);
  ctx.translate(-125, -175);
  ctx.strokeStyle = t.glow;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2;
  ctx.stroke(shape);
  ctx.restore();
  ctx.save();
  ctx.translate(125, 175);
  ctx.scale(0.905, 0.905);
  ctx.translate(-125, -175);
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 0.8;
  ctx.stroke(shape);
  ctx.restore();

  const ink = t.ink;
  const gold = card.award.tier === 'totw';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Note générale, poste, écusson.
  ctx.font = font(900, 66);
  ctx.fillStyle = gold ? goldText(ctx, 44, 98) : ink;
  ctx.fillText(String(card.ovr), 55, 98);
  ctx.font = font(800, 25);
  ctx.fillStyle = ink;
  ctx.fillText(card.position, 55, 124);
  ctx.beginPath();
  ctx.arc(55, 150, 19, 0, Math.PI * 2);
  ctx.fillStyle = logo ? 'rgba(255,255,255,0.94)' : team.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  if (logo) drawContain(ctx, logo, 55, 150, 29);
  else {
    ctx.fillStyle = '#fff';
    ctx.font = font(800, 11);
    ctx.fillText(team.category.replace(/\s+/g, '').slice(0, 5), 55, 154);
  }

  // Prénom et filet.
  const name = card.firstName.toUpperCase();
  let size = 38;
  ctx.font = font(900, size);
  while (ctx.measureText(name).width > 184 && size > 20) ctx.font = font(900, --size);
  ctx.fillStyle = gold ? goldText(ctx, 206, 236) : ink;
  ctx.fillText(name, 125, 236);
  const rule = ctx.createLinearGradient(30, 0, 220, 0);
  rule.addColorStop(0, 'rgba(246,215,122,0)');
  rule.addColorStop(0.5, gold ? 'rgba(246,215,122,0.8)' : t.line);
  rule.addColorStop(1, 'rgba(246,215,122,0)');
  ctx.fillStyle = rule;
  ctx.fillRect(30, 243, 190, 1.2);

  // Statistiques : deux colonnes de trois.
  ctx.textAlign = 'left';
  card.stats.forEach(([k, v], i) => {
    const x = i < 3 ? 46 : 138;
    const y = 270 + (i % 3) * 22;
    ctx.font = font(900, 23);
    ctx.fillStyle = ink;
    ctx.fillText(String(v), x, y);
    ctx.font = font(600, 17);
    ctx.globalAlpha = 0.85;
    ctx.fillText(k, x + 30, y);
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = t.line;
  ctx.fillRect(124.5, 254, 0.8, 62);

  // Pied de carte.
  ctx.textAlign = 'center';
  ctx.font = font(800, 13);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = ink;
  ctx.fillText([card.number != null ? `#${card.number}` : '', team.category, 'CONVOQUÉ'].filter(Boolean).join('  ·  '), 125, 332);
  ctx.globalAlpha = 1;
  return c;
}

/** Dos de carte : noir et or, anneaux concentriques et logo du club. */
export function drawCardBack(team: { category: string; color: string }, logo: HTMLImageElement | null) {
  const { c, ctx } = canvas();
  const shape = new Path2D(SHAPE);
  const bg = ctx.createLinearGradient(0, 0, 250, 350);
  bg.addColorStop(0, '#2b2b2f');
  bg.addColorStop(0.55, '#0f0f12');
  bg.addColorStop(1, '#050507');
  ctx.fillStyle = bg;
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  const tint = ctx.createRadialGradient(125, 175, 10, 125, 175, 200);
  tint.addColorStop(0, rgba(team.color, 0.55));
  tint.addColorStop(1, rgba(team.color, 0));
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 250, 350);
  ctx.strokeStyle = '#f6d77a';
  for (let i = 0; i < 16; i++) {
    ctx.globalAlpha = 0.3 - i * 0.015;
    ctx.lineWidth = i % 3 === 0 ? 1.4 : 0.6;
    ctx.beginPath();
    ctx.arc(125, 175, 14 + i * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(125, 175);
  ctx.scale(0.93, 0.93);
  ctx.translate(-125, -175);
  ctx.strokeStyle = '#f6d77a';
  ctx.lineWidth = 2.2;
  ctx.stroke(shape);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(125, 160, 46, 0, Math.PI * 2);
  ctx.fillStyle = logo ? 'rgba(255,255,255,0.95)' : team.color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f6d77a';
  ctx.stroke();
  if (logo) drawContain(ctx, logo, 125, 160, 68);
  ctx.textAlign = 'center';
  ctx.fillStyle = goldText(ctx, 230, 262);
  ctx.font = font(900, 30, true);
  ctx.fillText(team.category || 'CONVOCATION', 125, 250);
  ctx.font = font(800, 12);
  ctx.fillStyle = '#f6d77a';
  ctx.fillText('C O N V O C A T I O N', 125, 272);
  return c;
}
