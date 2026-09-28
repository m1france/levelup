/**
 * Textures dessinées au canevas pour la salle de presse : maillot du club,
 * mur de logos, nappe, chevalets et écran. Aucun fichier à charger en dehors des photos et du logo.
 */
import * as THREE from 'three';

export const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export type Img = HTMLImageElement | HTMLCanvasElement;

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

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
}

export function tex(c: HTMLCanvasElement, { repeat, aniso = 8 }: { repeat?: [number, number]; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}


/**
 * Détoure le fond uni d'un logo (remplissage depuis les bords) : le blanc autour de l'écusson devient transparent.
 * Le remplissage ne passe que par des zones d'au moins 5 px de large, pour ne pas s'infiltrer dans l'écusson par un liseré ;
 * s'il vide malgré tout le centre du logo, on garde le logo d'origine (`clean` = false).
 */
export function cutLogo(img: Img, size = 512): { c: HTMLCanvasElement; clean: boolean } {
  const k = Math.min(1, size / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const { c, g } = canvas(w, h);
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  if (px[3] < 20) return { c, clean: true }; // déjà transparent
  const ref = [px[0], px[1], px[2]];
  const near = new Uint8Array(w * h);
  for (let n = 0, i = 0; n < w * h; n++, i += 4)
    near[n] = Math.abs(px[i] - ref[0]) + Math.abs(px[i + 1] - ref[1]) + Math.abs(px[i + 2] - ref[2]) < 45 ? 1 : 0;
  // Passage : le pixel et tout son voisinage (rayon 2) sont du fond.
  const R = 2;
  const pass = (x: number, y: number) => {
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (!near[yy * w + xx]) return false;
      }
    return true;
  };
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const n = y * w + x;
    if (out[n] || !pass(x, y)) continue;
    out[n] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // Élargit la zone détourée jusqu'au bord du dessin (le fond de la bande de 2 px laissée par la contrainte).
  for (let r = 0; r < R + 1; r++) {
    const grow: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const n = y * w + x;
        if (out[n] || !near[n]) continue;
        if ((x > 0 && out[n - 1]) || (x < w - 1 && out[n + 1]) || (y > 0 && out[n - w]) || (y < h - 1 && out[n + w])) grow.push(n);
      }
    for (const n of grow) out[n] = 1;
  }
  // Contrôle : le centre du logo ne doit pas avoir été vidé.
  let lost = 0;
  let total = 0;
  for (let y = Math.round(h * 0.35); y < h * 0.65; y++)
    for (let x = Math.round(w * 0.35); x < w * 0.65; x++) {
      total++;
      lost += out[y * w + x];
    }
  if (lost / total > 0.35) {
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { c, clean: false };
  }
  for (let n = 0; n < w * h; n++) if (out[n]) px[n * 4 + 3] = 0;
  // Adoucit le bord détouré.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = at(x, y);
      if (px[i + 3] === 0) continue;
      const m = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].filter((j) => px[j + 3] === 0).length;
      if (m) px[i + 3] = Math.round(px[i + 3] * (1 - m * 0.2));
    }
  g.putImageData(d, 0, 0);
  return { c, clean: true };
}

/** Écusson de remplacement quand le club n'a pas encore de logo. */
export function fallbackLogo(name: string, color: string): HTMLCanvasElement {
  const { c, g } = canvas(512, 600);
  g.beginPath();
  g.moveTo(40, 40);
  g.lineTo(472, 40);
  g.lineTo(472, 330);
  g.quadraticCurveTo(472, 500, 256, 580);
  g.quadraticCurveTo(40, 500, 40, 330);
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 22;
  g.strokeStyle = color;
  g.stroke();
  g.save();
  g.clip();
  g.fillStyle = color;
  for (let x = 60; x < 472; x += 70) g.fillRect(x, 300, 34, 300);
  g.restore();
  const initials = name.split(/[\s-]+/).filter((w) => w.length > 2).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'FC';
  g.fillStyle = color;
  g.font = `900 150px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(initials, 256, 190);
  return c;
}

/** Maillot rayé aux couleurs du club, logo sur le cœur (u = 0,5 : face avant du tour de buste). */
export function jerseyTexture(logo: Img, color: string, number: number | null) {
  const { c, g } = canvas(1024, 512);
  g.fillStyle = '#f4f4f2';
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = color;
  for (let x = 0; x < 1024; x += 64) g.fillRect(x, 0, 30, 512);
  // Plastron uni autour du logo et bandes d'épaules.
  g.fillStyle = '#f4f4f2';
  g.fillRect(560, 170, 110, 150);
  g.fillStyle = '#111';
  g.fillRect(0, 0, 1024, 26);
  g.fillStyle = color;
  g.fillRect(0, 26, 1024, 10);
  const lw = 92;
  const lh = (logo.height / logo.width) * lw;
  g.drawImage(logo, 615 - lw / 2, 245 - lh / 2, lw, lh);
  g.textAlign = 'center';
  if (number !== null) {
    g.font = `900 150px ${FONT}`;
    g.fillStyle = '#111';
    g.fillText(String(number), 0 + 12, 300);
    g.fillText(String(number), 1024 - 12, 300);
  }
  return tex(c);
}

/** Coupe un nom en deux lignes équilibrées (« GALLIA SPORT » / « SAINT-AUNÈS »). */
export function twoLines(text: string): [string, string] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text, ''];
  let best: [string, string] = [text, ''];
  let diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.abs(a.length - b.length) < diff) (diff = Math.abs(a.length - b.length)), (best = [a, b]);
  }
  return best;
}

/** Mur « step and repeat » : logos et nom du club en quinconce, grand logo au centre. */
export function backdropTexture(logo: Img, club: string, color: string) {
  const W = 2048;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#e9e9ee');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const cell = 200;
  const lw = 104;
  const lh = (logo.height / logo.width) * lw;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const [l1, l2] = twoLines(club.toUpperCase() || 'CONFÉRENCE DE PRESSE');
  for (let row = 0, y = 70; y < H + cell; row++, y += cell * 0.62) {
    for (let x = row % 2 ? cell / 2 : 0; x < W + cell; x += cell) {
      if (row % 2) {
        g.drawImage(logo, x - lw / 2, y - lh / 2, lw, lh);
      } else {
        g.fillStyle = color;
        g.font = `900 26px ${FONT}`;
        g.fillText(l1, x, y - 12, cell * 0.92);
        g.fillStyle = '#222';
        g.font = `800 20px ${FONT}`;
        g.fillText(l2, x, y + 16, cell * 0.92);
      }
    }
  }
  // Bandeau central : grand logo en médaillon.
  g.fillStyle = 'rgba(255,255,255,0.93)';
  g.beginPath();
  g.ellipse(W / 2, 330, 250, 250, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = color;
  g.stroke();
  const bw = 330;
  const bh = (logo.height / logo.width) * bw;
  g.drawImage(logo, W / 2 - bw / 2, 330 - bh / 2, bw, bh);
  // Liserés rouges en haut et en bas.
  g.fillStyle = color;
  g.fillRect(0, 0, W, 16);
  g.fillRect(0, H - 16, W, 16);
  return tex(c);
}

/** Jupe de table rouge : logo et « Conférence de presse ». */
export function skirtTexture(logo: Img, club: string, color: string, group: string) {
  const { c, g } = canvas(2048, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, color);
  grad.addColorStop(1, new THREE.Color(color).multiplyScalar(0.55).getStyle());
  g.fillStyle = grad;
  g.fillRect(0, 0, 2048, 512);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 26, 2048, 8);
  g.fillRect(0, 478, 2048, 8);
  const lw = 250;
  const lh = (logo.height / logo.width) * lw;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(1024, 256, 180, 0, Math.PI * 2);
  g.fill();
  g.drawImage(logo, 1024 - lw / 2, 256 - lh / 2, lw, lh);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 92px ${FONT}`;
  g.fillText('CONVOCATION', 520, 225);
  g.fillText(group.toUpperCase(), 1530, 225);
  g.font = `800 38px ${FONT}`;
  g.fillText('CONFÉRENCE DE PRESSE', 520, 320);
  g.fillText(club.toUpperCase(), 1530, 320);
  return tex(c);
}

/** Chevalet nominatif posé sur la table. */
export function namePlate(name: string, role: string, color: string) {
  const { c, g } = canvas(512, 160);
  g.fillStyle = '#101216';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = color;
  g.fillRect(0, 0, 10, 160);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 64px ${FONT}`;
  g.fillText(name.toUpperCase(), 262, 62, 470);
  g.fillStyle = '#c9ccd4';
  g.font = `700 32px ${FONT}`;
  g.fillText(role, 262, 120, 470);
  return tex(c);
}

/** Écran LED de la salle. */
export function screenTexture(logo: Img, group: string, line: string, color: string) {
  const { c, g } = canvas(1024, 576);
  const grad = g.createLinearGradient(0, 0, 1024, 576);
  grad.addColorStop(0, '#0b0f1a');
  grad.addColorStop(1, new THREE.Color(color).multiplyScalar(0.45).getStyle());
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 576);
  const lw = 170;
  const lh = (logo.height / logo.width) * lw;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(185, 288, 118, 0, Math.PI * 2);
  g.fill();
  g.drawImage(logo, 185 - lw / 2, 288 - lh / 2, lw, lh);
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.font = `italic 900 84px ${FONT}`;
  g.fillText('CONVOCATION', 320, 220, 660);
  g.fillStyle = '#d5f58e';
  g.font = `italic 900 120px ${FONT}`;
  g.fillText(group.toUpperCase(), 320, 330, 660);
  g.fillStyle = '#c9ccd4';
  g.font = `700 34px ${FONT}`;
  g.fillText(line, 320, 430, 660);
  // Trame LED.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 576; y += 4) g.fillRect(0, y, 1024, 1);
  return tex(c);
}

/** Halo lumineux (flash, voyants), additif. */
export function glowTexture() {
  const { c, g } = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  r.addColorStop(0.6, 'rgba(200,220,255,0.18)');
  r.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Moquette légèrement texturée. */
export function carpetTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#1b2233';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random() * 30;
    g.fillStyle = `rgba(${40 + v},${48 + v},${70 + v},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  return tex(c, { repeat: [10, 10] });
}

/** Couleur dominante d'un logo (teinte saturée la plus présente), pour habiller la salle aux couleurs du club. */
export function dominantColor(img: Img): string | null {
  const { c, g } = canvas(64, 64);
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const col = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    if (hsl.s < 0.35 || hsl.l < 0.15 || hsl.l > 0.85) continue;
    const k = Math.round(hsl.h * 18) % 18;
    const bin = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += d[i];
    bin.g += d[i + 1];
    bin.b += d[i + 2];
    bins.set(k, bin);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || best.n < 40) return null;
  const h = (v: number) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${h(best.r)}${h(best.g)}${h(best.b)}`;
}

/** Habillage du club : logo détouré (data URL) et couleur dominante, avec la couleur de l'équipe en secours. */
export async function clubLook(logoUrl: string | null, fallback: string) {
  const img = await loadImage(logoUrl);
  if (!img) return { color: fallback, logo: null, clean: true };
  const cut = cutLogo(img);
  return { color: dominantColor(cut.c) ?? fallback, logo: cut.c.toDataURL('image/png'), clean: cut.clean };
}
