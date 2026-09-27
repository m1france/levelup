import { MONTHS_LONG, formatTime, fromYMD } from './events';

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export interface CardData {
  club: string;
  team: string;
  color: string;
  title: string;
  opponent: string;
  venue: string;
  date: string;
  time: string;
  meetTime: string;
  location: string;
  bring: string;
  message: string;
  players: { firstName: string; lastName?: string; number?: number }[];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Carte de convocation au format portrait (1080×1350), prête pour WhatsApp ou Instagram. */
export async function renderConvCard(d: CardData): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const font = (w: number, s: number) => `${w} ${s}px ui-sans-serif, -apple-system, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif`;

  // Fond vert club avec lignes de terrain.
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1e4a3b');
  bg.addColorStop(1, '#122d24');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(W / 2, H * 0.34, 190, 0, Math.PI * 2);
  g.moveTo(0, H * 0.34);
  g.lineTo(W, H * 0.34);
  g.stroke();
  g.strokeRect(W / 2 - 260, -4, 520, 150);

  // En-tête : club et équipe.
  g.fillStyle = d.color || '#1f6f4a';
  roundRect(g, 72, 72, 104, 104, 28);
  g.fill();
  g.fillStyle = '#fff';
  g.font = font(800, d.team.length > 4 ? 30 : 40);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(d.team.replace(/\s+/g, ''), 124, 126);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(238,246,230,0.7)';
  g.font = font(600, 30);
  g.fillText(d.club.toUpperCase(), 206, 116);
  g.fillStyle = '#d5f58e';
  g.font = font(800, 34);
  g.fillText('CONVOCATION', 206, 160);

  // Match.
  const day = fromYMD(d.date);
  g.fillStyle = '#eef6e6';
  g.font = font(800, 76);
  let y = 300;
  for (const line of wrap(g, d.title, W - 144).slice(0, 2)) {
    g.fillText(line, 72, y);
    y += 84;
  }
  g.fillStyle = 'rgba(238,246,230,0.75)';
  g.font = font(600, 38);
  g.fillText(`${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS_LONG[day.getMonth()]}${d.venue ? ` · ${d.venue}` : ''}`, 72, y + 4);
  y += 64;

  // Horaires : rendez-vous en gros.
  const boxY = y;
  g.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(g, 72, boxY, W - 144, 170, 34);
  g.fill();
  const cols = [
    { k: 'RENDEZ-VOUS', v: d.meetTime ? formatTime(d.meetTime) : '—', hi: true },
    { k: 'COUP D’ENVOI', v: d.time ? formatTime(d.time) : '—', hi: false },
  ];
  cols.forEach((col, i) => {
    const x = 112 + i * ((W - 144) / 2);
    g.fillStyle = 'rgba(238,246,230,0.6)';
    g.font = font(700, 26);
    g.fillText(col.k, x, boxY + 58);
    g.fillStyle = col.hi ? '#d5f58e' : '#eef6e6';
    g.font = font(800, 72);
    g.fillText(col.v, x, boxY + 132);
  });
  y = boxY + 220;
  g.font = font(600, 32);
  g.fillStyle = '#eef6e6';
  if (d.location) {
    g.fillText(`📍 ${wrap(g, d.location, W - 190)[0]}`, 72, y);
    y += 52;
  }
  if (d.bring) {
    g.fillStyle = 'rgba(238,246,230,0.8)';
    g.fillText(`🎒 ${wrap(g, d.bring, W - 190)[0]}`, 72, y);
    y += 52;
  }

  // Joueurs convoqués, sur deux ou trois colonnes.
  y += 26;
  g.fillStyle = 'rgba(238,246,230,0.6)';
  g.font = font(700, 26);
  g.fillText(`${d.players.length} JOUEURS CONVOQUÉS`, 72, y);
  y += 24;
  const n = d.players.length;
  const ncol = n > 14 ? 3 : 2;
  const perCol = Math.ceil(n / ncol);
  const rowH = Math.min(80, (H - 120 - y) / Math.max(1, perCol));
  const colW = (W - 144) / ncol;
  d.players.forEach((p, i) => {
    const cx = 72 + Math.floor(i / perCol) * colW;
    const cy = y + (i % perCol) * rowH + rowH * 0.72;
    g.fillStyle = '#d5f58e';
    g.font = font(800, Math.min(34, rowH * 0.46));
    g.fillText(p.number !== undefined ? String(p.number).padStart(2, ' ') : '•', cx, cy);
    g.fillStyle = '#eef6e6';
    g.font = font(650, Math.min(46, rowH * 0.58));
    g.fillText(`${p.firstName}${p.lastName ? ` ${p.lastName[0]}.` : ''}`, cx + 58, cy);
  });

  g.fillStyle = 'rgba(238,246,230,0.45)';
  g.font = font(600, 24);
  g.textAlign = 'center';
  g.fillText('Répondez et suivez le match sur LevelUp', W / 2, H - 56);

  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

/** Partage natif (téléphone) ou téléchargement. */
export async function shareCard(blob: Blob, name: string, text: string) {
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch {
      /* partage annulé : on télécharge */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
