import { ChevronRight, FastForward, RotateCcw, Users, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FutCard } from '../components/FutCard';
import { useAsync } from '../components/ui';
import { api } from '../lib/api';
import { formatTime } from '../lib/events';
import type { Pack, PlayerCard, WalkoutHero } from '../lib/types';
import { WalkoutAudio } from '../walkout/audio';
import { drawCardBack, drawCardFront, loadImage } from '../walkout/card';
import { loadWalkoutFonts } from '../walkout/fonts';
import { createWalkout, type Walkout, type WalkoutEvent } from '../walkout/scene';
import { longDate } from './Convocation';

/**
 * Entrée sur le terrain (paquet de convocation) : l'enfant convoqué traverse le tunnel, les portes s'ouvrent,
 * les trois premières lettres de son prénom surgissent, puis il apparaît sur l'estrade à côté de sa carte.
 */

/** Depuis la notification ou le billet du match. */
export function PackPage() {
  const { eventId, date } = useParams();
  const [params] = useSearchParams();
  const player = params.get('joueur');
  const q = useAsync(() => api.get<Pack>(`/convocations/${eventId}/${date}/pack${player ? `?player=${encodeURIComponent(player)}` : ''}`), [eventId, date, player]);
  const nav = useNavigate();
  // « billet » : la page du match s'affiche sans renvoyer vers le paquet.
  const close = useCallback(() => nav(`/matchs/${eventId}/${date}?billet`, { replace: true }), [nav, eventId, date]);
  const data = q.data;
  useEffect(() => {
    if (data && !data.preview) void api.post(`/convocations/${data.eventId}/${data.date}/read`).catch(() => undefined);
  }, [data]);
  if (!data) return <WalkoutLoading error={q.loading ? null : q.error} onClose={close} />;
  return <WalkoutExperience data={data} onClose={close} closeLabel="Voir la convocation" />;
}

/** Aperçu depuis la fiche du joueur. */
export function PlayerWalkoutPage() {
  const { id } = useParams();
  const q = useAsync(() => api.get<Pack>(`/players/${id}/walkout`), [id]);
  const nav = useNavigate();
  const close = useCallback(() => nav(`/joueurs/${id}`, { replace: true }), [nav, id]);
  if (!q.data) return <WalkoutLoading error={q.loading ? null : q.error} onClose={close} />;
  return <WalkoutExperience data={q.data} onClose={close} closeLabel="Retour à la fiche" />;
}

function WalkoutLoading({ error, onClose }: { error: string | null; onClose: () => void }) {
  return (
    <div className="wk wk-loading">
      <div className="wk-loader">
        {error ? (
          <>
            <h2>Paquet indisponible</h2>
            <p>{error}</p>
            <button className="wk-btn" onClick={onClose}>
              Retour
            </button>
          </>
        ) : (
          <span className="wk-pulse" />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ utilitaires */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Les trois premières lettres du prénom (accents conservés). */
export function firstLetters(name: string, n = 3) {
  return [...name.normalize('NFC')].filter((c) => /\p{L}/u.test(c)).slice(0, n).map((c) => c.toLocaleUpperCase('fr-FR'));
}

const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

/** Vidéo à essayer d'abord : MOV (HEVC transparent) sur Safari, WebM (VP9 transparent) ailleurs. */
function videoOrder(v: WalkoutHero['video']) {
  const list = isSafari() ? [v.mov, v.webm] : [v.webm, v.mov];
  return list.filter((x): x is string => !!x);
}

/** Le média a-t-il un fond transparent ? (on regarde les bords d'une image réduite) */
function hasAlpha(src: CanvasImageSource, w: number, h: number) {
  try {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let clear = 0;
    for (let i = 0; i < 24; i++)
      for (const [x, y] of [[i, 0], [0, i], [23, i], [i, 23]]) if (d[(y * 24 + x) * 4 + 3] < 200) clear++;
    return clear > 24;
  } catch {
    return true;
  }
}

const readMuted = () => {
  try {
    return localStorage.getItem('walkout.muted') === '1';
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ expérience */

type Phase = 'intro' | 'run' | 'final' | 'squad';

function WalkoutExperience({ data, onClose, closeLabel }: { data: Pack; onClose: () => void; closeLabel: string }) {
  const [k, setK] = useState(0);
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [muted, setMuted] = useState(readMuted);
  const audio = useRef<WalkoutAudio | null>(null);
  const card = data.cards.find((c) => c.id === data.opened[k]) ?? data.cards[0];
  const hero = data.heroes?.[card.id] ?? null;
  const next = k + 1 < data.opened.length ? data.cards.find((c) => c.id === data.opened[k + 1]) : null;

  useEffect(() => () => audio.current?.dispose(), []);
  useEffect(() => {
    audio.current?.setMuted(muted);
    try {
      localStorage.setItem('walkout.muted', muted ? '1' : '0');
    } catch {
      /* préférence non enregistrée */
    }
  }, [muted]);

  // Le son doit naître d'un geste (iOS) : on crée la bande-son dans le gestionnaire du clic.
  const freshAudio = () => {
    audio.current?.dispose();
    try {
      audio.current = new WalkoutAudio();
      audio.current.setMuted(muted);
    } catch {
      audio.current = null;
    }
    return audio.current;
  };

  // Revoir / paquet suivant : la scène est reconstruite et démarre seule.
  const begin = (nextK = k) => {
    freshAudio();
    setK(nextK);
    setRun((r) => r + 1);
    setPhase('run');
  };
  // Premier départ : la scène déjà affichée démarre avec la bande-son créée pendant le clic.
  const firstStart = () => {
    const a = freshAudio();
    setPhase('run');
    return a;
  };

  return (
    <div className={`wk phase-${phase}`} style={{ ['--team' as string]: data.team.color } as CSSProperties}>
      <WalkoutStage
        key={`${k}:${run}`}
        data={data}
        card={card}
        hero={hero}
        muted={muted}
        autoStart={run > 0}
        audio={audio}
        phase={phase}
        onStart={firstStart}
        onPhase={setPhase}
        onClose={onClose}
        closeLabel={closeLabel}
        nextName={next?.firstName ?? null}
        onNext={() => begin(k + 1)}
        onReplay={() => begin()}
      />
      <div className="wk-top">
        <button className="wk-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <span className="grow" />
        {data.preview && <span className="wk-tag">Aperçu</span>}
        <button className="wk-icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
      </div>
      {phase === 'squad' && <Squad data={data} onBack={() => setPhase('final')} onClose={onClose} closeLabel={closeLabel} />}
    </div>
  );
}

/* ------------------------------------------------------------------ scène */

interface StageProps {
  data: Pack;
  card: PlayerCard;
  hero: WalkoutHero | null;
  muted: boolean;
  autoStart: boolean;
  audio: React.RefObject<WalkoutAudio | null>;
  phase: Phase;
  onStart: () => WalkoutAudio | null;
  onPhase: (p: Phase) => void;
  onClose: () => void;
  closeLabel: string;
  nextName: string | null;
  onNext: () => void;
  onReplay: () => void;
}

function WalkoutStage({ data, card, hero, muted, autoStart, audio, phase, onStart, onPhase, onClose, closeLabel, nextName, onNext, onReplay }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heroEl = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const walkout = useRef<Walkout | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(0);
  const [stage, setStage] = useState<'none' | 'stage' | 'card' | 'done'>('none');
  const [media, setMedia] = useState<{ kind: 'video' | 'img'; src: string } | null>(null);
  const [framed, setFramed] = useState(false);
  const letters = useMemo(() => firstLetters(card.firstName), [card.firstName]);
  const more = firstLetters(card.firstName, 99).length > letters.length;
  const when = cap(longDate(data.date));
  const startedRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    const v = video.current;
    if (v && !v.paused) v.muted = muted;
  }, [muted]);

  // Média de l'enfant : vidéo (dans l'ordre préféré du navigateur), sinon photo en pied.
  const sources = useMemo(() => {
    const list: { kind: 'video' | 'img'; src: string }[] = [];
    if (hero) {
      for (const v of videoOrder(hero.video)) list.push({ kind: 'video', src: v });
      if (hero.photo) list.push({ kind: 'img', src: hero.photo });
    }
    return list;
  }, [hero]);
  useEffect(() => setMedia(sources[0] ?? null), [sources]);
  const fallback = () => setMedia((m) => sources[sources.findIndex((s) => s.src === m?.src) + 1] ?? null);

  const onEvent = useCallback(
    (e: WalkoutEvent) => {
      if (e.type === 'letter') setShown(e.index + 1);
      if (e.type === 'stage') {
        setShown(99);
        setStage('stage');
      }
      if (e.type === 'hero' && video.current) {
        video.current.currentTime = 0;
        video.current.muted = mutedRef.current;
        void video.current.play().catch(() => {
          if (!video.current) return;
          video.current.muted = true;
          void video.current.play().catch(() => undefined);
        });
      }
      if (e.type === 'card') setStage('card');
      if (e.type === 'done') {
        setStage('done');
        onPhase('final');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let alive = true;
    let w: Walkout | null = null;
    (async () => {
      await loadWalkoutFonts();
      const [photo, logo] = await Promise.all([loadImage(card.photo), loadImage(data.team.logo)]);
      if (!alive || !canvas.current) return;
      try {
        w = createWalkout({
          canvas: canvas.current,
          heroEl: heroEl.current,
          onEvent,
          input: {
            team: { color: data.team.color, category: data.team.category },
            club: data.club,
            logo,
            letters,
            cardFront: drawCardFront(card, data.team, photo, logo),
            cardBack: drawCardBack(data.team, logo),
            hero: sources.length > 0,
            screenLine: data.eventId ? `${when} · ${data.title}` : data.club,
          },
        });
        walkout.current = w;
        setReady(true);
        if (autoStart) {
          startedRef.current = true;
          w.start(audio.current);
        }
      } catch {
        setFailed(true);
        onPhase('final');
        setStage('done');
      }
    })();
    return () => {
      alive = false;
      w?.dispose();
      walkout.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (startedRef.current) return;
    // iOS : la vidéo doit être « débloquée » pendant le geste pour pouvoir jouer avec le son plus tard.
    const v = video.current;
    if (v) {
      v.muted = true;
      void v.play().then(() => v.pause()).catch(() => undefined);
    }
    startedRef.current = true;
    walkout.current?.start(onStart());
  };

  const running = phase === 'run';
  const hold = (on: boolean) => walkout.current?.fast(on);

  return (
    <>
      <canvas ref={canvas} className={`wk-canvas${ready ? ' ready' : ''}`} />
      {sources.length > 0 && (
        <div ref={heroEl} className={`wk-hero${framed ? ' framed' : ''}`} aria-hidden>
          {media?.kind === 'video' && (
            <video
              ref={video}
              key={media.src}
              src={media.src}
              playsInline
              loop
              muted
              preload="auto"
              onError={fallback}
              onLoadedData={(e) => setFramed(!hasAlpha(e.currentTarget, e.currentTarget.videoWidth, e.currentTarget.videoHeight))}
            />
          )}
          {media?.kind === 'img' && (
            <img
              key={media.src}
              src={media.src}
              alt=""
              onError={fallback}
              onLoad={(e) => setFramed(!(hero?.alpha || hasAlpha(e.currentTarget, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)))}
            />
          )}
        </div>
      )}

      {/* Maintenir appuyé pour accélérer. */}
      {running && (
        <div
          className="wk-hold"
          onPointerDown={() => hold(true)}
          onPointerUp={() => hold(false)}
          onPointerCancel={() => hold(false)}
          onPointerLeave={() => hold(false)}
        />
      )}

      {phase === 'intro' && (
        <div className="wk-intro">
          <div className="wk-intro-card">
            {data.team.logo && <img className="wk-intro-logo" src={data.team.logo} alt="" />}
            <p className="wk-kicker">{data.club || 'Convocation'}</p>
            <h1 className="wk-intro-title">
              Convocation <em>{data.team.category}</em>
            </h1>
            <p className="wk-intro-sub">{data.eventId ? `${when} · ${data.title}` : 'Aperçu de l’entrée sur le terrain'}</p>
            <button className="wk-go" onClick={start} disabled={!ready && !failed}>
              <span>{ready || failed ? 'Entrer sur le terrain' : 'Préparation…'}</span>
            </button>
            <p className="wk-intro-hint">Monte le son 🔊</p>
          </div>
        </div>
      )}

      {phase === 'run' && stage === 'none' && (
        <div className="wk-hud">
          <p className="wk-question">Qui est convoqué ?</p>
          <div className="wk-slots">
            {letters.map((l, i) => (
              <span key={i} className={`wk-slot${i < shown ? ' on' : ''}`}>
                <b>{i < shown ? l : ''}</b>
              </span>
            ))}
            {more && <span className="wk-more">…</span>}
          </div>
        </div>
      )}

      {(stage === 'card' || stage === 'done') && (
        <div className="wk-name">
          <h2 data-text={card.firstName}>{card.firstName}</h2>
          <span className="wk-pill">
            <i>✓</i> Convoqué{data.team.category ? ` · ${data.team.category}` : ''}
          </span>
        </div>
      )}

      {running && stage === 'none' && (
        <div className="wk-run-foot">
          <span className="wk-hint">Maintiens l’écran pour accélérer</span>
          <button className="wk-skip" onClick={() => walkout.current?.skip()}>
            Passer <FastForward size={16} />
          </button>
        </div>
      )}

      {(phase === 'final' || phase === 'squad') && (
        <div className="wk-final">
          {failed && (
            <div className="wk-fallback-card">
              <FutCard card={card} team={data.team} size={180} />
              {media?.kind === 'video' && <video src={media.src} autoPlay loop muted playsInline onError={fallback} />}
              {media?.kind === 'img' && <img src={media.src} alt="" onError={fallback} />}
            </div>
          )}
          {data.eventId ? (
            <div className="wk-info">
              <b>
                {when}
                {data.time ? ` · ${formatTime(data.time)}` : ''}
              </b>
              <span>
                {data.title}
                {data.meetTime ? ` · Rendez-vous ${formatTime(data.meetTime)}` : ''}
              </span>
              {data.location && <small>{data.location}</small>}
            </div>
          ) : (
            <div className="wk-info">
              <b>Aperçu de l’entrée</b>
              <span>C’est ce que verra la famille à chaque convocation.</span>
            </div>
          )}
          <div className="wk-actions">
            {nextName ? (
              <button className="wk-btn primary" onClick={onNext}>
                Paquet de {nextName} <ChevronRight size={18} />
              </button>
            ) : (
              data.cards.length > 1 && (
                <button className="wk-btn primary" onClick={() => onPhase('squad')}>
                  <Users size={18} /> Mes coéquipiers
                </button>
              )
            )}
            <button className="wk-btn" onClick={onClose}>
              {closeLabel}
            </button>
            <button className="wk-btn icon" onClick={onReplay} aria-label="Revoir l’entrée">
              <RotateCcw size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ coéquipiers */

function Squad({ data, onBack, onClose, closeLabel }: { data: Pack; onBack: () => void; onClose: () => void; closeLabel: string }) {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const r = () => setW(window.innerWidth);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  const cols = Math.min(data.cards.length, w < 520 ? 3 : w < 900 ? 4 : 6);
  const size = Math.round(Math.max(90, Math.min(160, (Math.min(w, 1040) - 32 - (cols - 1) * 12) / cols)));
  const ordered = [...data.cards.filter((c) => c.mine), ...data.cards.filter((c) => !c.mine)];
  return (
    <div className="wk-squad">
      <div className="wk-squad-inner">
        <p className="wk-kicker">{cap(longDate(data.date))}</p>
        <h2>Le groupe {data.team.category}</h2>
        <p className="wk-squad-sub">{data.cards.length} joueurs convoqués</p>
        <div className="wk-grid">
          {ordered.map((c, i) => (
            <div key={c.id} className={`wk-mini${c.mine ? ' mine' : ''}`} style={{ ['--i' as string]: i } as CSSProperties}>
              <FutCard card={c} team={data.team} size={size} foot={<span>{c.number != null ? `#${c.number}` : data.team.category}</span>} />
            </div>
          ))}
        </div>
        <div className="wk-actions">
          <button className="wk-btn" onClick={onBack}>
            Retour
          </button>
          <button className="wk-btn primary" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
