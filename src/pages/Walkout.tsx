import { ChevronRight, FastForward, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
 * Entrée sur le terrain (paquet de convocation) : l'enfant convoqué traverse le tunnel où les lettres de son prénom
 * surgissent une à une, les portes s'ouvrent, puis il apparaît sur l'estrade à côté de sa carte ;
 * le tableau des convoqués s'allume en bas à droite. Tout est aux couleurs du club : le rouge du logo.
 */

/** Rouge du logo du club : couleur dominante de l'entrée. */
const CLUB_RED = '#d7141e';

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
    <div className="fw fw-loading">
      <div className="fw-loader">
        {error ? (
          <>
            <h2>Paquet indisponible</h2>
            <p>{error}</p>
            <button className="fw-btn" onClick={onClose}>
              Retour
            </button>
          </>
        ) : (
          <span className="fw-pulse" />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ utilitaires */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Les lettres du prénom (accents conservés). */
export function nameLetters(name: string) {
  return [...name.normalize('NFC')].filter((c) => /\p{L}/u.test(c)).map((c) => c.toLocaleUpperCase('fr-FR'));
}

/** La photo a-t-elle un fond transparent ? (on regarde les bords d'une image réduite) */
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

type Phase = 'intro' | 'run' | 'final';

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

  // Paquet suivant : la scène est reconstruite et démarre seule.
  const begin = (nextK: number) => {
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
    <div className={`fw phase-${phase}`} style={{ ['--team' as string]: CLUB_RED } as CSSProperties}>
      <WalkoutStage
        key={`${k}:${run}`}
        data={data}
        card={card}
        hero={hero}
        autoStart={run > 0}
        audio={audio}
        phase={phase}
        onStart={firstStart}
        onPhase={setPhase}
        onClose={onClose}
        closeLabel={closeLabel}
        nextName={next?.firstName ?? null}
        onNext={() => begin(k + 1)}
      />
      <div className="fw-top">
        <button className="fw-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <span className="grow" />
        {data.preview && <span className="fw-tag">Aperçu</span>}
        <button className="fw-icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ scène */

interface StageProps {
  data: Pack;
  card: PlayerCard;
  hero: WalkoutHero | null;
  autoStart: boolean;
  audio: React.RefObject<WalkoutAudio | null>;
  phase: Phase;
  onStart: () => WalkoutAudio | null;
  onPhase: (p: Phase) => void;
  onClose: () => void;
  closeLabel: string;
  nextName: string | null;
  onNext: () => void;
}

function WalkoutStage({ data, card, hero, autoStart, audio, phase, onStart, onPhase, onClose, closeLabel, nextName, onNext }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heroEl = useRef<HTMLDivElement>(null);
  const walkout = useRef<Walkout | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stage, setStage] = useState<'none' | 'stage' | 'card' | 'done'>('none');
  const [photo, setPhoto] = useState<string | null>(hero?.photo ?? null);
  const [framed, setFramed] = useState(false);
  const letters = useMemo(() => nameLetters(card.firstName), [card.firstName]);
  const when = cap(longDate(data.date));
  const startedRef = useRef(false);

  const onEvent = useCallback(
    (e: WalkoutEvent) => {
      if (e.type === 'stage') setStage('stage');
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
            team: { color: CLUB_RED, category: data.team.category },
            club: data.club,
            logo,
            letters,
            name: card.firstName,
            cardFront: drawCardFront(card, data.team, photo, logo),
            cardBack: drawCardBack({ ...data.team, color: CLUB_RED }, logo),
            hero: !!photo,
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
    startedRef.current = true;
    walkout.current?.start(onStart());
  };

  const running = phase === 'run';

  return (
    <>
      <canvas ref={canvas} className={`fw-canvas${ready ? ' ready' : ''}`} />
      {photo && (
        <div ref={heroEl} className={`fw-hero${framed ? ' framed' : ''}`} aria-hidden>
          <img
            src={photo}
            alt=""
            onError={() => setPhoto(null)}
            onLoad={(e) => setFramed(!(hero?.alpha || hasAlpha(e.currentTarget, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)))}
          />
        </div>
      )}

      {phase === 'intro' && (
        <div className="fw-intro">
          <div className="fw-intro-card">
            {data.team.logo && <img className="fw-intro-logo" src={data.team.logo} alt="" />}
            <p className="fw-kicker">{data.club || 'Convocation'}</p>
            <h1 className="fw-intro-title">
              Convocation <em>{data.team.category}</em>
            </h1>
            <p className="fw-intro-sub">{data.eventId ? `${when} · ${data.title}` : 'Aperçu de l’entrée sur le terrain'}</p>
            <button className="fw-go" onClick={start} disabled={!ready && !failed}>
              <span>{ready || failed ? 'Entrer sur le terrain' : 'Préparation…'}</span>
            </button>
            <p className="fw-intro-hint">Monte le son 🔊</p>
          </div>
        </div>
      )}

      {running && stage === 'none' && (
        <div className="fw-run-foot">
          <button className="fw-skip" onClick={() => walkout.current?.skip()}>
            Passer <FastForward size={16} />
          </button>
        </div>
      )}

      {phase === 'final' && (
        <div className="fw-final">
          <Roster data={data} current={card.id} />
          {failed && (
            <div className="fw-fallback-card">
              <FutCard card={card} team={data.team} size={180} />
              {photo && <img src={photo} alt="" onError={() => setPhoto(null)} />}
            </div>
          )}
          {data.eventId ? (
            <div className="fw-info">
              <b>
                {when}
                {data.time ? ` · ${formatTime(data.time)}` : ''}
              </b>
              {data.location && <small>{data.location}</small>}
            </div>
          ) : (
            <div className="fw-info">
              <b>Aperçu de l’entrée</b>
              <span>C’est ce que verra la famille à chaque convocation.</span>
            </div>
          )}
          <div className="fw-actions">
            {nextName && (
              <button className="fw-btn primary" onClick={onNext}>
                Paquet de {nextName} <ChevronRight size={18} />
              </button>
            )}
            <button className="fw-btn" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ tableau des convoqués */

/** Écran LED en bas à droite : un convoqué par ligne, celui dont c'est l'entrée surligné en rouge. */
function Roster({ data, current }: { data: Pack; current: string }) {
  const list = useRef<HTMLOListElement>(null);
  // Liste longue : la ligne du joueur reste visible.
  useLayoutEffect(() => {
    const ol = list.current;
    const row = ol?.querySelector<HTMLElement>('.on');
    if (ol && row) ol.scrollTop = row.offsetTop - (ol.clientHeight - row.offsetHeight) / 2;
  }, [current]);
  return (
    <aside className="fw-roster" aria-label="Joueurs convoqués">
      <header>
        <b>Convoqués{data.team.category ? ` · ${data.team.category}` : ''}</b>
        <span>{data.cards.length}</span>
      </header>
      <ol ref={list}>
        {data.cards.map((c, i) => (
          <li key={c.id} className={c.id === current ? 'on' : undefined} style={{ ['--i' as string]: i } as CSSProperties}>
            <span>{c.firstName}</span>
            {c.number != null && <em>{c.number}</em>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
