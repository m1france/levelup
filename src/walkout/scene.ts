import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontData from './fonts/barlow-black-italic.typeface.json';
import { SHAPE } from '../components/FutCard';
import type { WalkoutAudio } from './audio';
import {
  doorTexture, floorTexture, glowTexture, raysTexture, runnerTexture, screenTexture, signTexture, smokeTexture, sparkTexture, wallTexture,
} from './textures';

/**
 * Entrée sur le terrain façon FIFA, en 3D :
 * la caméra avance dans le tunnel des vestiaires (les néons s'allument un à un), s'arrête devant les portes,
 * qui s'ouvrent dans un flash ; elle continue d'avancer dans un espace de lumière rouge où surgissent, une à une,
 * toutes les lettres du prénom ; elle débouche enfin sur l'estrade : la carte à gauche,
 * l'enfant (photo en pied, en calque HTML) à droite, pyrotechnie et feux d'artifice.
 */

export interface WalkoutInput {
  team: { color: string; category: string };
  club: string;
  logo: HTMLImageElement | null;
  /** Lettres révélées : tout le prénom. */
  letters: string[];
  cardFront: HTMLCanvasElement;
  cardBack: HTMLCanvasElement;
  /** Une photo en pied est posée à droite de la carte. */
  hero: boolean;
  /** Ligne de l'écran géant (« Samedi 3 octobre · Match à Teyran »). */
  screenLine: string;
}

export type WalkoutEvent =
  | { type: 'start' }
  | { type: 'door' }
  | { type: 'letter'; index: number }
  | { type: 'collect'; index: number }
  | { type: 'stage' }
  | { type: 'hero' }
  | { type: 'card' }
  | { type: 'done' };

export interface WalkoutOptions {
  canvas: HTMLCanvasElement;
  /** Calque HTML de l'enfant, placé à chaque image sur l'estrade (projection de la caméra). */
  heroEl: HTMLElement | null;
  input: WalkoutInput;
  onEvent: (e: WalkoutEvent) => void;
}

/* ------------------------------------------------------------------ outils */

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeInCubic = (x: number) => Math.pow(clamp(x), 3);
const easeOutBack = (x: number, s = 1.9) => {
  const c = clamp(x) - 1;
  return 1 + (s + 1) * c * c * c + s * c * c;
};
const lerp = THREE.MathUtils.lerp;

/** Interpolation cubique monotone (pas de dépassement) : position de la caméra au fil du temps. */
function monotone(keys: [number, number][]) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  const at = (t: number): [number, number] => {
    if (t <= xs[0]) return [ys[0], 0];
    if (t >= xs[n - 1]) return [ys[n - 1], 0];
    let i = 0;
    while (t > xs[i + 1]) i++;
    const s = (t - xs[i]) / h[i];
    const s2 = s * s;
    const s3 = s2 * s;
    const y = (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h[i] * m[i + 1];
    const v = ((6 * s2 - 6 * s) / h[i]) * ys[i] + (3 * s2 - 4 * s + 1) * m[i] + ((-6 * s2 + 6 * s) / h[i]) * ys[i + 1] + (3 * s2 - 2 * s) * m[i + 1];
    return [y, v];
  };
  return at;
}

function canvasTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Couleur « lumineuse » : au-delà de 1, elle déclenche le halo (bloom). */
const hot = (color: THREE.ColorRepresentation, k: number) => new THREE.Color(color).multiplyScalar(k);

/* ------------------------------------------------------------------ décor */

const TUNNEL = { start: 9, end: -64, w: 6.4, h: 4.2 };
const DOOR_Z = -64;
const STATION_Z0 = -96;
const STATION_GAP = 30;
const STAGE_Z = -216;
const FLASH = 5.5;
const BEAT = 0.6;

interface Timeline {
  z: (t: number) => [number, number];
  letters: number[];
  collects: number[];
  stage: number;
  hero: number;
  spin: number;
  land: number;
  done: number;
}

/** Rythme des lettres : plus le prénom est long, plus elles s'enchaînent vite et rapprochées (l'estrade ne bouge pas). */
function letterPace(n: number) {
  return { step: BEAT * (n <= 3 ? 4 : n <= 6 ? 3 : 2), gap: n > 1 ? Math.min(STATION_GAP, 90 / (n - 1)) : STATION_GAP };
}

function timeline(n: number, finalZ: number): Timeline {
  const { step, gap } = letterPace(n);
  const keys: [number, number][] = [
    [0, 5.6],
    [0.7, 5.3],
    [2.0, -7],
    [3.3, -30],
    [4.4, -50],
    [5.0, -57.4],
    [5.55, -59.6],
    [6.05, -67.5],
  ];
  const letters: number[] = [];
  const collects: number[] = [];
  for (let i = 0; i < n; i++) {
    const zi = STATION_Z0 - i * gap;
    const a = FLASH + 2 * BEAT + i * step;
    const hold = step * 0.69;
    letters.push(a);
    collects.push(a + hold);
    if (i === 0) keys.push([6.5, -77]);
    keys.push([a, zi + 16.5], [a + step / 3, zi + 13.8], [a + hold, zi + 11.8]);
  }
  const lastA = letters.length ? letters[letters.length - 1] : FLASH + BEAT;
  const stage = lastA + (n ? step : 4 * BEAT);
  if (!n) keys.push([6.6, -80]);
  keys.push([stage, finalZ + 17], [stage + 0.75, finalZ + 3.5], [stage + 1.8, finalZ]);
  return {
    z: monotone(keys),
    letters,
    collects,
    stage,
    hero: stage + 0.45,
    spin: stage + 0.55,
    land: stage + 2 * BEAT,
    done: stage + 2.3,
  };
}

/* ------------------------------------------------------------------ shaders */

const beamMaterial = (color: THREE.Color, opacity: number) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFacing;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying float vFacing;
      void main() {
        float a = pow(vUv.y, 1.6) * pow(vFacing, 1.5) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

const gridMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uCam; uniform float uTime; uniform float uPulse; varying vec3 vWorld;
      float line(vec2 p) {
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vWorld.xz - uCam.xz);
        float fade = exp(-d * 0.06);
        float side = 1.0 - smoothstep(5.0, 26.0, abs(vWorld.x));
        float fine = line(vWorld.xz / 1.5) * 0.08;
        float bold = line(vWorld.xz / 7.5) * 0.3;
        // Onde lumineuse qui file vers l'avant.
        float wave = smoothstep(0.92, 1.0, fract(vWorld.z * 0.035 + uTime * 0.55));
        vec3 col = uColor * (fine + bold * (1.0 + wave * 2.5)) * fade * side;
        col += uColor * 0.05 * exp(-abs(vWorld.x) * 0.25) * fade * (1.0 + uPulse);
        gl_FragColor = vec4(col + vec3(0.004, 0.005, 0.009), 1.0);
      }`,
  });

const skyMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(uColor * 0.16, vec3(0.004, 0.005, 0.01), smoothstep(-0.05, 0.45, h));
        col += uColor * 0.12 * exp(-abs(h) * 14.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

/** Flashs des photographes dans les tribunes. */
const crowdMaterial = (tex: THREE.Texture) =>
  new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: tex }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aPhase; attribute float aRate; uniform float uTime; uniform float uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = sin(uTime * aRate + aPhase);
        vA = 0.12 + pow(max(s, 0.0), 60.0) * 3.0;
        gl_PointSize = (0.12 + vA * 0.25) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying float vA;
      void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * t.a * vA, t.a * vA); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

/** Finition : aberration chromatique, vignette, grain, flash blanc. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uTime: { value: 0 }, uAberr: { value: 0.002 }, uVignette: { value: 0.55 }, uGrain: { value: 0.03 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uFlash, uTime, uAberr, uVignette, uGrain; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 off = c * uAberr;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.25)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (hash(vUv * 873.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
      col = mix(col, vec3(1.0, 0.985, 0.95), clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* ------------------------------------------------------------------ particules */

/** Réserve de particules additives (étincelles, feux d'artifice, éclats de lettre). */
class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private base: Float32Array;
  private next = 0;
  constructor(readonly count: number, tex: THREE.Texture, size: number, private gravity = -4, private drag = 0.985) {
    this.pos = new Float32Array(count * 3).fill(-9999);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }),
    );
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
  }
  update(dt: number) {
    const k = Math.pow(this.drag, dt * 60);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -9999;
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k + this.gravity * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const a = this.life[i] / this.max[i];
      const f = a * a * (0.7 + 0.3 * Math.random());
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.pos.fill(-9999);
    this.col.fill(0);
  }
}

/** Confettis : petits rectangles qui tournoient en tombant. */
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private spin: Float32Array;
  private alive = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private tmp = new THREE.Vector3();
  constructor(readonly count: number, colors: THREE.Color[]) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.07, 0.12),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, metalness: 0.55, roughness: 0.35, emissive: 0x222222 }),
      count,
    );
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.r = new Float32Array(count * 3);
    this.spin = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, colors[i % colors.length]);
    this.hide();
  }
  hide() {
    this.alive = false;
    for (let i = 0; i < this.count; i++) {
      this.m.makeTranslation(0, -999, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  burst(center: THREE.Vector3) {
    this.alive = true;
    for (let i = 0; i < this.count; i++) {
      const near = i % 4 === 0;
      this.p.set([center.x + (Math.random() - 0.5) * (near ? 5 : 12), center.y + 5 + Math.random() * 6, center.z + (near ? 4 + Math.random() * 3 : (Math.random() - 0.5) * 7)], i * 3);
      this.v.set([(Math.random() - 0.5) * 1.2, -(0.7 + Math.random() * 0.9), (Math.random() - 0.5) * 0.6], i * 3);
      this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.spin.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5], i * 3);
    }
  }
  update(dt: number, time: number) {
    if (!this.alive) return;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      this.p[j] += (this.v[j] + Math.sin(time * 2 + i) * 0.35) * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      this.p[j + 2] += this.v[j + 2] * dt;
      this.r[j] += this.spin[j] * dt;
      this.r[j + 1] += this.spin[j + 1] * dt;
      this.r[j + 2] += this.spin[j + 2] * dt;
      this.q.setFromEuler(this.e.set(this.r[j], this.r[j + 1], this.r[j + 2]));
      this.m.compose(this.tmp.set(this.p[j], this.p[j + 1], this.p[j + 2]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ carte 3D */

function cardShape(width: number) {
  const k = width / 250;
  const shape = new THREE.Shape();
  const X = (x: number) => (x - 125) * k;
  const Y = (y: number) => (175 - y) * k;
  // Même tracé que la carte HTML (M, Q, L, Z).
  const tokens = SHAPE.match(/[MQLZ]|-?\d+(\.\d+)?/g)!;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') shape.moveTo(X(num()), Y(num()));
    else if (cmd === 'L') shape.lineTo(X(num()), Y(num()));
    else if (cmd === 'Q') {
      const cx = X(num());
      const cy = Y(num());
      shape.quadraticCurveTo(cx, cy, X(num()), Y(num()));
    }
  }
  return { shape, k };
}

function faceGeometry(shape: THREE.Shape, k: number) {
  const g = new THREE.ShapeGeometry(shape, 24);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (250 * k) + 0.5, pos.getY(i) / (350 * k) + 0.5);
  uv.needsUpdate = true;
  return g;
}

/** Reflet qui balaie la carte (et irisation selon l'angle). */
const shineMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmount: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFacing;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(normalMatrix * vec3(0.0, 0.0, 1.0)), normalize(-mv.xyz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAmount; varying vec2 vUv; varying float vFacing;
      void main() {
        float x = vUv.x + vUv.y * 0.55;
        float p = fract(uTime * 0.28) * 2.6 - 0.6;
        float band = smoothstep(0.14, 0.0, abs(x - p)) * 0.4;
        vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + x * 1.4 + vFacing * 1.8));
        float edge = pow(1.0 - clamp(vFacing, 0.0, 1.0), 2.0);
        vec3 col = vec3(1.0, 0.93, 0.75) * band + mix(vec3(1.0, 0.85, 0.5), iri, 0.4) * (0.015 + edge * 0.08);
        gl_FragColor = vec4(col * uAmount, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

/* ------------------------------------------------------------------ scène */

export function createWalkout({ canvas, heroEl, input, onEvent }: WalkoutOptions) {
  const team = new THREE.Color(input.team.color || '#d7141e');
  // Couleur d'accent visible même si le club a une couleur très sombre.
  const accent = team.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  accent.getHSL(hsl);
  accent.setHSL(hsl.h, Math.max(hsl.s, 0.55), clamp(hsl.l, 0.42, 0.6));
  // Rouge clair lumineux (étincelles, rayons, pyrotechnie) : décline le rouge du club.
  const flare = new THREE.Color('#ff6a5c');
  const coolWhite = new THREE.Color('#e9f0ff');

  const mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x020306, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x040509, 0.012);
  scene.fog = fog;
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Studio sombre avec quelques boîtes à lumière : reflets contrastés sur l'or (plus chic qu'un éclairage uniforme).
  const envTex = (() => {
    const env = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(1, 1);
    env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ color: 0x050507, side: THREE.BackSide })));
    const panel = (w: number, h: number, x: number, y: number, z: number, color: number, k: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.scale.set(w, h, 1);
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(9, 3, 0, 9, 1, 0xffffff, 7);
    panel(2, 9, -8, 1, 4, 0xfff1dc, 5);
    panel(2, 9, 8, 1, 4, 0xfff1dc, 5);
    panel(4, 4, 0, 2, 10, 0xffffff, 3);
    panel(14, 2, 0, -3, -9, 0xffb347, 1.6);
    panel(3, 6, -6, 3, -7, 0xffffff, 2);
    const tex = pmrem.fromScene(env, 0.015).texture;
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    geo.dispose();
    return tex;
  })();

  // Reflets d'environnement réservés aux matériaux métalliques (lettres, carte, portes) : le reste reste dans l'ombre.
  const shiny = <M extends THREE.MeshStandardMaterial>(m: M, k: number) => {
    m.envMap = envTex;
    m.envMapIntensity = k;
    return m;
  };

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  camera.position.set(0, 1.65, 5.6);

  // Textures partagées.
  const texGlow = canvasTexture(glowTexture(), false);
  const texSpark = canvasTexture(sparkTexture(), false);
  const texRays = canvasTexture(raysTexture(), false);
  const texSmoke = canvasTexture(smokeTexture(), false);
  const disposables: { dispose(): void }[] = [texGlow, texSpark, texRays, texSmoke, envTex, pmrem];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const glowSprite = (color: THREE.Color, scale: number, opacity = 1) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.scale.setScalar(scale);
    track(m.material);
    return m;
  };

  /* ---------------------------------------------------------------- lumières */

  scene.add(new THREE.HemisphereLight(0x8090b0, 0x050507, 0.22));
  const camLight = new THREE.PointLight(0xffffff, 2.5, 9, 2);
  scene.add(camLight);
  // Réserve de 4 lumières déplacées selon la phase (tunnel, lettre en cours, estrade).
  const pool = Array.from({ length: 4 }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 16, 2);
    scene.add(l);
    return l;
  });
  const spotA = new THREE.SpotLight(0xffffff, 0, 30, 0.42, 0.6, 1.5);
  const spotB = new THREE.SpotLight(0xffffff, 0, 30, 0.42, 0.6, 1.5);
  spotA.position.set(-4.5, 10, STAGE_Z + 7);
  spotB.position.set(4.5, 10, STAGE_Z + 7);
  scene.add(spotA, spotB, spotA.target, spotB.target);

  /* ---------------------------------------------------------------- tunnel */

  const tunnel = new THREE.Group();
  scene.add(tunnel);
  const len = TUNNEL.start - TUNNEL.end;
  const cz = (TUNNEL.start + TUNNEL.end) / 2;

  const floorTex = track(canvasTexture(floorTexture()));
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(TUNNEL.w / 2, len / 2);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(TUNNEL.w, len)),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.74 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, cz);
  floor.renderOrder = 2;
  tunnel.add(floor);

  const runnerTex = track(canvasTexture(runnerTexture(input.team.color, input.club)));
  runnerTex.wrapT = THREE.RepeatWrapping;
  runnerTex.repeat.set(1, len / 16);
  const runner = new THREE.Mesh(track(new THREE.PlaneGeometry(1.7, len)), track(new THREE.MeshStandardMaterial({ map: runnerTex, roughness: 0.85, metalness: 0 })));
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.006, cz);
  runner.renderOrder = 3;
  tunnel.add(runner);

  const wallTex = track(canvasTexture(wallTexture(input.team.color, input.club, input.team.category)));
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(len / 16, 1);
  const wallMat = track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.72, metalness: 0.08 }));
  const wallGeo = track(new THREE.PlaneGeometry(len, TUNNEL.h));
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = side * -Math.PI / 2;
    wall.position.set((side * TUNNEL.w) / 2, TUNNEL.h / 2, cz);
    tunnel.add(wall);
  }
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(TUNNEL.w, len)), track(new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.9 })));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, TUNNEL.h, cz);
  tunnel.add(ceiling);

  // Éléments lumineux reflétés dans le sol brillant (copie inversée sous le sol).
  const glowing = new THREE.Group();
  tunnel.add(glowing);

  // Néons du plafond : deux rangées, allumées une à une.
  const rows: { z: number; mat: THREE.MeshBasicMaterial; on: number; at: number }[] = [];
  const panelGeo = track(new THREE.BoxGeometry(0.55, 0.05, 2.3));
  const housingGeo = track(new THREE.BoxGeometry(0.75, 0.08, 2.5));
  const housingMat = track(new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.6 }));
  for (let z = 4, r = 0; z > DOOR_Z + 3; z -= 4.6, r++) {
    const mat = track(new THREE.MeshBasicMaterial({ color: 0x000000, fog: true }));
    rows.push({ z, mat, on: 0, at: 0.35 + r * 0.075 });
    for (const x of [-1.45, 1.45]) {
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.position.set(x, TUNNEL.h - 0.04, z);
      tunnel.add(housing);
      const p = new THREE.Mesh(panelGeo, mat);
      p.position.set(x, TUNNEL.h - 0.08, z);
      glowing.add(p);
    }
  }
  // Filets LED au pied des murs et le long du plafond.
  const ledGeo = track(new THREE.BoxGeometry(0.035, 0.035, len));
  const ledTeam = track(new THREE.MeshBasicMaterial({ color: hot(accent, 2.2) }));
  const ledWhite = track(new THREE.MeshBasicMaterial({ color: hot(coolWhite, 0.9) }));
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(ledGeo, ledTeam);
    a.position.set(s * (TUNNEL.w / 2 - 0.03), 0.07, cz);
    glowing.add(a);
    const b = new THREE.Mesh(ledGeo, ledWhite);
    b.position.set(s * (TUNNEL.w / 2 - 0.03), TUNNEL.h - 0.03, cz);
    tunnel.add(b);
  }

  // Blasons du club aux murs.
  if (input.logo) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    x.beginPath();
    x.arc(256, 256, 236, 0, Math.PI * 2);
    x.fillStyle = '#fff';
    x.fill();
    x.lineWidth = 18;
    x.strokeStyle = '#d7141e';
    x.stroke();
    const k = Math.min(330 / input.logo.width, 330 / input.logo.height);
    x.drawImage(input.logo, 256 - (input.logo.width * k) / 2, 256 - (input.logo.height * k) / 2, input.logo.width * k, input.logo.height * k);
    const crestMat = track(new THREE.MeshStandardMaterial({ map: track(canvasTexture(c)), transparent: true, roughness: 0.4, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.08 }));
    const crestGeo = track(new THREE.PlaneGeometry(1.25, 1.25));
    for (let z = -6; z > DOOR_Z + 8; z -= 17)
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(crestGeo, crestMat);
        m.rotation.y = s * -Math.PI / 2;
        m.position.set(s * (TUNNEL.w / 2 - 0.02), 2.75, z);
        tunnel.add(m);
      }
  }

  // Porte du terrain : encadrement lumineux, deux vantaux, lumière derrière.
  const doorGroup = new THREE.Group();
  scene.add(doorGroup);
  const steel = track(shiny(new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.45, metalness: 0.75 }), 0.35));
  const opening = { w: 5.2, h: 3.45 };
  const frameParts: [number, number, number, number][] = [
    [-(opening.w / 2 + (TUNNEL.w / 2 - opening.w / 2) / 2), TUNNEL.h / 2, TUNNEL.w / 2 - opening.w / 2, TUNNEL.h],
    [opening.w / 2 + (TUNNEL.w / 2 - opening.w / 2) / 2, TUNNEL.h / 2, TUNNEL.w / 2 - opening.w / 2, TUNNEL.h],
    [0, opening.h + (TUNNEL.h - opening.h) / 2, opening.w, TUNNEL.h - opening.h],
  ];
  for (const [x, y, w, h] of frameParts) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, 0.3)), steel);
    m.position.set(x, y, DOOR_Z + 0.15);
    doorGroup.add(m);
  }
  const outline = track(new THREE.MeshBasicMaterial({ color: hot(accent, 4) }));
  for (const [x, y, w, h] of [
    [-opening.w / 2 - 0.05, opening.h / 2, 0.06, opening.h],
    [opening.w / 2 + 0.05, opening.h / 2, 0.06, opening.h],
    [0, opening.h + 0.05, opening.w + 0.16, 0.06],
  ] as const) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, 0.05)), outline);
    m.position.set(x, y, DOOR_Z + 0.32);
    doorGroup.add(m);
    const refl = m.clone();
    refl.position.y = -y;
    doorGroup.add(refl);
  }
  const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 0.4)), track(new THREE.MeshBasicMaterial({ map: track(canvasTexture(signTexture('Terrain'))), color: hot(0xffffff, 1.8), toneMapped: true })));
  sign.position.set(0, opening.h + 0.38, DOOR_Z + 0.31);
  doorGroup.add(sign);

  const leafGeo = track(new THREE.BoxGeometry(opening.w / 2 - 0.02, opening.h - 0.02, 0.12));
  const leaves: THREE.Group[] = [];
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? -1 : 1;
    const face = track(
      shiny(new THREE.MeshStandardMaterial({ map: track(canvasTexture(doorTexture(input.team.color, input.logo, side, side === 'left' ? 'ENTRÉE' : 'JOUEURS'))), roughness: 0.38, metalness: 0.45 }), 0.5),
    );
    const leaf = new THREE.Mesh(leafGeo, [steel, steel, steel, steel, face, steel]);
    leaf.position.set(-s * (opening.w / 4), opening.h / 2, 0);
    const pivot = new THREE.Group();
    pivot.position.set((s * opening.w) / 2, 0, DOOR_Z);
    pivot.add(leaf);
    doorGroup.add(pivot);
    leaves.push(pivot);
  }
  // Lumière derrière la porte : filet dans l'interstice, rai sous la porte, grand halo.
  const behind = new THREE.Mesh(track(new THREE.PlaneGeometry(9, 7)), track(new THREE.MeshBasicMaterial({ color: hot(0xfff1d0, 3), fog: false })));
  behind.position.set(0, 3, DOOR_Z - 1.2);
  doorGroup.add(behind);
  const gap = new THREE.Mesh(track(new THREE.PlaneGeometry(0.035, opening.h)), track(new THREE.MeshBasicMaterial({ color: hot(0xfff1d0, 9), fog: false })));
  gap.position.set(0, opening.h / 2, DOOR_Z + 0.07);
  doorGroup.add(gap);
  const gapGlow = glowSprite(new THREE.Color(0xfff0cc), 1);
  gapGlow.scale.set(1.3, 5.2, 1);
  gapGlow.position.set(0, opening.h / 2, DOOR_Z + 0.2);
  doorGroup.add(gapGlow);
  const spill = new THREE.Mesh(
    track(new THREE.PlaneGeometry(6, 3)),
    track(new THREE.MeshBasicMaterial({ map: texGlow, color: new THREE.Color(0xffe8b0), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })),
  );
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, 0.02, DOOR_Z + 0.9);
  doorGroup.add(spill);
  // Rais de lumière qui s'échappent de l'interstice et sous la porte.
  const doorRays = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1, 1)),
    track(new THREE.MeshBasicMaterial({ map: texRays, color: new THREE.Color(0xfff0d0), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })),
  );
  doorRays.scale.set(7, 9, 1);
  doorRays.position.set(0, opening.h / 2, DOOR_Z + 0.3);
  doorGroup.add(doorRays);
  const leakMat = track(new THREE.MeshBasicMaterial({ color: hot(0xfff1d0, 4), fog: false }));
  for (const [x, y, w, h] of [
    [0, 0.012, opening.w - 0.1, 0.022],
    [-opening.w / 2 + 0.01, opening.h / 2, 0.018, opening.h],
    [opening.w / 2 - 0.01, opening.h / 2, 0.018, opening.h],
    [0, opening.h - 0.01, opening.w, 0.018],
  ] as const) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), leakMat);
    m.position.set(x, y, DOOR_Z + 0.075);
    doorGroup.add(m);
  }
  const bigGlow = glowSprite(new THREE.Color(0xfff2d6), 16, 0);
  bigGlow.position.set(0, 2, DOOR_Z - 2);
  doorGroup.add(bigGlow);

  const mirror = glowing.clone();
  mirror.scale.y = -1;
  tunnel.add(mirror);

  /* ---------------------------------------------------------------- espace des lettres */

  const world = new THREE.Group();
  scene.add(world);
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(320, 32, 16)), track(skyMaterial(accent)));
  sky.position.z = -150;
  world.add(sky);
  const grid = new THREE.Mesh(track(new THREE.PlaneGeometry(120, 220)), track(gridMaterial(hot(accent, 1.4))));
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, 0, -175.5);
  world.add(grid);
  const gridU = (grid.material as THREE.ShaderMaterial).uniforms;

  // Faisceaux volumétriques qui balaient la salle.
  const beams: { mesh: THREE.Mesh; base: number; speed: number; amp: number }[] = [];
  const beamGeo = track(new THREE.ConeGeometry(2.2, 30, 40, 1, true));
  beamGeo.translate(0, -15, 0);
  for (let i = 0; i < 14; i++) {
    const white = i % 3 === 0;
    const mat = track(beamMaterial(white ? hot(0xfff4e0, 1) : hot(accent, 1.6), white ? 0.16 : 0.2));
    const m = new THREE.Mesh(beamGeo, mat);
    const s = i % 2 ? 1 : -1;
    m.position.set(s * (5 + (i % 4) * 2.5), 22, -80 - i * 11);
    m.rotation.z = s * 0.35;
    world.add(m);
    beams.push({ mesh: m, base: s * 0.35, speed: 0.25 + (i % 5) * 0.08, amp: 0.22 });
  }

  // Poussière en suspension.
  {
    const n = mobile ? 900 : 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 30, Math.random() * 12, -66 - Math.random() * 170], i * 3);
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(g, track(new THREE.PointsMaterial({ size: 0.07, map: texSpark, color: 0xffc4bd, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
    world.add(dust);
  }

  // Volutes de fumée le long du parcours : de la profondeur dans l'espace lumineux.
  const haze: THREE.Sprite[] = [];
  for (let i = 0; i < (mobile ? 18 : 30); i++) {
    const mat = track(
      new THREE.SpriteMaterial({ map: texSmoke, color: new THREE.Color().lerpColors(accent, new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0.12 + Math.random() * 0.1, depthWrite: false, rotation: Math.random() * 6 }),
    );
    const sp = new THREE.Sprite(mat);
    const side = i % 2 ? 1 : -1;
    sp.position.set(side * (2.5 + Math.random() * 7), 0.6 + Math.random() * 4, -74 - Math.random() * 110);
    sp.scale.setScalar(5 + Math.random() * 6);
    world.add(sp);
    haze.push(sp);
  }

  // Traînées de vitesse (visibles quand la caméra fonce).
  const streakMat = track(new THREE.MeshBasicMaterial({ color: hot(0xffffff, 2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  {
    const geo = track(new THREE.BoxGeometry(0.018, 0.018, 3.2));
    const n = 160;
    const streaks = new THREE.InstancedMesh(geo, streakMat, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.8 + Math.random() * 7;
      m.makeTranslation(Math.cos(a) * r, 1.7 + Math.sin(a) * r * 0.7, -70 - Math.random() * 150);
      streaks.setMatrixAt(i, m);
    }
    world.add(streaks);
  }

  // Stations des lettres.
  const font = new Font(fontData as never);
  const faceMat = track(shiny(new THREE.MeshStandardMaterial({ color: 0xe8262e, metalness: 1, roughness: 0.3, emissive: 0x5a0306, emissiveIntensity: 0.25 }), 0.95));
  const sideMat = track(shiny(new THREE.MeshStandardMaterial({ color: 0x7a0a0f, metalness: 1, roughness: 0.34, emissive: 0x160001 }), 1));
  const letterSparks = new Sparks(mobile ? 700 : 1100, texSpark, 0.12, -1.2, 0.965);
  world.add(letterSparks.points);
  // Lettre absente de la police : on retombe sur la lettre sans accent.
  const glyphs = (fontData as { glyphs: Record<string, unknown> }).glyphs;
  const glyph = (ch: string) => (glyphs[ch] ? ch : glyphs[ch.normalize('NFD')[0]] ? ch.normalize('NFD')[0] : '?');
  const { gap: letterGap } = letterPace(input.letters.length);
  const stations = input.letters.map(glyph).map((ch, i) => {
    const g = new THREE.Group();
    g.position.set(0, 0, STATION_Z0 - i * letterGap);
    world.add(g);
    const geo = track(
      new TextGeometry(ch, { font, size: 3.1, depth: 0.55, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.055, bevelSegments: 4 }),
    );
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
    const letter = new THREE.Mesh(geo, [faceMat, sideMat]);
    const holder = new THREE.Group();
    holder.position.y = 2.75;
    holder.add(letter);
    g.add(holder);
    const rays = new THREE.Mesh(
      track(new THREE.PlaneGeometry(11, 11)),
      track(new THREE.MeshBasicMaterial({ map: texRays, color: hot(flare, 1.1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })),
    );
    rays.position.set(0, 2.75, -1.6);
    g.add(rays);
    const ringA = new THREE.Mesh(track(new THREE.TorusGeometry(2.35, 0.03, 8, 160)), track(new THREE.MeshBasicMaterial({ color: hot(accent, 2.6), transparent: true })));
    const ringB = new THREE.Mesh(track(new THREE.TorusGeometry(2.62, 0.012, 6, 160)), track(new THREE.MeshBasicMaterial({ color: hot(flare, 2), transparent: true })));
    ringA.position.set(0, 2.75, -0.7);
    ringB.position.set(0, 2.75, -0.9);
    g.add(ringA, ringB);
    const flash = glowSprite(new THREE.Color(0xfff4dc), 9, 0);
    flash.position.set(0, 2.75, 0.5);
    g.add(flash);
    const floorGlow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(10, 10)),
      track(new THREE.MeshBasicMaterial({ map: texGlow, color: hot(accent, 1.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = 0.02;
    g.add(floorGlow);
    g.visible = false;
    return { g, holder, rays, ringA, ringB, flash, floorGlow };
  });

  /* ---------------------------------------------------------------- estrade */

  const stage = new THREE.Group();
  stage.position.z = STAGE_Z;
  scene.add(stage);
  const podium = new THREE.Mesh(track(new THREE.CylinderGeometry(3.2, 3.36, 0.5, 96)), track(shiny(new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.22, metalness: 0.75 }), 0.6)));
  podium.position.y = 0.25;
  stage.add(podium);
  const ringTop = new THREE.Mesh(track(new THREE.RingGeometry(2.86, 2.92, 128)), track(new THREE.MeshBasicMaterial({ color: hot(accent, 2) })));
  ringTop.rotation.x = -Math.PI / 2;
  ringTop.position.y = 0.503;
  const ringTop2 = new THREE.Mesh(track(new THREE.RingGeometry(3.08, 3.11, 128)), track(new THREE.MeshBasicMaterial({ color: hot(0xffffff, 1) })));
  ringTop2.rotation.x = -Math.PI / 2;
  ringTop2.position.y = 0.503;
  stage.add(ringTop, ringTop2);
  const ledSideMat = track(new THREE.MeshBasicMaterial({ color: hot(accent, 0.2) }));
  const ledSide = new THREE.Mesh(track(new THREE.CylinderGeometry(3.37, 3.37, 0.07, 96, 1, true)), ledSideMat);
  ledSide.position.y = 0.4;
  const ledSide2 = new THREE.Mesh(track(new THREE.CylinderGeometry(3.4, 3.4, 0.03, 96, 1, true)), track(new THREE.MeshBasicMaterial({ color: hot(0xffffff, 0.7) })));
  ledSide2.position.y = 0.09;
  stage.add(ledSide, ledSide2);
  const stageSpill = new THREE.Mesh(
    track(new THREE.PlaneGeometry(18, 18)),
    track(new THREE.MeshBasicMaterial({ map: texGlow, color: hot(accent, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })),
  );
  stageSpill.rotation.x = -Math.PI / 2;
  stageSpill.position.y = 0.015;
  stage.add(stageSpill);

  const screenTex = track(canvasTexture(screenTexture(input.team.color, input.logo, input.team.category, input.screenLine)));
  screenTex.wrapS = THREE.RepeatWrapping;
  screenTex.repeat.x = -1;
  screenTex.offset.x = 1;
  const arc = 1.95;
  const screenMat = track(new THREE.MeshBasicMaterial({ map: screenTex, color: hot(0xffffff, 0.05), side: THREE.BackSide }));
  const screen = new THREE.Mesh(track(new THREE.CylinderGeometry(11.5, 11.5, 6.6, 72, 1, true, Math.PI - arc / 2, arc)), screenMat);
  screen.position.y = 4.4;
  stage.add(screen);

  // Tours d'éclairage et faisceaux vers l'estrade.
  const stageBeams: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const tower = new THREE.Mesh(track(new THREE.BoxGeometry(0.35, 11, 0.35)), steel);
    tower.position.set(s * 7.2, 5.5, 3);
    stage.add(tower);
    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(beamGeo, track(beamMaterial(k ? hot(accent, 1.4) : hot(0xffffff, 1), 0)));
      b.position.set(s * 6.9, 10.4 - k * 1.2, 3);
      b.lookAt(new THREE.Vector3(s * (k ? 3.5 : 1.2), -20, STAGE_Z - 6));
      b.rotateX(-Math.PI / 2);
      stage.add(b);
      stageBeams.push(b);
    }
  }
  // Faisceau vertical sur l'enfant.
  const heroX = input.hero ? 1.25 : 0;
  const cardX = input.hero ? -1.15 : 0;
  const heroBeam = new THREE.Mesh(track(new THREE.ConeGeometry(1.2, 12, 32, 1, true).translate(0, -6, 0)), track(beamMaterial(hot(0xffffff, 1.2), 0)));
  heroBeam.position.set(heroX, 12.4, 0);
  stage.add(heroBeam);
  const heroPool = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.6, 3.6)),
    track(new THREE.MeshBasicMaterial({ map: texGlow, color: hot(0xffffff, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })),
  );
  heroPool.rotation.x = -Math.PI / 2;
  heroPool.position.set(heroX, 0.51, 0.3);
  stage.add(heroPool);

  // Tribunes plongées dans le noir, crépitantes de flashs.
  const crowd = (() => {
    const n = mobile ? 700 : 1300;
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const rate = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 2.9;
      const r = 17 + Math.random() * 16;
      pos.set([Math.sin(a) * r, 1 + Math.random() * 13 * (r / 33), Math.cos(a) * r], i * 3);
      phase[i] = Math.random() * 100;
      rate[i] = 0.4 + Math.random() * 1.6;
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aRate', new THREE.BufferAttribute(rate, 1));
    const m = track(crowdMaterial(texSpark));
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    stage.add(p);
    return m;
  })();

  // Fumée au ras du sol.
  const smokes: { s: THREE.Sprite; vx: number; vr: number; base: number }[] = [];
  for (let i = 0; i < (mobile ? 12 : 18); i++) {
    const mat = track(new THREE.SpriteMaterial({ map: texSmoke, color: new THREE.Color().lerpColors(new THREE.Color(0xffffff), accent, 0.35), transparent: true, opacity: 0, depthWrite: false, rotation: Math.random() * 6 }));
    const s = new THREE.Sprite(mat);
    // Au ras du sol, autour de l'estrade mais jamais devant la carte ou l'enfant.
    const a = Math.PI * (0.92 + Math.random() * 1.16);
    const r = 3.4 + Math.random() * 2.6;
    s.position.set(Math.cos(a) * r, 0.25 + Math.random() * 0.45, Math.sin(a) * r * 0.8);
    s.scale.setScalar(3 + Math.random() * 2);
    stage.add(s);
    smokes.push({ s, vx: (Math.random() - 0.5) * 0.15, vr: (Math.random() - 0.5) * 0.12, base: 0.16 + Math.random() * 0.12 });
  }

  const pyro = new Sparks(mobile ? 1000 : 1800, texSpark, 0.11, -7, 0.99);
  const fireworks = new Sparks(mobile ? 1400 : 2400, texSpark, 0.16, -2.2, 0.975);
  scene.add(pyro.points, fireworks.points);
  const confetti = new Confetti(mobile ? 260 : 420, [flare, new THREE.Color(0xffffff), accent, new THREE.Color(0xffd0cb)]);
  shiny(confetti.mesh.material as THREE.MeshStandardMaterial, 1);
  scene.add(confetti.mesh);

  // Carte 3D.
  const cardW = input.hero ? 1.75 : 2.05;
  const { shape, k } = cardShape(cardW);
  const frontTex = track(canvasTexture(input.cardFront));
  const backTex = track(canvasTexture(input.cardBack));
  const face = track(faceGeometry(shape, k));
  const depth = 0.028;
  const edgeGeo = track(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 2, curveSegments: 20 }));
  edgeGeo.translate(0, 0, -depth / 2);
  const edgeMat = track(shiny(new THREE.MeshStandardMaterial({ color: 0xe9bd5a, metalness: 1, roughness: 0.25, emissive: 0x3a2604 }), 1.5));
  // Faces de la carte non éclairées : couleurs exactes et texte net, le reflet vient du balayage lumineux.
  const frontMat = track(new THREE.MeshBasicMaterial({ map: frontTex, toneMapped: false }));
  const backMat = track(new THREE.MeshBasicMaterial({ map: backTex, toneMapped: false }));
  const shineMat = track(shineMaterial());
  const cardRig = new THREE.Group();
  const cardSpin = new THREE.Group();
  cardRig.add(cardSpin);
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  const front = new THREE.Mesh(face, frontMat);
  front.position.z = depth / 2 + 0.0105;
  const shine = new THREE.Mesh(face, shineMat);
  shine.position.z = depth / 2 + 0.012;
  const back = new THREE.Mesh(face, backMat);
  back.rotation.y = Math.PI;
  back.position.z = -depth / 2 - 0.0105;
  cardSpin.add(edge, front, shine, back);
  const cardY = 0.5 + 0.34 + (cardW * 1.4) / 2;
  cardRig.position.set(cardX, cardY, 0.35);
  stage.add(cardRig);
  const cardRays = new THREE.Mesh(
    track(new THREE.PlaneGeometry(9, 9)),
    track(new THREE.MeshBasicMaterial({ map: texRays, color: hot(flare, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })),
  );
  cardRays.position.set(cardX, cardY, -0.6);
  stage.add(cardRays);
  const cardGlow = glowSprite(new THREE.Color(0xffe2a0), 5.5, 0);
  cardGlow.position.set(cardX, cardY, -1.1);
  stage.add(cardGlow);
  cardRig.visible = false;

  /* ---------------------------------------------------------------- post-traitement */

  // Pas de MSAA sur la cible : combiné au halo (bloom), certains navigateurs rendent une image vide. FXAA à la place.
  // Rendu HDR si l'appareil sait écrire des flottants 16 bits, sinon 8 bits (halo moins fin mais jamais d'écran noir).
  const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.38, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  track(rt);

  /* ---------------------------------------------------------------- cadrage final */

  let tl = timeline(stations.length, STAGE_Z + 9);
  const final = { y: 1.7, look: new THREE.Vector3(0, 1.7, STAGE_Z), z: STAGE_Z + 9, fov: 45 };
  let wideFov = 60;
  const layout = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    fxaa.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
    // Portrait : champ vertical plus large pour garder de la largeur.
    // Tunnel : grand angle (plus large en portrait) ; estrade : focale plus longue, moins de déformation.
    wideFov = clamp((2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(27)) / aspect) * 180) / Math.PI, 52, 74);
    camera.aspect = aspect;
    const portrait = aspect < 0.9;
    final.fov = portrait ? 50 : 34;
    // L'estrade occupe la bande entre le prénom (en haut) et les infos du match (en bas).
    const top = portrait ? 0.2 : 0.31;
    const bottom = portrait ? 0.66 : 0.71;
    const box = input.hero ? { x0: -2.1, x1: 2.45, y0: 0.45, y1: 3.4 } : { x0: -1.3, x1: 1.3, y0: 0.45, y1: 3.6 };
    const tv = Math.tan(THREE.MathUtils.degToRad(final.fov / 2));
    const fw = portrait ? 0.97 : 0.62;
    const d = clamp(Math.max((box.x1 - box.x0) / (2 * fw * tv * aspect), (box.y1 - box.y0) / (2 * (bottom - top) * tv)), 5.5, 24);
    const cy = (box.y0 + box.y1) / 2;
    const cx = (box.x0 + box.x1) / 2;
    // Le centre de l'écran vise yAim : le contenu se retrouve dans la bande [top, bottom].
    const yAim = cy - (1 - (top + bottom)) * d * tv;
    final.z = STAGE_Z + d;
    final.y = Math.max(0.9, yAim);
    final.look.set(cx, yAim, STAGE_Z);
    tl = timeline(stations.length, final.z);
  };

  /* ---------------------------------------------------------------- état */

  let audio: WalkoutAudio | null = null;
  let running = false;
  let t = 0;
  let speed = 1;
  let clock = 0;
  let prev = performance.now();
  let raf = 0;
  let disposed = false;
  let frames = 0;
  let slow = 0;
  let devFrozen = false;
  const fired = new Set<string>();
  const v3 = new THREE.Vector3();
  const look = new THREE.Vector3();
  let nextStep = 1.0;
  let pyroUntil = -1;
  const bursts: number[] = [];

  const fire = (key: string, at: number, fn: () => void) => {
    if (fired.has(key) || t < at) return;
    fired.add(key);
    fn();
  };

  const silent = { v: false };
  const sfx = (fn: (a: WalkoutAudio) => void) => {
    if (audio && !silent.v) fn(audio);
  };

  function burstLetter(i: number) {
    const s = stations[i];
    const c = new THREE.Vector3(0, 2.75, s.g.position.z);
    for (let k = 0; k < 160; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      v3.set(Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.2) * 3);
      letterSparks.emit(c, v3, Math.random() < 0.7 ? flare : accent, 0.8 + Math.random() * 0.9);
    }
  }

  function firework(x: number, y: number, z: number, color: THREE.Color) {
    const c = new THREE.Vector3(x, y, z);
    const n = mobile ? 140 : 220;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 5 + Math.random() * 2.2;
      v3.set(r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp);
      fireworks.emit(c, v3, k % 5 === 0 ? new THREE.Color(1, 1, 1) : color, 1.4 + Math.random() * 0.9);
    }
  }

  /* ---------------------------------------------------------------- boucle */

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    clock += dt;
    if (running && !devFrozen) t += dt * speed;
    update(dt);
    composer.render(dt);
    // Qualité adaptative : on baisse la résolution si l'appareil peine.
    frames++;
    if (dt > 0.028) slow++;
    if (frames === 90) {
      if (slow > 45 && dpr > 0.8) {
        dpr = Math.max(0.75, dpr - 0.35);
        renderer.setPixelRatio(dpr);
        layout();
      }
      frames = 0;
      slow = 0;
    }
  }

  function update(dt: number) {
    const T = t;
    const [zCam, vz] = tl.z(T);
    const speedAbs = Math.abs(vz);

    /* ----- tunnel : néons, pas, porte ----- */
    const inTunnel = T < FLASH + 0.8;
    tunnel.visible = inTunnel;
    doorGroup.visible = T < FLASH + 1.2;
    rows.forEach((r, i) => {
      const target = running && T >= r.at ? 1 : 0.012;
      if (running && T >= r.at && r.on < 0.5) {
        fire(`row${i}`, r.at, () => sfx((a) => a.lightClack(i * 0.6)));
      }
      // Petit clignotement à l'allumage, comme un vrai néon.
      const since = T - r.at;
      const flicker = running && since > 0 && since < 0.25 ? (Math.sin(since * 90) > 0 ? 1 : 0.2) : 1;
      r.on += (target - r.on) * Math.min(1, dt * 30);
      r.mat.color.copy(coolWhite).multiplyScalar(1.9 * r.on * flicker);
    });
    // Les 4 lumières suivent les néons allumés les plus proches devant la caméra.
    if (inTunnel) {
      const ahead = rows.filter((r) => r.z < zCam + 3).slice(0, 4);
      pool.forEach((l, i) => {
        const r = ahead[i];
        l.color.copy(coolWhite);
        l.distance = 13;
        if (!r) return void (l.intensity = 0);
        // Sous les néons mais assez bas : les murs et le sol reçoivent la lumière, le plafond reste sombre.
        l.position.set(0, 2.2, r.z + 0.6);
        l.intensity = 22 * r.on;
      });
    }
    if (running && T > 0.9 && T < 5.1 && T >= nextStep) {
      const i = Math.round(nextStep / 0.4);
      sfx((a) => a.step(i % 2 ? 0.25 : -0.25));
      nextStep += 0.4;
    }
    fire('rumble', 4.3, () => sfx((a) => a.rumble(FLASH - 4.3 - 0.2)));
    const glowUp = smooth(4.2, FLASH - 0.3, T);
    (gap.material as THREE.MeshBasicMaterial).color.setScalar(5 + glowUp * 9);
    gapGlow.material.opacity = 0.35 + glowUp * 0.35 + (running ? 0 : Math.sin(clock * 2) * 0.08);
    gapGlow.scale.set(1.3 + glowUp * 1.2, 5.2, 1);
    (spill.material as THREE.MeshBasicMaterial).opacity = 0.25 + glowUp * 0.35;
    const open = easeOutCubic((T - (FLASH - 0.3)) / 0.8);
    leaves[0].rotation.y = open * 1.75;
    leaves[1].rotation.y = -open * 1.75;
    bigGlow.material.opacity = smooth(FLASH - 0.3, FLASH, T) * (1 - smooth(FLASH + 0.2, FLASH + 1, T));
    (doorRays.material as THREE.MeshBasicMaterial).opacity = 0.08 + glowUp * 0.35 + smooth(FLASH - 0.35, FLASH - 0.1, T) * 0.5;
    doorRays.rotation.z = clock * 0.05;
    leakMat.color.setScalar(3 + glowUp * 6);
    fire('door', FLASH - 0.3, () => {
      sfx((a) => a.doorOpen());
      onEvent({ type: 'door' });
    });
    // Le beat démarre sur le flash : les lettres tombent sur les temps forts.
    fire('music', FLASH - 0.05, () => sfx((a) => a.startMusic()));

    /* ----- post : flash, halo, aberration ----- */
    const flash = smooth(FLASH - 0.2, FLASH, T) * (1 - smooth(FLASH, FLASH + 0.9, T));
    const landFlash = T > tl.land ? Math.max(0, 1 - (T - tl.land) / 0.35) * 0.55 : 0;
    const stageFlash = T > tl.stage ? Math.max(0, 1 - (T - tl.stage) / 0.3) * 0.35 : 0;
    finish.uniforms.uFlash.value = Math.max(flash * 0.95, landFlash, stageFlash);
    finish.uniforms.uTime.value = clock;
    finish.uniforms.uAberr.value = 0.0015 + clamp(speedAbs / 45) * 0.012;
    // Halo plus discret dans le tunnel (beaucoup de néons), plus généreux ensuite.
    const onStage = smooth(tl.land + 0.2, tl.land + 1.2, T);
    bloom.strength = lerp(lerp(0.32, 0.6, smooth(FLASH, FLASH + 1, T)), 0.34, onStage) + flash * 1.4 + clamp(speedAbs / 50) * 0.2;
    bloom.radius = lerp(lerp(0.18, 0.4, smooth(FLASH, FLASH + 1, T)), 0.22, onStage);
    renderer.toneMappingExposure = 1.05 + flash * 0.9;
    streakMat.opacity = clamp((speedAbs - 12) / 30) * 0.75;

    /* ----- brouillard selon la zone ----- */
    const zone = smooth(FLASH - 0.1, FLASH + 0.6, T);
    fog.density = lerp(0.012, 0.021, zone);
    fog.color.setRGB(lerp(0.016, accent.r * 0.05, zone), lerp(0.02, accent.g * 0.05, zone), lerp(0.035, accent.b * 0.06 + 0.02, zone));
    gridU.uCam.value.set(0, 0, zCam);
    gridU.uTime.value = clock;

    /* ----- faisceaux ----- */
    beams.forEach((b, i) => {
      b.mesh.rotation.z = b.base + Math.sin(clock * b.speed + i) * b.amp;
      b.mesh.rotation.x = Math.cos(clock * b.speed * 0.7 + i) * 0.15;
    });

    haze.forEach((h, i) => (h.material.rotation += dt * (i % 2 ? 0.05 : -0.04)));

    /* ----- lettres ----- */
    stations.forEach((s, i) => {
      const a = tl.letters[i];
      const c = tl.collects[i];
      s.g.visible = T > a - 2 && T < c + 1;
      if (!s.g.visible) return;
      const p = (T - a) / 0.6;
      const gone = easeInCubic((T - c) / 0.4);
      const sc = T < a ? 0.001 : Math.max(0.001, easeOutBack(p) * (1 - gone * 0.75));
      s.holder.scale.setScalar(sc);
      s.holder.rotation.y = (1 - easeOutCubic(p)) * -1.4 + Math.sin(clock * 1.3 + i) * 0.14 * smooth(0.6, 1.2, T - a);
      s.holder.rotation.x = Math.sin(clock * 0.9 + i) * 0.05;
      s.holder.position.y = 2.75 + gone * 6 + Math.sin(clock * 1.6) * 0.05;
      const on = smooth(a - 0.05, a + 0.3, T) * (1 - smooth(c, c + 0.35, T));
      (s.rays.material as THREE.MeshBasicMaterial).opacity = on * 0.26;
      s.rays.rotation.z += dt * 0.15;
      const ringS = T < a ? 0.001 : easeOutBack((T - a - 0.08) / 0.7, 1.3) * (1 + gone * 0.8);
      s.ringA.scale.setScalar(Math.max(0.001, ringS));
      s.ringB.scale.setScalar(Math.max(0.001, ringS * 1.02));
      s.ringA.rotation.set(Math.sin(clock * 0.8) * 0.25, Math.cos(clock * 0.6) * 0.25, clock * 0.4);
      s.ringB.rotation.set(Math.cos(clock * 0.7) * 0.3, Math.sin(clock * 0.5) * 0.3, -clock * 0.3);
      (s.ringA.material as THREE.MeshBasicMaterial).opacity = on;
      (s.ringB.material as THREE.MeshBasicMaterial).opacity = on;
      s.flash.material.opacity = T > a ? Math.max(0, 1 - (T - a) / 0.3) : 0;
      (s.floorGlow.material as THREE.MeshBasicMaterial).opacity = on * 0.7;
      fire(`letter${i}`, a, () => {
        burstLetter(i);
        sfx((au) => au.letterHit(i));
        onEvent({ type: 'letter', index: i });
      });
      fire(`collect${i}`, c, () => {
        sfx((au) => (i < stations.length - 1 ? au.whoosh(0.7) : au.riser(tl.stage - c)));
        onEvent({ type: 'collect', index: i });
      });
    });
    // Lumières sur la lettre en cours.
    if (!inTunnel && T < tl.stage - 0.2) {
      const cur = stations.findIndex((_, i) => T < tl.collects[i] + 0.4);
      const s = stations[cur];
      pool.forEach((l, i) => {
        if (!s) return void (l.intensity = 0);
        const z = s.g.position.z;
        const on = smooth(tl.letters[cur] - 0.3, tl.letters[cur] + 0.2, T);
        l.distance = 14;
        if (i === 0) l.position.set(-2.5, 5.5, z + 4.5), l.color.set(0xffffff), (l.intensity = 26 * on);
        else if (i === 1) l.position.set(3, 1, z + 3), l.color.copy(flare), (l.intensity = 14 * on);
        else if (i === 2) l.position.set(0, 4, z - 2.5), l.color.copy(accent), (l.intensity = 30 * on);
        else l.intensity = 0;
      });
    }
    letterSparks.update(dt);

    /* ----- estrade ----- */
    const st = smooth(tl.stage - 0.05, tl.stage + 0.25, T);
    stage.visible = T > (tl.collects.length ? tl.collects[tl.collects.length - 1] : tl.stage - 1) - 0.1;
    fire('stage', tl.stage, () => {
      sfx((a) => a.stageSlam());
      onEvent({ type: 'stage' });
    });
    ledSideMat.color.copy(accent).multiplyScalar(0.2 + st * 1.5);
    (stageSpill.material as THREE.MeshBasicMaterial).opacity = st * 0.28;
    screenMat.color.setScalar(0.05 + st * (1.35 + Math.sin(clock * (Math.PI * 2 / BEAT) / 2) * 0.08));
    stageBeams.forEach((b, i) => ((b.material as THREE.ShaderMaterial).uniforms.uOpacity.value = st * (i % 2 ? 0.2 : 0.14)));
    crowd.uniforms.uTime.value = clock;
    crowd.uniforms.uScale.value = (canvas.height || 800) * 0.5;
    smokes.forEach((m) => {
      m.s.position.x += m.vx * dt;
      m.s.material.rotation += m.vr * dt;
      m.s.material.opacity = st * m.base;
    });
    if (T > tl.stage - 1) {
      pool.forEach((l, i) => {
        l.distance = 16;
        if (i === 0) l.position.set(-3, 4, STAGE_Z + 4), l.color.set(0xffffff), (l.intensity = 30 * st);
        else if (i === 1) l.position.set(3.5, 3, STAGE_Z + 4), l.color.copy(flare), (l.intensity = 18 * st);
        else if (i === 2) l.position.set(-4, 3, STAGE_Z - 3), l.color.copy(accent), (l.intensity = 90 * st);
        else l.position.set(4, 3, STAGE_Z - 3), l.color.copy(accent), (l.intensity = 90 * st);
      });
    }
    spotA.intensity = st * 70;
    spotB.intensity = st * 45;
    spotA.target.position.set(cardX, cardY, STAGE_Z);
    spotB.target.position.set(heroX, 1.6, STAGE_Z);

    // L'enfant apparaît dans un faisceau.
    const heroIn = smooth(tl.hero, tl.hero + 0.55, T);
    (heroBeam.material as THREE.ShaderMaterial).uniforms.uOpacity.value = input.hero ? smooth(tl.hero - 0.25, tl.hero + 0.1, T) * (0.3 - heroIn * 0.18) : 0;
    (heroPool.material as THREE.MeshBasicMaterial).opacity = input.hero ? heroIn * 0.55 : 0;
    fire('hero', tl.hero, () => onEvent({ type: 'hero' }));

    // La carte tombe en tourbillonnant puis se pose, face visible.
    cardRig.visible = T > tl.spin;
    if (cardRig.visible) {
      const fall = easeOutCubic((T - tl.spin) / (tl.land - tl.spin));
      const settle = T > tl.land ? Math.sin(Math.min(1, (T - tl.land) / 0.5) * Math.PI) * 0.06 : 0;
      cardRig.position.y = lerp(cardY + 7, cardY, fall) + Math.sin(clock * 1.4) * 0.04 * smooth(tl.land, tl.land + 1, T);
      cardRig.scale.setScalar(1 + settle);
      // Dos visible au départ (5π), deux tours et demi, face visible à l'atterrissage (0).
      cardSpin.rotation.y = T < tl.land ? (1 - fall) * 5 * Math.PI : (input.hero ? 0.1 : 0) + Math.sin(clock * 0.55) * 0.12 * smooth(tl.land, tl.land + 1.2, T);
      cardSpin.rotation.x = Math.sin(clock * 0.7) * 0.05;
      fire('spin', tl.spin, () => sfx((a) => a.cardSpin()));
    }
    const landed = smooth(tl.land - 0.05, tl.land + 0.15, T);
    (cardRays.material as THREE.MeshBasicMaterial).opacity = landed * (0.12 + Math.sin(clock * 2) * 0.02);
    cardRays.rotation.z += dt * 0.12;
    cardGlow.material.opacity = landed * 0.1 + (T > tl.land ? Math.max(0, 1 - (T - tl.land) / 0.5) * 0.6 : 0);
    shineMat.uniforms.uTime.value = clock;
    fire('land', tl.land, () => {
      sfx((a) => {
        a.cardLand();
        a.fadeMusic(10);
      });
      pyroUntil = T + 1.6;
      confetti.burst(new THREE.Vector3(0, 0, STAGE_Z));
      bursts.push(T + 0.45, T + 0.95, T + 1.5, T + 2.1);
      onEvent({ type: 'card' });
    });
    fire('done', tl.done, () => onEvent({ type: 'done' }));

    // Jets de pyrotechnie aux quatre coins de l'estrade.
    if (T < pyroUntil) {
      const n = Math.round(dt * (mobile ? 500 : 800));
      for (let i = 0; i < n; i++) {
        const corner = i % 4;
        const x = corner < 2 ? -3.4 : 3.4;
        const z = STAGE_Z + (corner % 2 ? 1.4 : -1.8);
        v3.set((Math.random() - 0.5) * 1.2, 8 + Math.random() * 4.5, (Math.random() - 0.5) * 1.2);
        pyro.emit(new THREE.Vector3(x, 0.55, z), v3, Math.random() < 0.8 ? flare : new THREE.Color(1, 1, 1), 0.9 + Math.random() * 0.5);
      }
    }
    while (bursts.length && T >= bursts[0]) {
      bursts.shift();
      const colors = [flare, accent, new THREE.Color(1, 1, 1), new THREE.Color().lerpColors(accent, new THREE.Color(1, 1, 1), 0.5)];
      firework((Math.random() - 0.5) * 12, 8 + Math.random() * 4, STAGE_Z - 7 - Math.random() * 5, colors[Math.floor(Math.random() * colors.length)].clone().multiplyScalar(2.2));
    }
    pyro.update(dt);
    fireworks.update(dt);
    confetti.update(dt, clock);

    /* ----- caméra ----- */
    const end = smooth(tl.stage + 0.6, tl.stage + 1.8, T);
    const bob = inTunnel && running ? Math.sin(T * Math.PI * 2.5) * 0.025 * smooth(0.8, 1.4, T) * (1 - smooth(4.6, 5.2, T)) : 0;
    const shake = (smooth(4.4, FLASH - 0.2, T) * (1 - smooth(FLASH - 0.2, FLASH + 0.4, T)) * 0.02 + (T > tl.land ? Math.max(0, 1 - (T - tl.land) / 0.4) * 0.05 : 0)) * (running ? 1 : 0);
    const reveal = smooth(FLASH + 0.2, FLASH + 1.2, T);
    const yBase = lerp(1.65, 2.05, reveal);
    const orbit = smooth(tl.done - 0.8, tl.done + 1.5, T);
    camera.position.set(
      lerp(Math.sin(clock * 0.37) * 0.04, final.look.x + Math.sin(clock * 0.22) * 0.35 * orbit, end) + (Math.random() - 0.5) * shake,
      lerp(yBase + bob, final.y + Math.sin(clock * 0.3) * 0.05 * orbit, end) + (Math.random() - 0.5) * shake,
      zCam,
    );
    look.set(lerp(0, final.look.x, end), lerp(lerp(1.62, 2.5, reveal), final.look.y, end), lerp(zCam - 12, STAGE_Z, end));
    camera.lookAt(look);
    // « Coup de zoom » à chaque lettre et à l'atterrissage de la carte.
    let punch = 0;
    for (const a of tl.letters) if (T > a) punch += Math.exp(-(T - a) * 7) * 4;
    if (T > tl.land) punch += Math.exp(-(T - tl.land) * 6) * 3;
    camera.fov = lerp(wideFov, final.fov, end) - punch;
    camera.updateProjectionMatrix();
    camera.rotateZ(Math.sin(clock * 0.5) * 0.004 + (inTunnel ? 0 : Math.sin(T * 0.8) * 0.008 * (1 - end)));
    camLight.position.copy(camera.position).add(v3.set(0, 0.4, -1.5));
    camLight.intensity = inTunnel ? 5 : 2 * (1 - end);

    /* ----- calque HTML de l'enfant ----- */
    if (heroEl) {
      camera.updateMatrixWorld();
      if (T < tl.hero - 0.5) heroEl.style.visibility = 'hidden';
      else {
        const hz = STAGE_Z + 0.3;
        const p0 = v3.set(heroX - 1.15, 0.5, hz).project(camera);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const x0 = ((p0.x + 1) / 2) * w;
        const yb = ((1 - p0.y) / 2) * h;
        const p1 = v3.set(heroX + 1.15, 3.35, hz).project(camera);
        const x1 = ((p1.x + 1) / 2) * w;
        const yt = ((1 - p1.y) / 2) * h;
        heroEl.style.visibility = 'visible';
        heroEl.style.transform = `translate3d(${x0.toFixed(1)}px, ${yt.toFixed(1)}px, 0)`;
        heroEl.style.width = `${(x1 - x0).toFixed(1)}px`;
        heroEl.style.height = `${(yb - yt).toFixed(1)}px`;
        heroEl.style.setProperty('--in', heroIn.toFixed(3));
      }
    }
  }

  // Outils de mise au point (dev) : avancer la scène image par image quand l'onglet est masqué.
  if (import.meta.env.DEV)
    (window as unknown as { __walkout: unknown }).__walkout = {
      renderer, scene, camera, composer,
      getT: () => t,
      state: () => ({ t, running, speed, audio: audio ? audio.ctx.state : null, rows: rows.map((r) => +r.on.toFixed(2)), bloom: bloom.strength, exposure: renderer.toneMappingExposure, cam: camera.position.toArray().map((v) => +v.toFixed(2)) }),
      freeze(on = true) {
        devFrozen = on;
      },
      seek(target: number) {
        devFrozen = true;
        document.documentElement.classList.add('fw-noanim');
        while (t < target) {
          const d = Math.min(1 / 30, target - t);
          t += d;
          clock += d;
          update(d);
        }
        composer.render(0);
        // Copie du rendu dans une image : visible même quand le navigateur ne compose plus le canvas.
        let img = document.getElementById('fw-debug-snap') as HTMLImageElement | null;
        if (!img) {
          img = document.createElement('img');
          img.id = 'fw-debug-snap';
          img.className = 'fw-canvas ready';
          canvas.after(img);
        }
        img.src = canvas.toDataURL('image/jpeg', 0.92);
        return new Promise((r) => setTimeout(() => r('ok'), 120));
      },
    };

  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  layout();
  // Précompilation des shaders : pas d'à-coup quand un élément apparaît pour la première fois.
  void renderer.compileAsync(scene, camera).catch(() => undefined);
  raf = requestAnimationFrame(frame);

  return {
    /** Lance l'animation (après un geste, pour le son). */
    start(a: WalkoutAudio | null) {
      audio = a;
      running = true;
      prev = performance.now();
      onEvent({ type: 'start' });
    },
    /** Maintenir le doigt appuyé : accélère. */
    fast(on: boolean) {
      speed = on ? 2.6 : 1;
    },
    /** Passe directement à l'estrade. */
    skip() {
      if (!running) return;
      const target = tl.stage - 0.4;
      if (t >= target) return;
      silent.v = true;
      t = target;
      update(0);
      silent.v = false;
      audio?.startMusic();
      audio?.crowd(0.3, 5200, 0.3);
    },
    get finished() {
      return t >= tl.done;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      for (const d of disposables) d.dispose();
      letterSparks.points.geometry.dispose();
      pyro.points.geometry.dispose();
      fireworks.points.geometry.dispose();
      confetti.mesh.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}

export type Walkout = ReturnType<typeof createWalkout>;
