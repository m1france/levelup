/**
 * Éclair de la conférence de presse, façon Duolingo, dessiné au canevas :
 * un gros éclair jaune, plat et arrondi, tombe du haut de l'écran en s'étirant, s'écrase au centre
 * (écrasement, rebond), lance une onde et des rayons, puis se pose en badge au sommet du cercle
 * qui s'ouvre ; des étincelles à quatre branches et des confettis ronds jaillissent autour.
 */

export interface Portal {
  /** Centre et rayons de la brèche, en pixels CSS. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

type Pt = [number, number];

const YELLOW = '#ffc800';
const SHADE = '#e69500';
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeIn = (t: number) => clamp(t) ** 2.2;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
/** Rebond franc (dépasse puis revient). */
const backOut = (t: number, c = 2.2) => {
  const x = clamp(t) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};
/** Ressort amorti : 1 → 0 en oscillant (écrasement de l'éclair). */
const spring = (t: number) => (t < 0 ? 0 : Math.exp(-7 * t) * Math.cos(t * 26));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Silhouette de l'éclair ⚡, hauteur 1, centrée sur l'origine. */
const BOLT: Pt[] = [
  [0.0, -0.5],
  [0.3, -0.5],
  [0.12, -0.1],
  [0.34, -0.1],
  [-0.16, 0.52],
  [-0.02, 0.08],
  [-0.26, 0.08],
];

interface Sparkle {
  x: number;
  y: number;
  size: number;
  born: number;
  life: number;
  color: string;
  spin: number;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  born: number;
  color: string;
}

export class LightningFx {
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private met = false;
  private meetTimer = 0;
  private sparkles: Sparkle[] = [];
  private dots: Dot[] = [];
  private nextSparkle = 0;
  private last = 0;
  /** Instant (s) où l'éclair touche le centre. */
  readonly meetAt = 0.34;
  portal: Portal = { x: 0, y: 0, rx: 0, ry: 0 };
  onMeet: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private opts: { color: string; core?: string; portal: Portal }) {
    this.g = canvas.getContext('2d')!;
    this.portal = opts.portal;
    this.resize();
    this.frame();
    // Onglet en arrière-plan (images ralenties) : l'impact a lieu quand même, à l'heure.
    this.meetTimer = window.setTimeout(() => this.meet(), this.meetAt * 1000 + 60);
  }

  private meet() {
    if (this.met) return;
    this.met = true;
    this.burst();
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

  private get palette() {
    return ['#ffffff', YELLOW, this.opts.color, '#ffe066', '#58cc02', '#1cb0f6'];
  }

  /** Impact : une gerbe d'étincelles et de confettis autour du cercle. */
  private burst() {
    const { x, y, rx, ry } = this.portal;
    const now = this.time();
    const pal = this.palette;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
      const d = rand(1.08, 1.45);
      this.sparkles.push({ x: x + Math.cos(a) * rx * d, y: y + Math.sin(a) * ry * d, size: rand(10, 22) * (rx / 220), born: now + rand(0, 0.12), life: rand(0.45, 0.7), color: pal[i % 3], spin: rand(-2, 2) });
    }
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(260, 620) * (rx / 220);
      this.dots.push({ x: x + Math.cos(a) * rx * 0.6, y: y + Math.sin(a) * ry * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, r: rand(3.5, 8) * (rx / 220), born: now, color: pal[i % pal.length] });
    }
  }

  private time() {
    return (performance.now() - this.t0) / 1000;
  }

  /* ---------------------------------------------------------------- formes */

  /** Éclair plat, coins arrondis, tranche foncée dessous et reflet blanc (relief Duolingo). */
  private bolt(cx: number, cy: number, size: number, sx: number, sy: number, rot: number, alpha = 1) {
    const g = this.g;
    const path = () => {
      g.beginPath();
      BOLT.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
    };
    g.save();
    g.globalAlpha = alpha;
    g.translate(cx, cy);
    g.rotate(rot);
    g.scale(size * sx, size * sy);
    g.lineJoin = 'round';
    g.lineWidth = 0.09;
    // Tranche (relief).
    g.save();
    g.translate(0, 0.07);
    path();
    g.fillStyle = SHADE;
    g.strokeStyle = SHADE;
    g.fill();
    g.stroke();
    g.restore();
    // Face.
    path();
    g.fillStyle = YELLOW;
    g.strokeStyle = YELLOW;
    g.fill();
    g.stroke();
    // Reflet.
    g.beginPath();
    g.moveTo(0.06, -0.42);
    g.lineTo(0.2, -0.42);
    g.lineCap = 'round';
    g.lineWidth = 0.06;
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.stroke();
    g.beginPath();
    g.arc(-0.14, 0.035, 0.03, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fill();
    g.restore();
  }

  /** Étincelle à quatre branches incurvées. */
  private star(x: number, y: number, r: number, rot: number, color: string, alpha: number) {
    const g = this.g;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const tip: Pt = [Math.cos(a) * r, Math.sin(a) * r];
      if (i === 0) g.moveTo(...tip);
      else g.quadraticCurveTo(0, 0, ...tip);
    }
    g.quadraticCurveTo(0, 0, r, 0);
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  /** Découpe l'intérieur du cercle : ce qui suit ne se dessine qu'autour de la brèche. */
  private outside(rx: number, ry: number) {
    const g = this.g;
    g.beginPath();
    g.rect(0, 0, this.w, this.h);
    g.ellipse(this.portal.x, this.portal.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    g.clip('evenodd');
  }

  /* ---------------------------------------------------------------- animation */

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const t = this.time();
    const dt = Math.min(0.05, t - this.last);
    this.last = t;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const { x: cx, y: cy, rx, ry } = this.portal;
    const size = Math.min(rx * 1.5, this.h * 0.42);

    if (t < this.meetAt) {
      // Chute : l'éclair accélère en s'étirant, traînées de vitesse au-dessus.
      const k = easeIn(t / this.meetAt);
      const y = lerp(-size * 0.8, cy, k);
      const stretch = lerp(1, 1.35, k);
      for (let i = 0; i < 3; i++) {
        const lx = cx + (i - 1) * size * 0.2;
        const len = size * (0.35 + 0.25 * k) * (i === 1 ? 1.3 : 1);
        g.beginPath();
        g.moveTo(lx, y - size * 0.55);
        g.lineTo(lx, y - size * 0.55 - len);
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = Math.max(4, size * 0.045);
        g.stroke();
      }
      this.bolt(cx, y, size, 1 / Math.sqrt(stretch), stretch, lerp(0.25, 0, k));
    } else {
      this.meet();
      const s = t - this.meetAt;
      const open = backOut(s / 0.45);
      const orx = rx * open, ory = ry * open;

      // Rayons de soleil qui tournent lentement autour du cercle.
      g.save();
      this.outside(orx, ory);
      g.translate(cx, cy);
      g.rotate(s * 0.35);
      const R = Math.hypot(this.w, this.h);
      const rays = 14;
      g.globalAlpha = 0.16 * easeOut(s / 0.5);
      g.fillStyle = this.opts.color;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, R, a, a + Math.PI / rays);
        g.closePath();
        g.fill();
      }
      g.restore();

      // Onde de choc : un anneau épais qui s'agrandit et s'amincit.
      if (s < 0.5) {
        const k = easeOut(s / 0.5);
        g.beginPath();
        g.ellipse(cx, cy, rx * (1 + k * 0.7), ry * (1 + k * 0.7), 0, 0, Math.PI * 2);
        g.strokeStyle = '#ffffff';
        g.globalAlpha = 1 - k;
        g.lineWidth = Math.max(2, rx * 0.12 * (1 - k));
        g.stroke();
        g.globalAlpha = 1;
      }

      // Traits d'impact : de courts bâtons arrondis qui partent du bord puis se rétractent.
      if (s < 0.42) {
        const k = s / 0.42;
        const out = easeOut(k * 1.6);
        const back = easeOut((k - 0.35) / 0.65);
        g.strokeStyle = YELLOW;
        g.lineWidth = Math.max(4, rx * 0.05);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
          const r0 = 1.12 + back * 0.35, r1 = 1.12 + out * 0.38;
          if (r1 <= r0) continue;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * orx * r0, cy + Math.sin(a) * ory * r0);
          g.lineTo(cx + Math.cos(a) * orx * r1, cy + Math.sin(a) * ory * r1);
          g.stroke();
        }
      }

      // Bord du cercle : anneau blanc épais avec tranche, comme un bouton Duolingo.
      const ring = Math.max(5, rx * 0.045);
      g.lineWidth = ring;
      g.beginPath();
      g.ellipse(cx, cy + ring * 0.55, orx, ory, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.stroke();
      g.beginPath();
      g.ellipse(cx, cy, orx, ory, 0, 0, Math.PI * 2);
      g.strokeStyle = this.opts.core ?? '#ffffff';
      g.stroke();

      // Confettis ronds, avec gravité.
      for (const d of this.dots) {
        const age = t - d.born;
        d.vy += 900 * dt;
        d.vx *= 0.985;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        g.globalAlpha = clamp(1.4 - age);
        g.beginPath();
        g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        g.fillStyle = d.color;
        g.fill();
      }
      g.globalAlpha = 1;
      this.dots = this.dots.filter((d) => t - d.born < 1.4 && d.y < this.h + 20);

      // Étincelles qui scintillent autour du cercle.
      if (s > 0.5 && t > this.nextSparkle) {
        this.nextSparkle = t + rand(0.14, 0.3);
        const a = rand(0, Math.PI * 2);
        const d = rand(1.1, 1.35);
        this.sparkles.push({ x: cx + Math.cos(a) * rx * d, y: cy + Math.sin(a) * ry * d, size: rand(8, 16) * (rx / 220), born: t, life: rand(0.5, 0.8), color: this.palette[Math.floor(rand(0, 3))], spin: rand(-1.5, 1.5) });
      }
      for (const sp of this.sparkles) {
        const k = (t - sp.born) / sp.life;
        if (k < 0) continue;
        const sc = k < 0.4 ? backOut(k / 0.4) : 1 - easeOut((k - 0.4) / 0.6);
        this.star(sp.x, sp.y, sp.size * sc, sp.spin * k, sp.color, 1);
      }
      this.sparkles = this.sparkles.filter((sp) => t - sp.born < sp.life);

      // L'éclair : écrasé à l'impact, il rebondit puis se pose en badge au sommet du cercle.
      const hop = easeOut((s - 0.12) / 0.4);
      const sq = spring(s);
      const bs = lerp(1, 0.45, hop) * (1 + (hop < 1 ? 0 : Math.sin(s * 4) * 0.03));
      const by = lerp(cy, cy - ory - size * 0.12, hop) - Math.sin(Math.PI * clamp((s - 0.12) / 0.4)) * size * 0.25;
      this.bolt(cx, by, size * bs, 1 + sq * 0.35, 1 - sq * 0.35, lerp(0, -0.12, hop) + Math.sin(s * 3) * 0.04 * hop);
    }
  };
}
