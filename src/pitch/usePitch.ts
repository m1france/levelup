import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildTimeline, evaluate, type Timeline } from './anim';
import type { ExerciseData } from '../lib/types';

/** Taille CSS d'un conteneur, mise à jour au redimensionnement. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 0.5 && Math.abs(s.height - height) < 0.5 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Prépare un canvas net sur écrans haute densité. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  return dpr;
}

export interface Playback {
  timeline: Timeline;
  time: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setLoop: (l: boolean) => void;
  stepTo: (k: number) => void;
  /** Joue uniquement la transition vers l'étape suivante (pas à pas). */
  next: () => void;
  prev: () => void;
  frameIndex: number;
}

export function usePlayback(ex: ExerciseData, opts: { autoplay?: boolean; loop?: boolean } = {}): Playback {
  const [timeline, setTimeline] = useState(() => buildTimeline(ex));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(!!opts.autoplay);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(opts.loop ?? true);
  const stopAt = useRef<number | null>(null);
  const timeRef = useRef(0);
  timeRef.current = time;

  useEffect(() => {
    setTimeline(buildTimeline(ex));
  }, [ex]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      let t = timeRef.current + dt;
      if (stopAt.current !== null && t >= stopAt.current) {
        t = stopAt.current;
        stopAt.current = null;
        setTime(t);
        setPlaying(false);
        return;
      }
      if (t >= timeline.total) {
        if (loop && timeline.total > 0) {
          // petite pause en fin de boucle pour que les enfants voient la position finale
          t = t >= timeline.total + 900 ? 0 : t;
        } else {
          setTime(timeline.total);
          setPlaying(false);
          return;
        }
      }
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, loop, timeline]);

  const frameIndex = evaluate(ex, timeline, Math.min(time, timeline.total)).k;
  const atFrame = (k: number) => timeline.at[Math.max(0, Math.min(k, timeline.at.length - 1))];
  const currentStep = () => {
    let k = 0;
    for (let i = 0; i < timeline.at.length; i++) if (timeRef.current >= timeline.at[i] - 1) k = i;
    return k;
  };

  return {
    timeline,
    time,
    playing,
    speed,
    loop,
    frameIndex,
    play: () => {
      stopAt.current = null;
      if (timeRef.current >= timeline.total) setTime(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing) setPlaying(false);
      else {
        stopAt.current = null;
        if (timeRef.current >= timeline.total) setTime(0);
        setPlaying(true);
      }
    },
    seek: (t) => {
      stopAt.current = null;
      setTime(Math.max(0, Math.min(t, timeline.total)));
    },
    setSpeed,
    setLoop,
    stepTo: (k) => {
      setPlaying(false);
      setTime(atFrame(k));
    },
    next: () => {
      const k = currentStep();
      if (k >= timeline.at.length - 1) return;
      setTime(atFrame(k));
      stopAt.current = atFrame(k + 1);
      setPlaying(true);
    },
    prev: () => {
      const k = currentStep();
      setPlaying(false);
      setTime(atFrame(Math.max(0, timeRef.current > atFrame(k) + 50 ? k : k - 1)));
    },
  };
}
