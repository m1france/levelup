/**
 * Bande-son de l'entrée sur le terrain, entièrement synthétisée (aucun fichier) :
 * crampons sur le béton, néons qui s'allument,
 * grondement derrière la porte, impacts sur chaque lettre, beat d'hymne, feux d'artifice.
 */

type Ctx = AudioContext;

function noiseBuffer(ctx: Ctx, seconds: number, kind: 'white' | 'pink' | 'brown' = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
  }
  return buf;
}

function impulse(ctx: Ctx, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// La mineur : Am – F – C – G.
const CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ROOTS = [33, 29, 36, 31];

export class WalkoutAudio {
  readonly ctx: Ctx;
  private out: GainNode;
  private bus: DynamicsCompressorNode;
  private verb: GainNode;
  private white: AudioBuffer;
  private pink: AudioBuffer;
  private brown: AudioBuffer;
  private musicGain: GainNode;
  private padFilter: BiquadFilterNode;
  private timer = 0;
  private nextBeat = 0;
  private beat = 0;
  private musicStart = -1;
  private musicStopAt = Infinity;
  private closed = false;
  readonly bpm = 100;

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.bus = ctx.createDynamicsCompressor();
    this.bus.threshold.value = -16;
    this.bus.ratio.value = 4;
    this.bus.attack.value = 0.004;
    this.bus.release.value = 0.2;
    this.bus.connect(this.out).connect(ctx.destination);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 3.2, 2.6);
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.55;
    this.verb.connect(conv).connect(this.bus);

    this.white = noiseBuffer(ctx, 2, 'white');
    this.pink = noiseBuffer(ctx, 4, 'pink');
    this.brown = noiseBuffer(ctx, 4, 'brown');

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.8;
    this.musicGain.connect(this.bus);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.8;
    const padOut = ctx.createGain();
    padOut.gain.value = 0.5;
    this.padFilter.connect(padOut);
    padOut.connect(this.musicGain);
    padOut.connect(this.verb);
    if (ctx.state === 'suspended') void ctx.resume();
  }

  get now() {
    return this.ctx.currentTime;
  }

  setMuted(m: boolean) {
    this.out.gain.setTargetAtTime(m ? 0 : 0.9, this.now, 0.05);
  }

  /* ------------------------------------------------------------------ briques */

  private noise(t: number, dur: number, o: { buf?: AudioBuffer; type?: BiquadFilterType; f0?: number; f1?: number; q?: number; vol?: number; attack?: number; pan?: number; verb?: number; rate?: number }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = o.buf ?? this.white;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0 ?? 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    src.connect(f).connect(g).connect(p);
    p.connect(this.bus);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      p.connect(s).connect(this.verb);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, dur: number, o: { f0: number; f1?: number; type?: OscillatorType; vol?: number; attack?: number; verb?: number; pan?: number; dest?: AudioNode }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    osc.connect(g).connect(p);
    p.connect(o.dest ?? this.bus);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      p.connect(s).connect(this.verb);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number, vol = 0.9, dest: AudioNode = this.bus) {
    this.tone(t, 0.42, { f0: 150, f1: 42, vol, dest });
    this.noise(t, 0.03, { type: 'highpass', f0: 3000, vol: vol * 0.15 });
  }

  /* ------------------------------------------------------------------ effets */

  /** Un néon du plafond s'allume. */
  lightClack(dist = 0) {
    const t = this.now;
    const v = Math.max(0.15, 1 - dist * 0.12);
    this.noise(t, 0.05, { type: 'bandpass', f0: 2200, q: 2, vol: 0.35 * v, verb: 0.6 });
    this.tone(t, 0.16, { f0: 95, f1: 55, vol: 0.45 * v, verb: 0.4 });
    // Bourdonnement électrique qui s'installe.
    this.tone(t + 0.02, 0.5, { f0: 100, type: 'sawtooth', vol: 0.012 * v, attack: 0.05 });
  }

  /** Crampons sur le béton du tunnel. */
  step(pan: number) {
    const t = this.now;
    this.noise(t, 0.035, { type: 'highpass', f0: 3500, vol: 0.16, pan, verb: 0.9 });
    this.noise(t + 0.012, 0.03, { type: 'highpass', f0: 5000, vol: 0.09, pan, verb: 0.9 });
    this.tone(t, 0.08, { f0: 110, f1: 70, vol: 0.12, pan, verb: 0.5 });
  }

  /** Grondement derrière la porte, qui monte jusqu'à l'ouverture. */
  rumble(dur: number) {
    const t = this.now;
    this.noise(t, dur + 0.4, { buf: this.brown, type: 'lowpass', f0: 90, f1: 420, vol: 0.55, attack: dur * 0.9, verb: 0.2 });
    this.tone(t, dur + 0.3, { f0: 38, f1: 62, vol: 0.28, attack: dur * 0.9 });
    this.noise(t + dur * 0.4, dur * 0.6 + 0.3, { type: 'bandpass', f0: 400, f1: 5000, q: 1.4, vol: 0.18, attack: dur * 0.55 });
  }

  /** La porte s'ouvre : choc et souffle d'air. */
  doorOpen() {
    const t = this.now;
    this.kick(t, 1);
    this.tone(t, 1.6, { f0: 55, f1: 30, vol: 0.7 });
    this.noise(t, 1.4, { type: 'lowpass', f0: 400, f1: 9000, vol: 0.5, verb: 0.8 });
    this.noise(t, 2.5, { type: 'highpass', f0: 5000, vol: 0.18, verb: 1 });
  }

  /** Lettre révélée : coup de grosse caisse, souffle et scintillement. */
  letterHit(i: number) {
    const t = this.now;
    this.kick(t, 1);
    this.tone(t, 0.9, { f0: 62, f1: 36, vol: 0.55 });
    this.noise(t, 0.35, { type: 'lowpass', f0: 1800, f1: 300, vol: 0.4, verb: 0.7 });
    const base = [1760, 1975.5, 2349.3][i % 3];
    for (const [k, d] of [[1, 1.4], [1.5, 1.1], [2, 0.9], [3.01, 0.7]] as const) this.tone(t + 0.01, d, { f0: base * k, type: 'sine', vol: 0.05, verb: 1.2 });
  }

  /** Accélération : souffle qui balaie de gauche à droite. */
  whoosh(dur = 0.6, vol = 0.32) {
    const ctx = this.ctx;
    const t = this.now;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(3800, t + dur * 0.7);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 2.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.7, t);
    p.pan.linearRampToValueAtTime(0.7, t + dur);
    src.connect(f).connect(g).connect(p).connect(this.bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Montée avant l'estrade. */
  riser(dur: number) {
    const t = this.now;
    this.noise(t, dur, { type: 'bandpass', f0: 300, f1: 7000, q: 0.9, vol: 0.3, attack: dur * 0.95, verb: 0.4 });
    this.tone(t, dur, { f0: 110, f1: 440, type: 'sawtooth', vol: 0.04, attack: dur * 0.95, verb: 0.6 });
    this.tone(t, dur, { f0: 110.8, f1: 443, type: 'sawtooth', vol: 0.04, attack: dur * 0.95, verb: 0.6 });
  }

  /** Arrivée sur l'estrade : tout s'allume d'un coup. */
  stageSlam() {
    const t = this.now;
    this.kick(t, 1);
    this.tone(t, 2.2, { f0: 48, f1: 30, vol: 0.8 });
    this.noise(t, 3, { type: 'highpass', f0: 4000, vol: 0.28, verb: 1 });
    for (const n of CHORDS[0]) this.tone(t, 2.6, { f0: midi(n + 12), type: 'sawtooth', vol: 0.03, verb: 0.8, dest: this.padFilter });
  }

  /** La carte tourbillonne. */
  cardSpin() {
    for (let i = 0; i < 3; i++) window.setTimeout(() => !this.closed && this.whoosh(0.28, 0.2 + i * 0.06), i * 190);
  }

  /** La carte se pose : impact, paillettes, pyrotechnie et feux d'artifice. */
  cardLand() {
    const t = this.now;
    this.kick(t, 1);
    this.tone(t, 1.4, { f0: 70, f1: 38, vol: 0.7 });
    this.noise(t, 2.2, { type: 'highpass', f0: 3000, vol: 0.22, verb: 1 });
    for (let i = 0; i < 14; i++) this.tone(t + 0.05 + i * 0.045, 0.5, { f0: 1800 + Math.random() * 2600, vol: 0.035, verb: 1.2, pan: Math.random() * 1.6 - 0.8 });
    // Jets de pyrotechnie.
    this.noise(t + 0.05, 1.6, { type: 'highpass', f0: 2500, vol: 0.2, attack: 0.05, pan: -0.5 });
    this.noise(t + 0.05, 1.6, { type: 'highpass', f0: 2700, vol: 0.2, attack: 0.05, pan: 0.5 });
    this.noise(t + 0.05, 1.2, { buf: this.brown, type: 'lowpass', f0: 200, vol: 0.4, attack: 0.03 });
    this.fireworks(t + 0.5);
  }

  /** Bouquet de feux d'artifice : détonations puis crépitements. */
  fireworks(t0: number) {
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * 0.55 + Math.random() * 0.2;
      const pan = Math.random() * 1.4 - 0.7;
      this.tone(t, 0.5, { f0: 90, f1: 40, vol: 0.4, pan, verb: 0.8 });
      this.noise(t, 0.25, { type: 'lowpass', f0: 2400, f1: 300, vol: 0.35, pan, verb: 0.9 });
      for (let k = 0; k < 18; k++) this.noise(t + 0.25 + Math.random() * 1.1, 0.012, { type: 'highpass', f0: 4000 + Math.random() * 4000, vol: 0.06 + Math.random() * 0.06, pan: pan + (Math.random() - 0.5) * 0.4, verb: 0.5 });
    }
  }

  /* ------------------------------------------------------------------ musique */

  /** Beat d'hymne à 100 BPM : grosse caisse, basse, nappe La mineur – Fa – Do – Sol. */
  startMusic() {
    if (this.musicStart >= 0) return;
    this.musicStart = this.now + 0.05;
    this.nextBeat = this.musicStart;
    this.beat = 0;
    this.padFilter.frequency.setValueAtTime(600, this.now);
    this.padFilter.frequency.exponentialRampToValueAtTime(2600, this.now + 9);
    const tick = () => {
      if (this.closed) return;
      while (this.nextBeat < this.now + 0.15) {
        this.scheduleBeat(this.beat, this.nextBeat);
        this.beat++;
        this.nextBeat += 60 / this.bpm;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 40);
  }

  /** La musique s'efface en douceur. */
  fadeMusic(after = 8) {
    const t = this.now + after;
    this.musicGain.gain.setTargetAtTime(0.0001, t, 1.2);
    this.musicStopAt = t + 5;
  }

  private scheduleBeat(b: number, t: number) {
    if (t > this.musicStopAt) {
      window.clearInterval(this.timer);
      return;
    }
    const beatLen = 60 / this.bpm;
    const bar = Math.floor(b / 4);
    const inBar = b % 4;
    const chord = bar % 4;
    const m = this.musicGain;
    this.kick(t, 0.75, m);
    // Basse en croches.
    for (const off of [0, beatLen / 2]) this.tone(t + off, beatLen * 0.45, { f0: midi(ROOTS[chord]), type: 'triangle', vol: 0.32, dest: m });
    // Charleston sur les contretemps, frappe sur 2 et 4 à partir de la 2e mesure.
    this.noise(t + beatLen / 2, 0.05, { type: 'highpass', f0: 7500, vol: 0.06 });
    if (bar >= 1 && (inBar === 1 || inBar === 3)) this.noise(t, 0.22, { type: 'bandpass', f0: 1600, q: 0.8, vol: 0.2, verb: 0.5 });
    if (inBar === 0) for (const n of CHORDS[chord]) for (const d of [-7, 7]) this.tone(t, beatLen * 4.1, { f0: midi(n) * Math.pow(2, d / 1200), type: 'sawtooth', vol: 0.028, attack: 0.25, dest: this.padFilter });
  }

  dispose() {
    this.closed = true;
    window.clearInterval(this.timer);
    this.out.gain.setTargetAtTime(0, this.now, 0.08);
    window.setTimeout(() => void this.ctx.close().catch(() => undefined), 600);
  }
}
