let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** À appeler lors d'un geste utilisateur pour débloquer le son sur iOS. */
export function unlockAudio() {
  try {
    audio();
  } catch {
    /* pas de son */
  }
}

/** Coup de sifflet synthétisé (pas de fichier à charger, fonctionne hors-ligne). */
export function whistle(times = 1, long = false) {
  try {
    const a = audio();
    for (let i = 0; i < times; i++) {
      const t0 = a.currentTime + i * 0.38;
      const dur = long ? 0.9 : 0.26;
      const osc = a.createOscillator();
      const trill = a.createOscillator();
      const trillGain = a.createGain();
      const gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = 2900;
      trill.frequency.value = 38;
      trillGain.gain.value = 120;
      trill.connect(trillGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.32, t0 + 0.02);
      gain.gain.setValueAtTime(0.32, t0 + dur - 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t0);
      trill.start(t0);
      osc.stop(t0 + dur);
      trill.stop(t0 + dur);
    }
  } catch {
    /* pas de son */
  }
  if ('vibrate' in navigator) navigator.vibrate?.(long ? 600 : [200, 120, 200].slice(0, times * 2 - 1));
}

export function beep() {
  try {
    const a = audio();
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.18);
    osc.connect(gain).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + 0.2);
  } catch {
    /* pas de son */
  }
}

/* ------------------------------------------------------------------ ouverture du paquet de convocation */

/** Bruit blanc filtré : souffle, déchirure, foule. */
function noise(a: AudioContext, t0: number, dur: number, { from = 800, to = 800, q = 1, vol = 0.3, type = 'bandpass' as BiquadFilterType } = {}) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.05, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

function tone(a: AudioContext, t0: number, freq: number, dur: number, { vol = 0.2, type = 'sine' as OscillatorType, to = freq } = {}) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

const play = (fn: (a: AudioContext, t: number) => void) => {
  try {
    const a = audio();
    fn(a, a.currentTime);
  } catch {
    /* pas de son */
  }
};

/** Tape sur le paquet : un choc de plus en plus aigu à chaque coup (`level` de 1 à 3). */
export const packTap = (level: number) => {
  play((a, t) => {
    tone(a, t, 90 + level * 40, 0.25, { vol: 0.45, to: 50 });
    noise(a, t, 0.12, { from: 1800 + level * 900, to: 900, vol: 0.18 });
  });
  navigator.vibrate?.(30 + level * 25);
};

/** Le paquet se déchire et la lumière jaillit. */
export const packBurst = () => {
  play((a, t) => {
    noise(a, t, 0.35, { from: 3000, to: 500, q: 0.7, vol: 0.35 });
    tone(a, t, 70, 0.9, { vol: 0.55, to: 38 });
    tone(a, t + 0.05, 440, 1.2, { vol: 0.06, type: 'triangle', to: 1760 });
  });
  navigator.vibrate?.([60, 40, 120]);
};

/** Un indice passe à l'écran (poste, club, numéro). */
export const whoosh = () => play((a, t) => noise(a, t, 0.45, { from: 400, to: 3200, q: 2, vol: 0.22 }));

/** La carte se retourne : impact grave, accord qui monte et clameur de la foule. */
export const cardReveal = () => {
  play((a, t) => {
    tone(a, t, 110, 0.7, { vol: 0.5, to: 45 });
    noise(a, t, 0.25, { from: 5000, to: 1200, vol: 0.2, type: 'highpass' });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, t + 0.12 + i * 0.09, f, 0.9, { vol: 0.09, type: 'triangle' }));
    noise(a, t + 0.15, 2.6, { from: 900, to: 700, q: 0.4, vol: 0.12 });
  });
  navigator.vibrate?.([80, 60, 160]);
};
