/**
 * Salle de conférence de presse en three.js, entièrement procédurale :
 * mur de logos, estrade, table nappée, micros, chevalets, deux présentateurs (têtes et corps sculptés,
 * veste noire au logo du club), journalistes et photographes, caméras de télévision, flashs
 * et réalisation (plans de caméra enchaînés, profondeur de champ, grain de pellicule).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SEAT, buildPresenterBody, fabric } from './body';
import { buildHead, headParams, skinTone, type HairStyle, type Head, type HeadOptions } from './head';
import { mesh } from './meshes';
import {
  backdropTexture, carpetTexture, cutLogo, fallbackLogo, glowTexture, loadImage, namePlate, screenTexture, skirtTexture, type Img,
} from './textures';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface ScenePresenter {
  name: string;
  role: string;
  style: HairStyle;
  hair: string;
  cap: string;
}

export interface SceneOptions {
  presenters: ScenePresenter[];
  speaker: number;
  logo: string | null;
  club: string;
  color: string;
  group: string;
  line: string;
  quality?: 'high' | 'low';
}

export type Cue = 'establish' | 'speak' | 'climax' | 'reveal' | 'final' | 'orbit';

interface Shot {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface Move {
  from: Shot;
  to: Shot;
  t0: number;
  dur: number;
  ease: (t: number) => number;
  shake: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Bruit lisse (somme de sinus) pour les micro-mouvements. */
const wobble = (t: number, seed: number) => Math.sin(t * 1.3 + seed) * 0.5 + Math.sin(t * 2.7 + seed * 1.7) * 0.3 + Math.sin(t * 0.6 + seed * 3.1) * 0.2;

function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

function shadowed<T extends THREE.Object3D>(o: T, receive = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = receive;
    }
  });
  return o;
}

/** Petit hachage d'un texte : chaque présentateur garde le même visage d'un chargement à l'autre. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Grain de pellicule, légère aberration chromatique et vignettage : l'image perd son aspect « jeu vidéo ». */
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uAberration: { value: 0.0012 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uAberration; varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uAberration * (0.5 + r2 * 4.0);
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float g = rnd(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5;
      c.rgb += g * uGrain * (1.0 - dot(c.rgb, vec3(0.299, 0.587, 0.114)) * 0.6);
      c.rgb *= 1.0 - r2 * 0.55;
      gl_FragColor = c;
    }`,
};

interface Person {
  root: THREE.Group;
  head: Head;
  torso: THREE.Mesh;
  mic: THREE.Mesh;
  micGlow: THREE.Sprite;
  seat: number;
  seed: number;
  look: number;
  lookTarget: number;
  nextLook: number;
}

interface Photographer {
  root: THREE.Group;
  flashPos: THREE.Vector3;
  sprite: THREE.Sprite;
  flash: number;
  raise: number;
  arms: THREE.Group;
  seed: number;
}

interface Extra {
  head: Head;
  seed: number;
}

/** Visages du public : quelques variantes (teint, coupe, barbe) réutilisées dans la salle. */
const CROWD: HeadOptions[] = Array.from({ length: 8 }, (_, i) => ({
  seed: 101 + i,
  tone: [0.1, 0.35, 0.2, 0.7, 0.15, 0.5, 0.9, 0.3][i],
  style: (['short', 'short', 'fringe', 'curly', 'long', 'bald', 'short', 'long'] as HairStyle[])[i],
  hair: ['#1d140f', '#3a2618', '#6b4a2e', '#0f0f10', '#8a6a44', '#4a4a4a', '#c9b08a', '#2a1a12'][i],
  beard: i % 3 === 0 ? 0.7 : i % 3 === 1 ? 0.25 : 0,
  cell: 0.0034,
  detail: false,
}));

interface Meshes {
  heads: THREE.BufferGeometry[];
  crowdHeads: THREE.BufferGeometry[];
  hands: THREE.BufferGeometry[];
  jacket: THREE.BufferGeometry;
  legs: THREE.BufferGeometry;
  seated: THREE.BufferGeometry;
  standing: THREE.BufferGeometry;
  arms: THREE.BufferGeometry;
}

export class PressScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private dof: BokehPass | null = null;
  private raf = 0;
  private start = performance.now();
  private now = 0;
  private move: Move | null = null;
  private queue: { at: number; fn: () => void }[] = [];
  private people: Person[] = [];
  private photographers: Photographer[] = [];
  private flashLights: THREE.PointLight[] = [];
  private tallies: THREE.Mesh[] = [];
  private flashRate = 0.6;
  private storm = 0;
  private talk = 0;
  private speaker = 0;
  private orbit = false;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private glow = glowTexture();
  private extras: Extra[] = [];
  private meshes!: Meshes;
  private presenterHeads: HeadOptions[] = [];
  private film: ShaderPass | null = null;
  onFlash: (() => void) | null = null;

  private constructor(private canvasEl: HTMLCanvasElement, private opts: SceneOptions) {
    const low = opts.quality === 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: !low, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.speaker = opts.speaker;
    this.scene.background = new THREE.Color('#07090f');
    this.scene.fog = new THREE.Fog('#07090f', 12, 26);
  }

  static async create(canvasEl: HTMLCanvasElement, opts: SceneOptions) {
    const s = new PressScene(canvasEl, opts);
    await s.build();
    s.setupPost();
    s.resize();
    s.resizeObs = new ResizeObserver(() => s.resize());
    s.resizeObs.observe(canvasEl);
    s.cut(s.shots().establishA);
    s.loop();
    return s;
  }

  /* ---------------------------------------------------------------- construction */

  private async build() {
    const { opts } = this;
    const logoImg = await loadImage(opts.logo);
    const logo: Img = logoImg ? cutLogo(logoImg).c : fallbackLogo(opts.club, opts.color);
    // Personnages sculptés en parallèle (workers) : têtes des présentateurs, veste, mains, public.
    this.presenterHeads = opts.presenters.map((p, i) => {
      const seed = (hash(p.name || `coach${i}`) % 997) + 1;
      return { style: p.style, hair: p.hair, capColor: p.cap, logo, seed, tone: 0.12 + (seed % 5) * 0.06, beard: 0.35 + (seed % 3) * 0.2, cell: opts.quality === 'low' ? 0.0018 : 0.0013 };
    });
    const [heads, hands, crowdHeads, jacket, legs, seated, upright, arms] = await Promise.all([
      Promise.all(this.presenterHeads.map((o) => mesh({ kind: 'head', p: headParams(o) }))),
      Promise.all(this.presenterHeads.map((o) => mesh({ kind: 'hand', skin: `#${skinTone(o.tone ?? 0.25).getHexString()}` }))),
      Promise.all(CROWD.map((o) => mesh({ kind: 'head', p: headParams(o) }))),
      mesh({ kind: 'body', name: 'jacket' }),
      mesh({ kind: 'body', name: 'legs' }),
      mesh({ kind: 'body', name: 'crowd-seated' }),
      mesh({ kind: 'body', name: 'crowd-standing' }),
      mesh({ kind: 'body', name: 'arms' }),
    ]);
    this.meshes = { heads, hands, crowdHeads, jacket, legs, seated, standing: upright, arms };
    const color = opts.color || '#c8102e';

    // Lumières.
    this.scene.add(new THREE.HemisphereLight('#9fb4ff', '#1a1410', 0.25));
    // Reflets d'environnement (peau, yeux, verre, métal).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;
    pmrem.dispose();
    const key = (x: number) => {
      const l = new THREE.SpotLight('#ffe6cc', 22, 14, 0.42, 0.75, 1.6);
      l.position.set(x * 0.4 + 0.9, 4.2, 4.0);
      l.target.position.set(x, 1.3, -0.6);
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      l.shadow.radius = 4;
      l.shadow.bias = -0.0002;
      l.shadow.normalBias = 0.012;
      this.scene.add(l, l.target);
    };
    const seats = opts.presenters.length > 1 ? [-0.8, 0.8] : [0];
    seats.forEach(key);
    const wash = new THREE.SpotLight('#ffffff', 9, 12, 0.7, 0.8, 1.4);
    wash.position.set(0, 3.8, 2.5);
    wash.target.position.set(0, 1.8, -2.2);
    this.scene.add(wash, wash.target);
    for (const x of [-3.2, 3.2]) {
      const rim = new THREE.PointLight(color, 10, 7, 1.8);
      rim.position.set(x, 2.8, -1.4);
      this.scene.add(rim);
    }
    const fill = new THREE.DirectionalLight('#c8d4ff', 0.5);
    fill.position.set(-4, 2.4, 6);
    this.scene.add(fill);
    // Contre-jour : détache les cheveux et les épaules noires du mur.
    for (const x of seats) {
      const back = new THREE.SpotLight('#dfe8ff', 7, 6, 0.5, 0.8, 1.5);
      back.position.set(x - 0.6, 3.3, -1.9);
      back.target.position.set(x, 1.4, -0.6);
      this.scene.add(back, back.target);
    }
    for (let i = 0; i < 3; i++) {
      const f = new THREE.PointLight('#e8f0ff', 0, 9, 1.6);
      this.flashLights.push(f);
      this.scene.add(f);
    }

    // Salle : sol, murs, plafond lumineux.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 4;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#141926', roughness: 0.9 });
    for (const x of [-5.5, 5.5]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), wallMat);
      w.position.set(x, 2.5, 5);
      w.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      w.receiveShadow = true;
      this.scene.add(w);
      // Rubans lumineux aux couleurs du club.
      for (let k = 0; k < 4; k++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.4, 0.04), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 9 }));
        strip.position.set(x + (x < 0 ? 0.03 : -0.03), 2.2, -1 + k * 2.6);
        this.scene.add(strip);
      }
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), wallMat);
    back.position.set(0, 2.5, -2.3);
    this.scene.add(back);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(12, 16), new THREE.MeshStandardMaterial({ color: '#0b0e16', roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 4.6, 5);
    this.scene.add(ceiling);
    const panelMat = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4e0', emissiveIntensity: 3.4 });
    for (let z = 0.5; z < 11; z += 2.6)
      for (const x of [-2.6, 0, 2.6]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), panelMat);
        p.rotation.x = Math.PI / 2;
        p.position.set(x, 4.58, z);
        this.scene.add(p);
      }

    // Mur de logos derrière la table.
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 3.7),
      new THREE.MeshStandardMaterial({ map: backdropTexture(logo, opts.club, color), roughness: 0.75 }),
    );
    wall.position.set(0, 1.85 + 0.3, -2.05);
    wall.receiveShadow = true;
    this.scene.add(wall);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1b1e25', metalness: 0.6, roughness: 0.4 });
    for (const x of [-3.75, 3.75]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.9, 0.1), frameMat);
      post.position.set(x, 2.1, -2.03);
      this.scene.add(post);
    }

    // Écran LED sur le côté.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3), new THREE.MeshStandardMaterial({ map: screenTexture(logo, opts.group, opts.line, color), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0 }));
    (screen.material as THREE.MeshStandardMaterial).emissiveMap = (screen.material as THREE.MeshStandardMaterial).map;
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.15;
    screen.position.set(4.6, 2.5, -0.9);
    screen.rotation.y = -0.75;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.42, 1.42, 0.08), frameMat);
    bezel.position.set(0, 0, -0.05);
    screen.add(bezel);
    this.scene.add(screen);

    // Estrade.
    const stage = new THREE.Group();
    stage.position.y = 0.3;
    this.scene.add(stage);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.3, 3.2), new THREE.MeshStandardMaterial({ color: '#10131b', roughness: 0.6 }));
    riser.position.set(0, -0.15, -0.55);
    riser.receiveShadow = true;
    stage.add(riser);
    const led = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.03, 0.03), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 10 }));
    led.position.set(0, -0.02, 1.06);
    stage.add(led);

    // Table nappée.
    const tableW = opts.presenters.length > 1 ? 3.4 : 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(tableW, 0.05, 0.85), new THREE.MeshStandardMaterial({ color: '#f5f5f7', roughness: 0.55 }));
    top.position.set(0, 0.76, 0);
    stage.add(shadowed(top));
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(tableW, 0.74),
      new THREE.MeshStandardMaterial({ map: skirtTexture(logo, opts.club, color, opts.group), roughness: 0.8 }),
    );
    skirt.position.set(0, 0.38, 0.43);
    stage.add(skirt);
    for (const x of [-tableW / 2, tableW / 2]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.74), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
      side.position.set(x, 0.38, 0);
      side.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
      stage.add(side);
    }

    // Présentateurs.
    opts.presenters.forEach((p, i) => {
      const person = this.buildPresenter(p, seats[i], color, i);
      stage.add(person.root);
      this.people.push(person);
    });

    // Journalistes : rangées de chaises face à la table, photographes debout sur les côtés.
    // Quelques visages différents, réutilisés (teint, coupe, barbe) : la salle se construit vite.
    const coats = ['#2d3440', '#3b2f2f', '#1f3a4d', '#4a4a4a', '#26303b', '#5b3b2a', '#20262e', '#3d4b3a', '#512f3c', '#2a2f45', '#6b6152', '#1c1c1f'];
    const faces = CROWD.map((_, i) => i);
    const chairMat = new THREE.MeshStandardMaterial({ color: '#0d0f14', roughness: 0.7 });
    const rows = [3.1, 4.3, 5.5];
    let n = 0;
    rows.forEach((z, r) => {
      const count = 6 - (r === 2 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const x = (k - (count - 1) / 2) * 1.05 + (r % 2 ? 0.25 : 0);
        if (Math.random() < 0.18) continue;
        const g = this.buildJournalist(pick(coats), faces[n++ % faces.length], chairMat, Math.random() < 0.35);
        g.position.set(x, 0, z);
        g.rotation.y = Math.PI + rand(-0.12, 0.12) - x * 0.04;
        this.scene.add(g);
      }
    });
    const standing: [number, number][] = [
      [-3.6, 2.4], [-2.9, 1.9], [3.5, 2.2], [2.8, 1.7], [-4.2, 3.6], [4.2, 3.8], [-1.8, 6.6], [1.6, 6.7],
    ];
    for (const [x, z] of standing) {
      const ph = this.buildPhotographer(pick(coats), faces[n++ % faces.length]);
      ph.root.position.set(x, 0, z);
      ph.root.lookAt(0, 0, -0.4);
      this.scene.add(ph.root);
      this.photographers.push(ph);
    }

    // Caméras de télévision sur trépied.
    for (const [x, z] of [[-4.6, 5.2], [4.6, 5.4], [0.2, 7.6]] as [number, number][]) {
      const cam = this.buildTvCamera(color, faces[n++ % faces.length]);
      cam.position.set(x, 0, z);
      cam.lookAt(0, 0, -0.4);
      this.scene.add(cam);
    }
  }

  private buildPresenter(p: ScenePresenter, x: number, color: string, index: number): Person {
    const root = new THREE.Group();
    root.position.set(x, 0, 0);

    // Chaise de conférence (assise rembourrée, dossier, piètement).
    const chairMat = new THREE.MeshPhysicalMaterial({ color: '#1a1d24', roughness: 0.45, clearcoat: 0.4 });
    const metal = new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.9, roughness: 0.25 });
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.08, 0.48, 3, 0.03), chairMat);
    seat.position.set(0, 0.47, -0.8);
    const backrest = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.72, 0.07, 3, 0.03), chairMat);
    backrest.position.set(0, 0.92, -1.02);
    backrest.rotation.x = -0.1;
    root.add(shadowed(seat), shadowed(backrest), limb(V(0, 0.05, -0.8), V(0, 0.43, -0.8), 0.02, metal));

    // Tête sculptée (teint, barbe et traits propres à chaque présentateur), corps en veste noire au logo du club.
    const ho = this.presenterHeads[index];
    const head = buildHead(ho, this.meshes.heads[index]);
    const body = buildPresenterBody(ho.logo!, head.skinMaterial, { jacket: this.meshes.jacket, legs: this.meshes.legs, hand: this.meshes.hands[index] });
    root.add(body.root);
    head.group.position.copy(SEAT.neck);
    head.group.rotation.x = 0.05;
    root.add(head.group);

    // Micro sur pied col-de-cygne, bonnette, bague lumineuse.
    const micMetal = new THREE.MeshStandardMaterial({ color: '#2b2e35', metalness: 0.85, roughness: 0.28 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.025, 32), micMetal);
    base.position.set(0.02, 0.8, 0.14);
    root.add(shadowed(base));
    const curve = new THREE.CatmullRomCurve3([V(0.02, 0.81, 0.14), V(0.02, 1.0, 0.1), V(0.015, 1.13, -0.12), V(0.01, 1.17, -0.3)]);
    root.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.007, 10), micMetal)));
    const mic = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.02, 0.06, 8, 16),
      new THREE.MeshPhysicalMaterial({ color: '#15171b', roughness: 0.6, sheen: 1, sheenColor: new THREE.Color('#444') }),
    );
    mic.position.set(0.01, 1.175, -0.33);
    mic.rotation.x = Math.PI / 2 - 0.3;
    root.add(mic);
    const micGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#ff3b30', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    micGlow.scale.set(0.035, 0.035, 1);
    micGlow.position.set(0.02, 0.825, 0.21);
    root.add(micGlow);

    // Chevalet nominatif, bouteille et verre d'eau.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.01), new THREE.MeshPhysicalMaterial({ map: namePlate(p.name, p.role, color), roughness: 0.35, clearcoat: 0.5 }));
    plate.position.set(0, 0.86, 0.3);
    plate.rotation.x = -0.25;
    root.add(shadowed(plate));
    const glass = new THREE.MeshPhysicalMaterial({ color: '#dff0ff', transmission: 0.95, roughness: 0.04, thickness: 0.01, ior: 1.45 });
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.21, 24), glass);
    bottle.position.set(x < 0 ? -0.34 : 0.34, 0.895, 0.12);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.14, 24), new THREE.MeshPhysicalMaterial({ color: '#cfe8ff', transmission: 0.9, roughness: 0.02, thickness: 0.05, ior: 1.33 }));
    water.position.y = -0.03;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.03, 16), new THREE.MeshStandardMaterial({ color }));
    cap.position.set(0, 0.12, 0);
    bottle.add(cap, water);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.095, 24, 1, true), glass);
    cup.position.set(x < 0 ? -0.24 : 0.24, 0.837, 0.2);
    root.add(bottle, cup);

    return { root, head, torso: body.torso, mic, micGlow, seat: x, seed: Math.random() * 10, look: 0, lookTarget: 0, nextLook: 2 };
  }

  /** Visage du public (variantes partagées) : tête sculptée plus grossièrement, sans cils ni sourcils poil à poil. */
  private crowdHead(i: number) {
    const head = buildHead(CROWD[i], this.meshes.crowdHeads[i]);
    this.extras.push({ head, seed: Math.random() * 10 });
    return head;
  }

  private buildJournalist(coat: string, face: number, chairMat: THREE.Material, notepad: boolean) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.46), chairMat);
    seat.position.set(0, 0.45, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.05), chairMat);
    back.position.set(0, 0.78, -0.24);
    g.add(seat, back);
    for (const s of [-1, 1]) for (const f of [-1, 1]) g.add(limb(V(s * 0.22, 0, f * 0.2), V(s * 0.22, 0.44, f * 0.2), 0.012, chairMat));
    const body = new THREE.Mesh(this.meshes.seated, fabric(coat, { sheen: 0.5, roughness: 0.8 }));
    g.add(body);
    const head = this.crowdHead(face);
    head.group.position.set(0, 1.13, -0.02);
    head.group.rotation.x = 0.08;
    g.add(head.group);
    if (notepad) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.22), new THREE.MeshStandardMaterial({ color: '#f3f0e6' }));
      pad.position.set(0, 0.82, 0.3);
      pad.rotation.x = -0.5;
      g.add(pad);
    }
    return shadowed(g, false);
  }

  private buildPhotographer(coat: string, face: number): Photographer {
    const root = new THREE.Group();
    const coatMat = fabric(coat, { sheen: 0.5, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5, metalness: 0.2 });
    root.add(new THREE.Mesh(this.meshes.standing, coatMat));
    const head = this.crowdHead(face);
    head.group.position.set(0, 1.56, 0);
    root.add(head.group);
    // Bras levés tenant l'appareil devant le visage.
    const arms = new THREE.Group();
    arms.add(new THREE.Mesh(this.meshes.arms, coatMat));
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.1, 0.085, 2, 0.012), dark);
    body.position.set(0, 1.66, 0.22);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.12, 20), dark);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.65, 0.31);
    const flashHead = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#fff', emissiveIntensity: 0 }));
    flashHead.position.set(0, 1.76, 0.24);
    arms.add(body, lens, flashHead);
    root.add(arms);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color('#f2f6ff').multiplyScalar(4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.scale.set(0.9, 0.9, 1);
    sprite.position.set(0, 1.76, 0.28);
    root.add(sprite);
    shadowed(root, false);
    return { root, flashPos: V(), sprite, flash: 0, raise: Math.random(), arms, seed: Math.random() * 10 };
  }

  private buildTvCamera(color: string, face: number) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#23262d', metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.add(limb(V(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45), V(0, 1.25, 0), 0.018, metal));
    }
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.3, 0.55, 2, 0.02), new THREE.MeshStandardMaterial({ color: '#1a1c21', roughness: 0.4 }));
    body.position.set(0, 1.45, 0);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.35, 24), metal);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.45, 0.42);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: '#0c0d10' }));
    hood.position.set(0, 1.45, 0.62);
    const logo = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.1, 0.3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
    logo.position.set(0.133, 1.47, 0);
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff1a1a', emissiveIntensity: 4 }));
    tally.position.set(0, 1.63, 0.18);
    this.tallies.push(tally);
    g.add(body, lens, hood, logo, tally);
    // Cadreur derrière la caméra, casque sur les oreilles.
    const op = new THREE.Group();
    op.add(new THREE.Mesh(this.meshes.standing, fabric('#1f232b', { sheen: 0.5, roughness: 0.8 })));
    const head = this.crowdHead(face);
    head.group.position.set(0, 1.56, 0);
    const headset = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#111' }));
    headset.position.set(0, 0.16, 0.01);
    head.group.add(headset);
    op.add(head.group);
    op.position.set(0, 0, -0.6);
    g.add(op);
    return shadowed(g, false);
  }

  private setupPost() {
    if (this.opts.quality === 'low') return;
    // Rendu multi-échantillonné : pas d'escaliers sur les silhouettes, les cheveux, les bords de la table.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Occlusion ambiante (contact des cols, des mains sur la table, creux du visage).
    const ao = new GTAOPass(this.scene, this.camera, 512, 512);
    ao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1, thickness: 1, scale: 1 });
    ao.blendIntensity = 0.7;
    composer.addPass(ao);
    // Profondeur de champ : l'arrière-plan se floute sur les gros plans.
    this.dof = new BokehPass(this.scene, this.camera, { focus: 3, aperture: 0.002, maxblur: 0.008 });
    composer.addPass(this.dof);
    // Seuil haut : seules les sources lumineuses (LED, écrans, voyants, flashs) brillent, pas le mur blanc éclairé.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 1.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    composer.addPass(this.film);
    this.composer = composer;
  }

  private resize() {
    const w = this.canvasEl.clientWidth || window.innerWidth;
    const h = this.canvasEl.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Écran vertical : on recule un peu pour garder la table dans le cadre.
    this.portrait = w / h < 0.9;
    this.camera.updateProjectionMatrix();
  }
  private portrait = false;

  /* ---------------------------------------------------------------- réalisation */

  private shots() {
    const seats = this.people.map((p) => p.seat);
    const sx = seats[this.speaker] ?? 0;
    const px = seats.find((_, i) => i !== this.speaker) ?? 0;
    // Yeux de l'orateur (estrade + cou + tête sculptée).
    const sp = this.people[this.speaker]?.head;
    const head = 0.3 + SEAT.neck.y + (sp?.eyeHeight ?? 0.15);
    const ez = SEAT.neck.z + (sp?.eyeForward ?? 0.09);
    const P = this.portrait ? 1.45 : 1;
    const shot = (pos: THREE.Vector3, target: THREE.Vector3, fov: number): Shot => ({ pos, target, fov: Math.min(75, fov * (this.portrait ? 1.35 : 1)) });
    return {
      establishA: shot(V(0.4, 3.1, 11.5), V(0, 1.6, 0), 38),
      establishB: shot(V(-0.2, 2.35, 8.2), V(0, 1.5, -0.3), 36),
      wideA: shot(V(-4.1, 1.8, 5.3), V(0.2, 1.45, -0.4), 34),
      wideB: shot(V(-2.4, 1.7, 4.2), V(0.1, 1.45, -0.4), 32),
      two: shot(V(0, 1.72, 3.9 * P), V(0, 1.45, -0.5), 31),
      twoClose: shot(V(0, 1.7, 3.2 * P), V(0, 1.5, -0.5), 30),
      speaker: shot(V(sx * 0.3 + 0.25, head + 0.04, 2.1 * P), V(sx, head - 0.16, ez - 0.03), 24),
      speakerClose: shot(V(sx * 0.3 + 0.06, head + 0.02, 1.05 * P), V(sx, head - 0.07, ez - 0.05), 21),
      push: shot(V(sx, head, 0.5), V(sx, head - 0.02, ez - 0.06), 28),
      partner: shot(V(px * 0.4 - 0.2, head + 0.04, 2.1 * P), V(px, head - 0.16, ez - 0.03), 24),
      overShoulder: shot(V(sx + 0.55, 2.05, -1.55), V(0, 1.1, 5), 44),
      final: shot(V(2.2, 2.2, 6.2), V(0, 1.5, -0.5), 36),
    };
  }

  private shotNow(): Shot {
    return { pos: this.camera.position.clone(), target: this.lookTarget.clone(), fov: this.camera.fov };
  }
  private lookTarget = V(0, 1.4, 0);

  private cut(s: Shot) {
    this.move = null;
    this.camera.position.copy(s.pos);
    this.lookTarget.copy(s.target);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
  }

  private moveTo(to: Shot, dur: number, { from, ease = easeInOut, shake = 0.004 }: { from?: Shot; ease?: (t: number) => number; shake?: number } = {}) {
    this.move = { from: from ?? this.shotNow(), to, t0: this.now, dur, ease, shake };
  }

  private at(delay: number, fn: () => void) {
    this.queue.push({ at: this.now + delay, fn });
  }

  /** Enchaînements de plans. */
  cue(c: Cue) {
    const s = this.shots();
    this.queue = [];
    this.orbit = false;
    this.storm = 0;
    this.people.forEach((p, i) => this.setMic(p, i === this.speaker && c !== 'establish'));
    switch (c) {
      case 'establish':
        this.flashRate = 1.4;
        this.moveTo(s.establishB, 3.4, { from: s.establishA, ease: easeOut });
        this.at(3.2, () => this.moveTo(s.wideB, 2.2, { from: s.wideA, ease: easeInOut }));
        break;
      case 'speak':
        this.flashRate = 0.9;
        this.moveTo(s.twoClose, 1.6, { from: s.two, ease: easeOut });
        this.at(1.5, () => this.moveTo(s.speakerClose, 4.5, { from: s.speaker, ease: easeOut, shake: 0.006 }));
        this.at(6, () => this.moveTo(s.partner, 2.2, { from: { ...s.partner, pos: s.partner.pos.clone().add(V(0.15, 0, 0.2)) }, ease: easeOut }));
        this.at(8.2, () => this.moveTo(s.speakerClose, 4, { from: s.speaker, ease: easeOut, shake: 0.006 }));
        break;
      case 'climax':
        this.flashRate = 0;
        this.storm = 1.1;
        this.moveTo(s.overShoulder, 0.9, { from: { ...s.overShoulder, pos: s.overShoulder.pos.clone().add(V(0.3, 0, 0.3)) }, ease: easeOut });
        this.at(0.9, () => this.moveTo(s.push, 0.55, { from: s.speaker, ease: easeIn, shake: 0.01 }));
        break;
      case 'reveal':
      case 'orbit':
        this.flashRate = 0.35;
        this.cut(s.two);
        this.orbit = true;
        break;
      case 'final':
        this.flashRate = 1.2;
        this.moveTo(s.final, 3, { from: s.establishB, ease: easeOut });
        break;
    }
  }

  private setMic(p: Person, on: boolean) {
    p.micGlow.material.opacity = on ? 0.9 : 0;
  }

  /** Niveau de parole de l'orateur (0 à 1), à chaque image. */
  setTalk(v: number) {
    this.talk = v;
  }

  setSpeaker(i: number) {
    this.speaker = Math.max(0, Math.min(this.people.length - 1, i));
  }

  /** Salve de flashs (révélation d'un joueur). */
  burst(n = 5) {
    for (let i = 0; i < n; i++) this.at(i * rand(0.03, 0.09), () => this.fire());
  }

  private fire() {
    const ph = pick(this.photographers);
    if (!ph) return;
    ph.flash = 1;
    ph.raise = 1;
    ph.sprite.getWorldPosition(ph.flashPos);
    const light = this.flashLights.reduce((a, b) => (a.intensity <= b.intensity ? a : b));
    light.position.copy(ph.flashPos);
    light.intensity = 45;
    this.onFlash?.();
  }

  /* ---------------------------------------------------------------- animation */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.start) / 1000;
    const dt = Math.min(0.05, t - this.now);
    this.now = t;

    for (const q of this.queue.filter((q) => q.at <= t)) q.fn();
    this.queue = this.queue.filter((q) => q.at > t);

    // Caméra.
    if (this.move) {
      const m = this.move;
      const k = Math.min(1, (t - m.t0) / m.dur);
      const e = m.ease(k);
      this.camera.position.lerpVectors(m.from.pos, m.to.pos, e);
      this.lookTarget.lerpVectors(m.from.target, m.to.target, e);
      this.camera.fov = THREE.MathUtils.lerp(m.from.fov, m.to.fov, e);
      this.camera.updateProjectionMatrix();
      if (k >= 1 && !this.orbit) this.move = { ...m, from: m.to, t0: t, dur: 1e9 };
    }
    if (this.orbit) {
      const s = this.shots().two;
      const a = Math.sin(t * 0.18) * 0.5;
      const r = s.pos.z + 0.5;
      this.camera.position.set(Math.sin(a) * r, s.pos.y + Math.sin(t * 0.3) * 0.08, Math.cos(a) * r - 0.5);
      this.lookTarget.copy(s.target);
    }
    // Caméra à l'épaule : léger tremblement.
    const shake = this.move?.shake ?? 0.003;
    const look = this.lookTarget.clone().add(V(wobble(t * 1.7, 1) * shake * 10, wobble(t * 1.9, 2) * shake * 8, 0));
    this.camera.lookAt(look);

    // Flashs aléatoires, et tempête au moment fort.
    const rate = this.flashRate + (this.storm > 0 ? 16 : 0);
    if (this.storm > 0) this.storm -= dt;
    if (Math.random() < rate * dt) this.fire();
    for (const l of this.flashLights) l.intensity *= Math.pow(0.0009, dt);
    for (const ph of this.photographers) {
      ph.flash = Math.max(0, ph.flash - dt * 7);
      ph.sprite.material.opacity = ph.flash;
      ph.sprite.scale.setScalar(0.5 + ph.flash * 0.9);
      ph.raise = Math.max(0, ph.raise - dt * 0.25);
      ph.arms.position.y = (1 - Math.min(1, ph.raise * 3)) * -0.18;
      ph.root.rotation.z = wobble(t, ph.seed) * 0.02;
    }
    for (const [i, tl] of this.tallies.entries()) (tl.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 3 + i) > -0.2 ? 12 : 0.4;
    // Public : petits mouvements de tête, clignements, regard vers la table.
    const stagePoint = this.people[this.speaker]?.head.group.getWorldPosition(V()) ?? V(0, 1.6, -0.6);
    for (const e of this.extras) {
      e.head.group.rotation.y = wobble(t * 0.4, e.seed) * 0.15;
      e.head.update(t, dt, stagePoint);
    }

    // Présentateurs : respiration, regard, parole ; l'orateur regarde la caméra, l'autre regarde parfois son voisin.
    const cam = this.camera.position;
    this.people.forEach((p, i) => {
      const talking = i === this.speaker ? this.talk : 0;
      p.torso.scale.y = 1 + Math.sin(t * 1.6 + p.seed) * 0.004;
      p.head.setTalk(talking);
      if (t > p.nextLook) {
        p.nextLook = t + rand(1.8, 4.5);
        const other = this.people.find((_, k) => k !== i);
        p.lookTarget = i !== this.speaker && other && Math.random() < 0.45 ? Math.sign(other.seat - p.seat) * 0.5 : rand(-0.25, 0.25);
      }
      const toCam = Math.atan2(cam.x - p.seat, cam.z + 0.64) * 0.45;
      const target = i === this.speaker ? toCam * 0.7 + p.lookTarget * 0.3 : p.lookTarget;
      p.look += (target - p.look) * Math.min(1, dt * 3);
      const hg = p.head.group;
      hg.rotation.y = p.look + wobble(t * 0.5, p.seed) * 0.05;
      hg.rotation.x = 0.04 + wobble(t * 0.7, p.seed + 3) * 0.02 + Math.sin(t * 5.5) * talking * 0.015;
      hg.rotation.z = wobble(t * 0.4, p.seed + 5) * 0.02;
      const other = this.people.find((_, k) => k !== i);
      const lookAt = i === this.speaker || !other || Math.abs(p.lookTarget) < 0.4 ? cam : other.head.group.getWorldPosition(V()).add(V(0, 0.15, 0.05));
      p.head.update(t, dt, lookAt);
    });

    if (this.dof) {
      const u = this.dof.uniforms as Record<string, { value: number }>;
      const dist = this.camera.position.distanceTo(this.lookTarget);
      u.focus.value += (dist - u.focus.value) * Math.min(1, dt * 6);
      // Plus la focale est longue (gros plan), plus le fond se floute.
      const want = this.camera.fov < 26 ? 0.006 : this.camera.fov < 32 ? 0.0035 : 0.0012;
      u.aperture.value += (want - u.aperture.value) * Math.min(1, dt * 3);
    }
    if (this.film) (this.film.uniforms as Record<string, { value: number }>).uTime.value = t;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
