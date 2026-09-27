import { useEffect, useRef, useState } from 'react';

export interface ShowcaseSlide {
  key: string;
  node: React.ReactNode;
}

/**
 * Grande section en diapositives (accueil, matchs) : les diapositives défilent toutes les
 * `interval` ms, avec des bâtonnets en bas au centre qui se remplissent pendant l'attente.
 * Pause au survol, quand l'onglet est caché ; on change de diapositive d'un glissement au doigt.
 */
export function Showcase({ slides, interval = 5000, className = '' }: { slides: ShowcaseSlide[]; interval?: number; className?: string }) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const n = slides.length;
  const i = n ? Math.min(index, n - 1) : 0;
  const paused = hover || hidden || n < 2;

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Le temps déjà écoulé sur la diapositive est conservé pendant une pause.
  const elapsed = useRef(0);
  const startedAt = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [i]);
  useEffect(() => {
    if (paused) return;
    startedAt.current = performance.now();
    const t = window.setTimeout(() => setIndex((x) => (Math.min(x, n - 1) + 1) % n), Math.max(0, interval - elapsed.current));
    return () => {
      window.clearTimeout(t);
      elapsed.current += performance.now() - startedAt.current;
    };
  }, [paused, i, n, interval]);

  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const go = (to: number) => setIndex(((to % n) + n) % n);

  if (!n) return null;
  return (
    <section
      className={`hero2 showcase ${className}`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(i + (dx < 0 ? 1 : -1));
      }}
      aria-roledescription="carrousel"
    >
      <div className="sc-track">
        {slides.map((s, k) => (
          <div
            key={s.key}
            className={`sc-slide${k === i ? ' on' : ''}`}
            aria-hidden={k !== i}
            inert={k !== i}
            aria-roledescription="diapositive"
            aria-label={`${k + 1} sur ${n}`}
          >
            {s.node}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="sc-bars" role="tablist">
          {slides.map((s, k) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={k === i}
              aria-label={`Diapositive ${k + 1}`}
              className={k < i ? 'done' : k === i ? 'on' : ''}
              onClick={(e) => {
                e.stopPropagation();
                go(k);
              }}
            >
              <i key={k === i ? `on-${i}` : 'off'} style={k === i ? { animationDuration: `${interval}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Mise en page d'une diapositive : le texte à gauche, un visuel à droite. */
export function HeroSlide({
  eyebrow, warn, title, text, actions, visual, onOpen, className = '',
}: {
  eyebrow?: React.ReactNode;
  /** Pastille en orange : quelque chose attend une action. */
  warn?: boolean;
  title: React.ReactNode;
  text?: React.ReactNode;
  actions?: React.ReactNode;
  visual: React.ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <div className={`hs ${className}`}>
      <div className="hero2-text">
        {eyebrow && <div className={`hs-eyebrow${warn ? ' warn' : ''}`}>{eyebrow}</div>}
        <h1 onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : undefined }}>
          {title}
        </h1>
        {text && <div className="hs-text">{text}</div>}
        {actions && <div className="hs-actions">{actions}</div>}
      </div>
      <div className="hero2-visual" onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
        {visual}
      </div>
    </div>
  );
}

/** Visuel « carte en verre » inclinée, pour les diapositives d'information. */
export function GlassArt({ children, glow }: { children: React.ReactNode; glow?: string }) {
  return (
    <div className="glass-art" style={glow ? ({ '--glow': glow } as React.CSSProperties) : undefined}>
      <div className="glass-card">{children}</div>
    </div>
  );
}
