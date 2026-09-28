/**
 * Éclair de la conférence de presse, dessiné au canevas :
 * deux traits de foudre jaillissent des bords gauche et droit de l'écran, avancent en zigzag jusqu'au centre,
 * s'y rejoignent dans un flash, puis ouvrent une brèche électrique (ovale crépitant) où s'inscrit le prénom.
 * Les tracés sont régénérés plusieurs fois par seconde : la foudre scintille comme une vraie décharge.
 */

export interface Portal {
  /** Centre et rayons de la brèche, en pixels CSS. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

type Pt = [number, number];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
/** Rebond léger à l'ouverture de la brèche. */
const backOut = (t: number) => {
  const c = 1.9;
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

/** Trait de foudre : déplacement du point milieu, récursif, perpendiculaire au segment. */
function zigzag(a: Pt, b: Pt, rough: number, depth: number, out: Pt[] = [a]): Pt[] {
  if (depth === 0) {
    out.push(b);
    return out;
  }
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const off = (Math.random() - 0.5) * rough * len;
  const m: Pt = [mx - (dy / len) * off, my + (dx / len) * off];
  zigzag(a, m, rough, depth - 1, out);
  zigzag(m, b, rough, depth - 1, out);
  return out;
}

interface Bolt {
  pts: Pt[];
  branches: Pt[][];
}

function makeBolt(a: Pt, b: Pt, rough = 0.42, depth = 7): Bolt {
  const pts = zigzag(a, b, rough, depth);
  const branches: Pt[][] = [];
  // Ramifications : de courtes fourches qui partent du tronc.
  const n = Math.floor(rand(2, 5));
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rand(0.15, 0.85) * (pts.length - 1));
    const p = pts[k];
    const q = pts[Math.min(pts.length - 1, k + 4)];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + rand(-1, 1) * 0.9;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * rand(0.06, 0.18);
    branches.push(zigzag(p, [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len], 0.5, 4));
  }
  return { pts, branches };
}

export class LightningFx {
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private bolts: [Bolt, Bolt] | null = null;
  private rim: Pt[] = [];
  private sparks: { a: Pt; b: Bolt; life: number }[] = [];
  private lastGen = 0;
  private met = false;
  private meetTimer = 0;
  /** Instant (s) où les deux éclairs se rejoignent. */
  readonly meetAt = 0.34;
  portal: Portal = { x: 0, y: 0, rx: 0, ry: 0 };
  onMeet: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private opts: { color: string; core?: string; portal: Portal }) {
    this.g = canvas.getContext('2d')!;
    this.portal = opts.portal;
    this.resize();
    this.frame();
    // Onglet en arrière-plan (images ralenties) : la rencontre a lieu quand même, à l'heure.
    this.meetTimer = window.setTimeout(() => this.meet(), this.meetAt * 1000 + 60);
  }

  private meet() {
    if (this.met) return;
    this.met = true;
    this.onMeet?.();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  setPortal(p: Portal) {
    this.portal = p;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.meetTimer);
  }

  /** Tracé d'une décharge : halo large, halo moyen, cœur blanc. */
  private stroke(pts: Pt[], width: number, alpha: number) {
    const g = this.g;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.globalAlpha = alpha * 0.1;
    g.strokeStyle = this.opts.color;
    g.lineWidth = width * 9;
    g.stroke();
    g.globalAlpha = alpha * 0.28;
    g.lineWidth = width * 3.4;
    g.stroke();
    g.globalAlpha = alpha * 0.9;
    g.strokeStyle = this.opts.core ?? '#f2f8ff';
    g.lineWidth = width;
    g.stroke();
  }

  private drawBolt(b: Bolt, upTo: number, width: number, alpha: number) {
    const n = Math.max(2, Math.floor(b.pts.length * upTo));
    this.stroke(b.pts.slice(0, n), width, alpha);
    for (const br of b.branches) if (b.pts.indexOf(br[0]) < n) this.stroke(br, width * 0.45, alpha * 0.7);
  }

  /** Bord de la brèche : ovale dont le rayon tremble. */
  private makeRim(rx: number, ry: number) {
    const { x, y } = this.portal;
    const N = 120;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const j = 1 + (Math.random() - 0.5) * 0.07 + Math.sin(a * 7 + performance.now() / 90) * 0.012;
      pts.push([x + Math.cos(a) * rx * j, y + Math.sin(a) * ry * j]);
    }
    pts[N] = pts[0];
    return pts;
  }

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const t = (performance.now() - this.t0) / 1000;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const { x: cx, y: cy, rx, ry } = this.portal;

    // Nouveaux tracés toutes les 45 ms environ : scintillement.
    const regen = t - this.lastGen > 0.045;
    if (regen) this.lastGen = t;
    const k = easeOut(t / this.meetAt);

    if (t < this.meetAt) {
      // Les deux éclairs avancent depuis les bords vers le centre.
      const yL = cy + Math.sin(t * 9) * this.h * 0.04;
      const yR = cy - Math.sin(t * 8) * this.h * 0.04;
      if (regen || !this.bolts) this.bolts = [makeBolt([-10, yL - this.h * 0.12], [cx, cy]), makeBolt([this.w + 10, yR + this.h * 0.1], [cx, cy])];
      const w = Math.max(2.4, this.w / 330);
      this.drawBolt(this.bolts[0], k, w, 1);
      this.drawBolt(this.bolts[1], k, w, 1);
      // Tête lumineuse de chaque éclair.
      for (const b of this.bolts) {
        const p = b.pts[Math.max(1, Math.floor(b.pts.length * k)) - 1];
        const r = 26 + Math.random() * 16;
        const grd = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(0.35, this.opts.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.8;
        g.fillStyle = grd;
        g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
      }
    } else {
      this.meet();
      const s = t - this.meetAt;
      // Flash de la rencontre.
      if (s < 0.5) {
        const r = Math.max(this.w, this.h) * (0.2 + s * 1.8);
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - s / 0.5)})`);
        grd.addColorStop(0.3, `rgba(200,230,255,${0.4 * (1 - s / 0.5)})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 1;
        g.fillStyle = grd;
        g.fillRect(0, 0, this.w, this.h);
      }
      // Brèche : l'ovale s'ouvre avec un léger rebond.
      const open = backOut(s / 0.42);
      const orx = rx * open, ory = ry * open;
      // Intérieur : lueur électrique.
      // Dégradé tracé dans le repère de l'ovale : la lueur suit tout le bord.
      g.globalAlpha = Math.min(1, s * 4) * 0.8;
      g.save();
      g.translate(cx, cy);
      g.scale(1, ory / Math.max(1, orx));
      const R = Math.max(1, orx);
      const inner = g.createRadialGradient(0, 0, 0, 0, 0, R);
      inner.addColorStop(0, 'rgba(40,60,110,0.0)');
      inner.addColorStop(0.7, 'rgba(60,110,190,0.08)');
      inner.addColorStop(0.96, this.opts.color);
      inner.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = inner;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.fill();
      g.restore();
      // Bord crépitant : deux passes décalées.
      if (regen || !this.rim.length) this.rim = this.makeRim(orx, ory);
      const w = Math.max(1.6, this.w / 700);
      this.stroke(this.rim, w, 0.95);
      this.stroke(this.makeRim(orx * 0.985, ory * 0.985), w * 0.6, 0.5);
      // Les éclairs restent accrochés à la brèche depuis les bords de l'écran, de plus en plus ténus.
      const fade = Math.max(0.15, 1 - s * 0.6);
      if (regen || !this.bolts) {
        const side = (dir: number): Bolt => makeBolt([dir < 0 ? -10 : this.w + 10, cy + rand(-0.15, 0.15) * this.h], [cx + dir * orx * 0.98, cy + rand(-0.25, 0.25) * ory], 0.38, 6);
        this.bolts = [side(-1), side(1)];
      }
      if (Math.random() < 0.85) {
        this.drawBolt(this.bolts[0], 1, Math.max(1.6, this.w / 620), fade);
        this.drawBolt(this.bolts[1], 1, Math.max(1.6, this.w / 620), fade);
      }
      // Étincelles : petits arcs qui sautent du bord vers l'extérieur.
      if (Math.random() < 0.35 && s > 0.2) {
        const a = Math.random() * Math.PI * 2;
        const p: Pt = [cx + Math.cos(a) * orx, cy + Math.sin(a) * ory];
        const len = rand(0.12, 0.3) * Math.min(orx, ory);
        this.sparks.push({ a: p, b: makeBolt(p, [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len], 0.6, 4), life: 1 });
      }
      for (const sp of this.sparks) {
        this.drawBolt(sp.b, 1, w * 0.7, sp.life);
        sp.life -= 0.16;
      }
      this.sparks = this.sparks.filter((sp) => sp.life > 0);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };
}
