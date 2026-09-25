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
