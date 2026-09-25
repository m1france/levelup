import { ChevronLeft, ChevronRight, Info, Maximize2, Pause, Play, Repeat, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildTimeline, evaluate } from '../pitch/anim';
import { computeView } from '../pitch/geometry';
import { drawScene, type PitchPalette } from '../pitch/render';
import { fitCanvas, usePlayback, useSize } from '../pitch/usePitch';
import type { Cover, ExerciseData } from '../lib/types';
import { useWakeLock } from '../lib/wakelock';

/** Vignette statique (position de départ + tracés). */
export function SceneThumb({ ex, frame = 0 }: { ex: ExerciseData; frame?: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const tl = useMemo(() => buildTimeline(ex), [ex]);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !size.width) return;
    const dpr = fitCanvas(c, size.width, size.height);
    const view = computeView(ex.field, size.width, size.height, false);
    drawScene(c.getContext('2d')!, ex, { view, dpr, pos: tl.rest[Math.min(frame, tl.rest.length - 1)] });
  }, [ex, tl, size, frame]);
  return (
    <div ref={ref} className="thumb-canvas">
      <canvas ref={canvas} />
    </div>
  );
}

/** Complète un exercice de couverture pour le moteur de rendu. */
export const coverToExercise = (c: Cover): ExerciseData => ({
  objective: '', instructions: '', easier: '', harder: '', themes: [], duration: 0, players: 0, ...c,
});

/** Terrain animé en boucle, sans commandes (une de l'accueil). */
export function LivePitch({ ex, palette }: { ex: ExerciseData; palette?: Partial<PitchPalette> }) {
  const pb = usePlayback(ex, { autoplay: ex.frames.length > 1, loop: true });
  return <StageCanvas ex={ex} time={pb.time} showPaths={!pb.playing} palette={palette} />;
}

function StageCanvas({
  ex, time, rotate, showPaths, palette,
}: { ex: ExerciseData; time: number; rotate?: boolean; showPaths?: boolean; palette?: Partial<PitchPalette> }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const tl = useMemo(() => buildTimeline(ex), [ex]);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !size.width) return;
    const dpr = fitCanvas(c, size.width, size.height);
    const view = computeView(ex.field, size.width, size.height, !!rotate);
    const { pos } = evaluate(ex, tl, Math.min(time, tl.total));
    drawScene(c.getContext('2d')!, ex, { view, dpr, pos, showPaths, palette });
  }, [ex, tl, size, time, rotate, showPaths, palette]);
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} />
    </div>
  );
}

/** Lecteur intégré : aperçu animé avec commandes compactes. */
export function ExercisePlayer({ ex, autoplay = false, aspect }: { ex: ExerciseData; autoplay?: boolean; aspect?: string }) {
  const pb = usePlayback(ex, { autoplay, loop: true });
  const [present, setPresent] = useState(false);
  const steps = ex.frames.length - 1;
  const [showPaths, setShowPaths] = useState(true);
  return (
    <div className="player-box card">
      <div className="canvas-wrap" style={{ aspectRatio: aspect ?? `${ex.field.w + 3} / ${ex.field.h + 3}`, maxHeight: '62vh' }}>
        <StageCanvas ex={ex} time={pb.time} showPaths={showPaths && !pb.playing} />
      </div>
      <div className="player-bar">
        {steps > 0 && (
          <>
            <button className="btn icon sm ghost" onClick={pb.prev} aria-label="Étape précédente">
              <ChevronLeft />
            </button>
            <button className="btn icon sm primary" onClick={pb.toggle} aria-label={pb.playing ? 'Pause' : 'Lecture'}>
              {pb.playing ? <Pause /> : <Play />}
            </button>
            <button className="btn icon sm ghost" onClick={pb.next} aria-label="Étape suivante">
              <ChevronRight />
            </button>
            <span className="small muted" style={{ marginLeft: 4 }}>
              {pb.frameIndex}/{steps}
            </span>
          </>
        )}
        {steps === 0 && <span className="small muted">Schéma sans animation</span>}
        <span className="grow" />
        <button className={`btn sm ghost`} onClick={() => setShowPaths((s) => !s)} title="Afficher les flèches">
          {showPaths ? 'Flèches' : 'Sans flèches'}
        </button>
        {steps > 0 && (
          <button className="btn sm ghost" onClick={() => pb.setSpeed(pb.speed === 1 ? 0.5 : 1)} title="Vitesse">
            ×{pb.speed === 1 ? '1' : '0,5'}
          </button>
        )}
        <button className="btn icon sm ghost" onClick={() => setPresent(true)} aria-label="Plein écran">
          <Maximize2 />
        </button>
      </div>
      {present && <Presenter ex={ex} onClose={() => setPresent(false)} />}
    </div>
  );
}

/** Mode tableau : plein écran, gros boutons, à montrer aux enfants. */
export function Presenter({ ex, onClose, subtitle }: { ex: ExerciseData; onClose: () => void; subtitle?: string }) {
  const pb = usePlayback(ex, { autoplay: ex.frames.length > 1, loop: true });
  const [info, setInfo] = useState(false);
  useWakeLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        pb.toggle();
      }
      if (e.key === 'ArrowRight') pb.next();
      if (e.key === 'ArrowLeft') pb.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pb]);
  const steps = ex.frames.length - 1;
  return createPortal(
    <div className="presenter">
      <div className="presenter-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{ex.title || 'Exercice'}</h2>
          {subtitle && <div style={{ opacity: 0.7, fontSize: 14 }}>{subtitle}</div>}
        </div>
        <button className="btn icon" onClick={() => setInfo((i) => !i)} aria-label="Consignes">
          <Info />
        </button>
        <button className="btn icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <div className="presenter-stage">
        <StageCanvas ex={ex} time={pb.time} rotate showPaths={!pb.playing} />
        {info && (
          <div
            style={{
              position: 'absolute', right: 16, top: 8, width: 'min(360px, calc(100% - 32px))', maxHeight: 'calc(100% - 16px)', overflow: 'auto',
              background: 'rgba(20,32,24,0.86)', backdropFilter: 'blur(8px)', borderRadius: 16, padding: 18, lineHeight: 1.55,
            }}
          >
            {ex.objective && (
              <p style={{ marginBottom: 10 }}>
                <b>Objectif · </b>
                {ex.objective}
              </p>
            )}
            <p style={{ whiteSpace: 'pre-wrap' }}>{ex.instructions || 'Pas de consignes.'}</p>
          </div>
        )}
      </div>
      <div className="presenter-controls">
        {steps > 0 ? (
          <>
            <button className="btn lg icon" onClick={pb.prev} aria-label="Étape précédente">
              <ChevronLeft />
            </button>
            <button className="btn lg primary" style={{ minWidth: 140 }} onClick={pb.toggle}>
              {pb.playing ? <Pause /> : <Play />}
              {pb.playing ? 'Pause' : 'Lecture'}
            </button>
            <button className="btn lg icon" onClick={pb.next} aria-label="Étape suivante">
              <ChevronRight />
            </button>
            <button className="btn lg" onClick={() => pb.setSpeed(pb.speed === 1 ? 0.5 : 1)}>
              ×{pb.speed === 1 ? '1' : '0,5'}
            </button>
            <button className="btn lg icon" onClick={() => pb.setLoop(!pb.loop)} style={{ opacity: pb.loop ? 1 : 0.5 }} aria-label="Boucle">
              <Repeat />
            </button>
          </>
        ) : (
          <span style={{ opacity: 0.7 }}>Schéma sans animation</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
