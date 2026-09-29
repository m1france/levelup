import { WALKOUT_FONT } from './fonts';

/** Textures dessinées à la volée (aucun fichier à charger) : tunnel, portes, écran géant, fumée, étincelles. */

export function rgba(color: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(color.trim());
  if (!m) return `rgba(31, 122, 79, ${a})`;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const font = (weight: number, size: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px "${WALKOUT_FONT}", "Arial Narrow", system-ui, sans-serif`;

function make(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

function contain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, size: number) {
  const k = Math.min(size / img.width, size / img.height);
  ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
}

/** Petit bruit pseudo-aléatoire reproductible. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ sprites */

export function glowTexture(size = 256) {
  const { c, ctx } = make(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function sparkTexture(size = 64) {
  const { c, ctx } = make(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,250,230,0.95)');
  g.addColorStop(0.5, 'rgba(255,220,150,0.3)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Soleil : rayons qui partent du centre (derrière les lettres et la carte). */
export function raysTexture(size = 1024, count = 36) {
  const { c, ctx } = make(size, size);
  const r = rng(7);
  ctx.translate(size / 2, size / 2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.08;
    const w = 0.02 + r() * 0.05;
    const len = size * (0.35 + r() * 0.15);
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a - w, a + w);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/** Bouffée de fumée douce. */
export function smokeTexture(size = 256) {
  const { c, ctx } = make(size, size);
  const r = rng(11);
  for (let i = 0; i < 26; i++) {
    const x = size * (0.3 + r() * 0.4);
    const y = size * (0.3 + r() * 0.4);
    const rad = size * (0.12 + r() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.07})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/* ------------------------------------------------------------------ tunnel */

/**
 * Mur du tunnel : 16 m × 4,2 m (répété). Panneaux sombres jointés, bandeau aux couleurs du club
 * avec son nom, filets dorés, lavis de lumière sous le plafond.
 */
export function wallTexture(team: string, club: string, category: string) {
  const W = 2048;
  const H = 540;
  const { c, ctx } = make(W, H);
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#1d1f25');
  base.addColorStop(0.35, '#15171b');
  base.addColorStop(1, '#0d0e11');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const r = rng(3);
  // Grain du béton peint.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
    ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  // Panneaux : 2 m de large.
  for (let x = 0; x <= W; x += 256) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 2, 0, 3, H);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 1, 0, 1, H);
  }
  // Bandeau du club (de 0,9 à 1,5 m du sol).
  const y0 = H * (1 - 1.5 / 4.2);
  const y1 = H * (1 - 0.9 / 4.2);
  const band = ctx.createLinearGradient(0, y0, 0, y1);
  band.addColorStop(0, rgba(team, 1));
  band.addColorStop(1, rgba(team, 0.72));
  ctx.fillStyle = band;
  ctx.fillRect(0, y0, W, y1 - y0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, y0 + (y1 - y0) * 0.55, W, (y1 - y0) * 0.45);
  ctx.fillStyle = '#ff5a4f';
  ctx.fillRect(0, y0 - 7, W, 3);
  ctx.fillRect(0, y1 + 4, W, 3);
  ctx.font = font(900, (y1 - y0) * 0.62, true);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const label = `${club.toUpperCase() || 'NOTRE CLUB'}   •   ${category.toUpperCase() || 'CONVOCATION'}   •   `;
  const lw = ctx.measureText(label).width;
  for (let x = -((W % lw) / 2); x < W; x += lw) ctx.fillText(label, x, (y0 + y1) / 2 + 2);
  // Lavis de lumière sous le plafond et plinthe.
  const wash = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  wash.addColorStop(0, 'rgba(210,225,255,0.07)');
  wash.addColorStop(1, 'rgba(210,225,255,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H * 0.35);
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, H - 22, W, 22);
  return c;
}

export function floorTexture() {
  const S = 512;
  const { c, ctx } = make(S, S);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, S, S);
  const r = rng(5);
  for (let i = 0; i < 7000; i++) {
    const v = r();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${r() * 0.05})` : `rgba(0,0,0,${r() * 0.3})`;
    ctx.fillRect(r() * S, r() * S, 1.5, 1.5);
  }
  // Dalles de caoutchouc (1 m).
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= S; i += S / 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, S);
    ctx.moveTo(0, i);
    ctx.lineTo(S, i);
    ctx.stroke();
  }
  return c;
}

/** Tapis central du tunnel aux couleurs du club. */
export function runnerTexture(team: string, club: string) {
  const W = 256;
  const H = 2048;
  const { c, ctx } = make(W, H);
  ctx.fillStyle = rgba(team, 1);
  ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.45)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0.05)');
  shade.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff5a4f';
  ctx.fillRect(10, 0, 6, H);
  ctx.fillRect(W - 16, 0, 6, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = font(900, 120, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillText((club || 'ALLEZ').toUpperCase(), 0, 8);
  ctx.restore();
  return c;
}

/** Vantail de porte : acier peint aux couleurs du club, moitié du logo, barre anti-panique dorée. */
export function doorTexture(team: string, logo: HTMLImageElement | null, side: 'left' | 'right', label: string) {
  const W = 768;
  const H = 1024;
  const { c, ctx } = make(W, H);
  const g = ctx.createLinearGradient(side === 'left' ? 0 : W, 0, side === 'left' ? W : 0, 0);
  g.addColorStop(0, rgba(team, 1));
  g.addColorStop(1, rgba(team, 0.82));
  ctx.fillStyle = '#0b0c0f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const dark = ctx.createLinearGradient(0, 0, 0, H);
  dark.addColorStop(0, 'rgba(255,255,255,0.12)');
  dark.addColorStop(0.5, 'rgba(0,0,0,0)');
  dark.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  // Panneaux emboutis.
  const panel = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillRect(x, y, 3, h);
  };
  panel(60, 60, W - 120, H * 0.42);
  panel(60, H * 0.62, W - 120, H * 0.3);
  // Moitié du logo : les deux vantaux fermés reforment le logo entier.
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(side === 'left' ? W : 0, H * 0.31, 250, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ff5a4f';
    ctx.stroke();
    ctx.clip();
    contain(ctx, logo, side === 'left' ? W : 0, H * 0.31, 400);
    ctx.restore();
  }
  // Barre anti-panique et plaque de protection.
  const bar = ctx.createLinearGradient(0, H * 0.535, 0, H * 0.575);
  bar.addColorStop(0, '#fff3c4');
  bar.addColorStop(0.5, '#e0b24a');
  bar.addColorStop(1, '#8a6414');
  ctx.fillStyle = bar;
  ctx.fillRect(side === 'left' ? 90 : 40, H * 0.535, W - 130, H * 0.04);
  const kick = ctx.createLinearGradient(0, H * 0.93, 0, H);
  kick.addColorStop(0, '#9aa0a8');
  kick.addColorStop(1, '#4a4f56');
  ctx.fillStyle = kick;
  ctx.fillRect(0, H * 0.93, W, H * 0.07);
  // Mot peint au pochoir.
  ctx.font = font(900, 64, true);
  ctx.textAlign = side === 'left' ? 'right' : 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(label, side === 'left' ? W - 60 : 60, H * 0.7);
  return c;
}

/** Enseigne lumineuse au-dessus des portes. */
export function signTexture(text: string) {
  const W = 1024;
  const H = 160;
  const { c, ctx } = make(W, H);
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, W, H);
  ctx.font = font(900, 96, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text.toUpperCase(), W / 2, H / 2 + 4);
  return c;
}

/** Écran géant derrière l'estrade : logo, « CONVOQUÉ », prénom du joueur, trame de LED. */
export function screenTexture(team: string, logo: HTMLImageElement | null, name: string, line: string) {
  const W = 2048;
  const H = 640;
  const { c, ctx } = make(W, H);
  ctx.fillStyle = '#040507';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.55);
  glow.addColorStop(0, rgba(team, 0.95));
  glow.addColorStop(0.5, rgba(team, 0.35));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Chevrons de vitesse.
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 18; i++) {
    const x = i * 120 - 60;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 60, 0);
    ctx.lineTo(x + 180, H);
    ctx.lineTo(x + 120, H);
    ctx.closePath();
    ctx.fill();
  }
  if (logo) {
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.45, 190, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ff5a4f';
    ctx.stroke();
    contain(ctx, logo, W / 2, H * 0.45, 290);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(900, 150, true);
  const gold = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.62);
  gold.addColorStop(0, '#ffe3e0');
  gold.addColorStop(1, '#ff3b30');
  ctx.fillStyle = gold;
  ctx.fillText('CONVOQUÉ', W * 0.2, H * 0.46);
  // Prénom à droite du logo : réduit s'il est long, pour ne jamais mordre sur le logo.
  const label = name.toLocaleUpperCase('fr-FR') || 'CONVOQUÉ';
  let size = 150;
  while (size > 70 && ctx.measureText(label).width > W * 0.34) ctx.font = font(900, (size -= 6), true);
  ctx.fillText(label, W * 0.8, H * 0.46);
  ctx.font = font(800, 58);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText(line.toUpperCase(), W / 2, H * 0.13);
  ctx.fillStyle = '#ff5a4f';
  ctx.fillRect(0, 26, W, 6);
  ctx.fillRect(0, H - 32, W, 6);
  // Trame de LED : chaque point lumineux est visible de près.
  const dots = document.createElement('canvas');
  dots.width = 8;
  dots.height = 8;
  const d = dots.getContext('2d')!;
  d.fillStyle = 'rgba(0,0,0,0.55)';
  d.fillRect(0, 0, 8, 8);
  d.clearRect(1, 1, 6, 6);
  ctx.fillStyle = ctx.createPattern(dots, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  return c;
}
