/**
 * Son de la conférence de presse : ambiance de salle, déclencheurs d'appareils photo, chute et impact de l'éclair,
 * et la voix des présentateurs (fichiers MP3 générés par Fish Audio sur le serveur).
 * Les bruitages sont synthétisés avec Web Audio : aucun fichier à télécharger.
 */

export class PressAudio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private sfx: GainNode;
  private amb: GainNode;
  private voiceBus: GainNode;
  private analyser: AnalyserNode;
  private buf = new Uint8Array(1024);
  private noise: AudioBuffer;
  private ambNodes: AudioScheduledSourceNode[] = [];
  private chatter = 0;
  private clipPlaying = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  muted = false;

  /** À créer pendant un geste de l'utilisateur (sinon le navigateur bloque le son). */
  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    void this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(this.master);
    this.sfx = this.gain(0.8, comp);
    this.amb = this.gain(0, comp);
    this.voiceBus = this.gain(1, comp);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.voiceBus.connect(this.analyser);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private gain(v: number, to: AudioNode) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  }

  private noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /* ---------------------------------------------------------------- ambiance */

  /** Brouhaha de salle : bruit filtré qui ondule, et des bribes de voix lointaines. */
  ambience(level = 0.22) {
    if (this.ambNodes.length) return this.duck(level);
    const t = this.ctx.currentTime;
    const src = this.noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.6;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.23;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(this.amb);
    src.start(t);
    lfo.start(t);
    this.ambNodes.push(src, lfo);
    this.amb.gain.setTargetAtTime(level, t, 0.8);
    const talk = () => {
      if (!this.ambNodes.length) return;
      const n = this.noiseSrc();
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700 + Math.random() * 900;
      f.Q.value = 4;
      const g = this.ctx.createGain();
      const s = this.ctx.currentTime;
      const dur = 0.25 + Math.random() * 0.6;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.18, s + 0.05);
      for (let k = 1; k < 5; k++) g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.15, s + (dur * k) / 5);
      g.gain.linearRampToValueAtTime(0, s + dur);
      n.connect(f).connect(g).connect(this.amb);
      n.start(s);
      n.stop(s + dur + 0.05);
      this.chatter = window.setTimeout(talk, 120 + Math.random() * 420);
    };
    talk();
  }

  /** Baisse l'ambiance pendant que le présentateur parle. */
  duck(level: number) {
    this.amb.gain.setTargetAtTime(level, this.ctx.currentTime, 0.35);
  }

  stopAmbience() {
    clearTimeout(this.chatter);
    const t = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(0, t, 0.3);
    const nodes = this.ambNodes;
    this.ambNodes = [];
    setTimeout(() => nodes.forEach((n) => n.stop()), 1500);
  }

  /* ---------------------------------------------------------------- effets */

  /** Déclencheur d'appareil photo : deux clics secs et le sifflement du flash. */
  shutter(vol = 0.5) {
    const t = this.ctx.currentTime;
    for (const [dt, v] of [[0, 1], [0.045 + Math.random() * 0.02, 0.7]] as [number, number][]) {
      const n = this.noiseSrc();
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2400;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol * v, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.03);
      n.connect(hp).connect(g).connect(this.sfx);
      n.start(t + dt);
      n.stop(t + dt + 0.05);
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(3800, t);
    o.frequency.linearRampToValueAtTime(5200, t + 0.12);
    g.gain.setValueAtTime(0.012 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Souffle montant (avant l'éclair). */
  riser(dur = 1.3) {
    const t = this.ctx.currentTime;
    const n = this.noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + dur + 0.1);
  }

  /** Impact de l'éclair, façon dessin animé : « boum » rond, « pop » et petit carillon qui monte. */
  thunder() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    og.gain.setValueAtTime(0.85, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
    const p = this.ctx.createOscillator();
    const pg = this.ctx.createGain();
    p.type = 'triangle';
    p.frequency.setValueAtTime(520, t);
    p.frequency.exponentialRampToValueAtTime(1300, t + 0.07);
    pg.gain.setValueAtTime(0.35, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    p.connect(pg).connect(this.sfx);
    p.start(t);
    p.stop(t + 0.14);
    [1318.5, 1568, 2093].forEach((f, i) => {
      const s = t + 0.06 + i * 0.07;
      for (const [mul, v] of [[1, 0.13], [2.01, 0.035]] as [number, number][]) {
        const c = this.ctx.createOscillator();
        const cg = this.ctx.createGain();
        c.type = 'sine';
        c.frequency.value = f * mul;
        cg.gain.setValueAtTime(0.0001, s);
        cg.gain.linearRampToValueAtTime(v, s + 0.008);
        cg.gain.exponentialRampToValueAtTime(0.001, s + 0.5);
        c.connect(cg).connect(this.sfx);
        c.start(s);
        c.stop(s + 0.55);
      }
    });
  }

  /** Sifflement de chute de l'éclair (≈ dur secondes) : note qui descend et souffle. */
  crackle(dur = 0.35) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(380, t + dur);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.1, t + 0.04);
    og.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
    const n = this.noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.9);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  /** Impact à l'apparition d'un joueur : grosse caisse, accord brillant, étincelle. */
  stinger(step = 0) {
    const t = this.ctx.currentTime;
    const k = this.ctx.createOscillator();
    const kg = this.ctx.createGain();
    k.frequency.setValueAtTime(160, t);
    k.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    kg.gain.setValueAtTime(0.9, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    k.connect(kg).connect(this.sfx);
    k.start(t);
    k.stop(t + 0.5);
    // Accord majeur qui monte d'un demi-ton tous les deux joueurs (tension).
    const root = 220 * Math.pow(2, (step % 6) / 12);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 1.2);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.linearRampToValueAtTime(0.16, t + 0.02);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    lp.connect(cg).connect(this.sfx);
    for (const r of [1, 1.26, 1.5, 2]) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = root * r;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + 1.5);
      }
    }
    this.shutter(0.35);
  }

  /** Accord final. */
  fanfare() {
    const t = this.ctx.currentTime;
    const notes = [261.6, 329.6, 392, 523.3];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.14, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, s + 1.8);
      o.connect(g).connect(this.sfx);
      o.start(s);
      o.stop(s + 1.9);
    });
  }

  /* ---------------------------------------------------------------- voix */

  private load(url: string) {
    if (!this.cache.has(url))
      this.cache.set(
        url,
        fetch(url, { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then((b) => this.ctx.decodeAudioData(b))
          .catch(() => null),
      );
    return this.cache.get(url)!;
  }

  /** Précharge les voix pendant l'affiche ; `onReady` à chaque fichier prêt (réussi ou non). */
  preload(urls: (string | null | undefined)[], onReady?: (ok: boolean) => void) {
    return Promise.all(urls.filter((u): u is string => !!u).map((u) => this.load(u).then((b) => (onReady?.(!!b), !!b))));
  }

  /** Durée d'une voix déjà chargée (s), ou null. */
  async duration(url: string) {
    return (await this.load(url))?.duration ?? null;
  }

  /** Joue une voix ; résout à la fin (false si elle n'a pas pu être chargée). */
  async clip(url: string): Promise<boolean> {
    const buf = await this.load(url);
    if (!buf) return false;
    return new Promise((resolve) => {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.connect(this.voiceBus);
      this.clipPlaying++;
      this.sources.add(s);
      s.onended = () => {
        this.clipPlaying--;
        this.sources.delete(s);
        resolve(true);
      };
      s.start();
    });
  }

  /** Niveau de la voix (0 à 1), mesuré sur le signal : il anime la bouche du présentateur. */
  level() {
    if (this.clipPlaying <= 0) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 5.5);
  }

  stopVoice() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* déjà arrêté */
      }
    }
  }

  close() {
    this.stopVoice();
    this.stopAmbience();
    setTimeout(() => void this.ctx.close(), 600);
  }
}
