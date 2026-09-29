import { ArrowLeft, RotateCcw, Share2, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FutBack, FutCard, TIERS } from '../components/FutCard';
import { Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import type { GameResult, PlayerCard, Reveal } from '../lib/types';

/** Cartes du match, dans l'app (connecté). */
export function RevealPage() {
  const { eventId, date } = useParams();
  const q = useAsync(() => api.get<Reveal>(`/convocations/${eventId}/${date}/reveal`), [eventId, date]);
  const nav = useNavigate();
  if (q.loading && !q.data) return <Spinner fill />;
  if (!q.data) return <RevealError text={q.error} onBack={() => nav(-1)} />;
  return <RevealShow data={q.data} onBack={() => nav(`/matchs/${eventId}/${date}`)} />;
}

/** Cartes du match via le lien partagé par l'éducateur (sans compte). */
export function PublicReveal() {
  const { token } = useParams();
  const q = useAsync(() => api.get<Reveal>(`/public/reveal/${token}`), [token]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (!q.data) return <RevealError text={q.error} />;
  return <RevealShow data={q.data} />;
}

function RevealError({ text, onBack }: { text: string | null; onBack?: () => void }) {
  return (
    <div className="rv">
      <div className="rv-center">
        <h2 className="rv-title small">Cartes indisponibles</h2>
        <p style={{ opacity: 0.7 }}>{text}</p>
        {onBack && (
          <button className="duo-btn" onClick={onBack}>
            Retour
          </button>
        )}
      </div>
    </div>
  );
}

type Phase = 'intro' | 'flash' | 'score' | 'deal' | 'play';

/** Rangées de cartes sur le terrain (3 à 4 cartes par rangée). */
function layout(n: number) {
  const perRow = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : Math.ceil(n / 3);
  const rows: number[][] = [];
  for (let i = 0; i < n; i += perRow) rows.push(Array.from({ length: Math.min(perRow, n - i) }, (_, k) => i + k));
  return rows;
}

export function Confetti({ count = 60, colors }: { count?: number; colors: string[] }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.6 + Math.random() * 1.6,
        rot: Math.random() * 720 - 360,
        x: Math.random() * 160 - 80,
        color: colors[i % colors.length],
        w: 6 + Math.random() * 6,
      })),
    [count, colors],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i
          key={i}
          style={{ left: `${b.left}%`, background: b.color, width: b.w, height: b.w * 1.6, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, ['--rot' as string]: `${b.rot}deg`, ['--x' as string]: `${b.x}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function Bolt({ className }: { className?: string }) {
  return (
    <svg className={`bolt ${className ?? ''}`} viewBox="0 0 60 120" aria-hidden>
      <path d="M38 2 L8 66 L30 66 L18 118 L54 44 L32 44 L46 2 Z" />
    </svg>
  );
}

/** Plateau : le score de chaque match, en colonne à gauche du terrain. */
function GamesBoard({ games, team }: { games: GameResult[]; team: string }) {
  const played = games.filter((g) => g.us !== null);
  const w = played.filter((g) => g.us! > g.them!).length;
  const d = played.filter((g) => g.us === g.them).length;
  const l = played.length - w - d;
  return (
    <aside className="rv-games" aria-label="Scores du plateau">
      <div className="rv-games-head">
        <b>{team}</b>
        <span>
          <i className="w">{w}V</i>
          <i className="d">{d}N</i>
          <i className="l">{l}D</i>
        </span>
      </div>
      <ol>
        {games.map((g, i) => {
          const res = g.us === null ? 'todo' : g.us > g.them! ? 'win' : g.us === g.them ? 'draw' : 'loss';
          return (
            <li key={g.id} className={res} style={{ ['--i' as string]: i } as CSSProperties}>
              <span className="rv-g-opp">{g.opponent}</span>
              <b>{g.us === null ? '–' : `${g.us}–${g.them}`}</b>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

type Rect = { x: number; y: number; w: number; h: number };

export function RevealShow({ data, onBack }: { data: Reveal; onBack?: () => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('intro');
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<PlayerCard | null>(null);
  const [stage, setStage] = useState<'fly' | 'flip' | 'award'>('fly');
  /** Carte agrandie : position de départ (son emplacement sur le terrain) et carte déjà retournée ou non. */
  const origin = useRef<{ rect: Rect; open: boolean } | null>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [finale, setFinale] = useState(false);
  const [run, setRun] = useState(0);
  const rows = layout(data.cards.length);
  const win = data.score.us > data.score.them;
  const draw = data.score.us === data.score.them;

  // Séquence d'ouverture : éclair « Match terminé », score, puis distribution des cartes.
  // Plateau : le score de chaque match reste affiché un peu plus longtemps.
  const scoreMs = 1400 + (data.games?.length ?? 0) * 260;
  useEffect(() => {
    setPhase('intro');
    const t = [
      setTimeout(() => setPhase('flash'), 350),
      setTimeout(() => setPhase('score'), 1900),
      setTimeout(() => setPhase('deal'), 1900 + scoreMs),
      setTimeout(() => setPhase('play'), 1900 + scoreMs + data.cards.length * 140 + 700),
    ];
    return () => t.forEach(clearTimeout);
  }, [run, data.cards.length, scoreMs]);

  const games = data.games?.length ? data.games : null;
  const plateau = !!games;

  // La carte touchée quitte sa place, grandit jusqu'au centre en tournant sur elle-même, puis se retourne.
  const open = (c: PlayerCard, el: HTMLElement) => {
    if (phase !== 'play' && phase !== 'deal') return;
    if (focus || closing.current) return;
    const r = el.getBoundingClientRect();
    origin.current = { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, open: flipped.has(c.id) };
    setFocus(c);
    setStage(flipped.has(c.id) ? 'award' : 'fly');
  };

  useLayoutEffect(() => {
    const el = flipper.current;
    const from = origin.current;
    if (!focus || !el || !from) return;
    const to = el.getBoundingClientRect();
    const dx = from.rect.x + from.rect.w / 2 - (to.left + to.width / 2);
    const dy = from.rect.y + from.rect.h / 2 - (to.top + to.height / 2);
    const k = from.rect.w / to.width;
    const base = from.open ? 180 : 0;
    // Déjà retournée : un tour complet en grandissant. Sinon : elle grandit de dos, puis se retourne.
    const anim = el.animate(
      from.open
        ? [
            { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotateY(${base}deg)` },
            { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(${(k + 1.15) / 2}) rotateY(${base + 200}deg)`, offset: 0.55 },
            { transform: `translate(0, 0) scale(1) rotateY(${base + 360}deg)` },
          ]
        : [
            { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotateZ(0deg)` },
            { transform: `translate(${dx * 0.25}px, ${dy * 0.25}px) scale(1.12) rotateZ(-6deg)`, offset: 0.7 },
            { transform: 'translate(0, 0) scale(1) rotateZ(0deg)' },
          ],
      { duration: from.open ? 750 : 520, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
    );
    if (from.open) return () => anim.cancel();
    const t1 = setTimeout(() => setStage('flip'), 540);
    const t2 = setTimeout(() => setStage('award'), 540 + 950);
    return () => {
      anim.cancel();
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Seulement à l'ouverture d'une carte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id]);

  const close = () => {
    if (!focus || closing.current) return;
    const next = new Set(flipped).add(focus.id);
    const done = () => {
      closing.current = false;
      setLeaving(false);
      setFlipped(next);
      setFocus(null);
      if (next.size === data.cards.length && flipped.size < data.cards.length) setTimeout(() => setFinale(true), 350);
    };
    // Retour à sa place sur le terrain, en rétrécissant.
    const el = flipper.current;
    const slot = document.querySelector<HTMLElement>(`[data-card="${focus.id}"]`);
    if (!el || !slot) return done();
    closing.current = true;
    setLeaving(true);
    const to = el.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (to.left + to.width / 2);
    const dy = r.top + r.height / 2 - (to.top + to.height / 2);
    const k = r.width / to.width;
    el.animate(
      [{ transform: 'translate(0, 0) scale(1) rotateY(180deg)' }, { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotateY(180deg)` }],
      { duration: 380, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    ).onfinish = done;
  };
  const replay = () => {
    setFlipped(new Set());
    setFinale(false);
    setFocus(null);
    closing.current = false;
    setRun((r) => r + 1);
  };
  const share = async () => {
    const url = data.shareToken ? `${location.origin}/m/${data.shareToken}` : location.href;
    try {
      if (navigator.share) await navigator.share({ title: `Les cartes du match · ${data.team.category}`, text: 'Retournez les cartes des joueurs 🃏', url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Lien copié');
      }
    } catch {
      /* partage annulé */
    }
  };

  // Taille des cartes : tout doit tenir à l'écran, même sur un petit téléphone.
  // Plateau : la colonne des scores prend la gauche de l'écran (en haut sur un téléphone).
  const maxCols = Math.max(...rows.map((r) => r.length));
  const wide = window.innerWidth >= 720;
  const side = plateau && wide ? 230 : 0;
  const top = plateau && !wide ? 64 : 0;
  const cardW = Math.max(
    64,
    Math.min(
      150,
      Math.floor((window.innerWidth - 2 * side - 36 - (maxCols - 1) * 12) / maxCols),
      Math.floor((window.innerHeight - 230 - top - (rows.length - 1) * 14) / rows.length / 1.4),
    ),
  );
  const bigW = Math.round(Math.min(340, window.innerWidth * 0.72, (window.innerHeight - 250) / 1.4));

  // Les cartes sont centrées sur le rond central du terrain (qui, en perspective, n'est pas au centre de l'écran).
  // À la fin, elles grandissent pour devenir l'élément principal.
  const grid = useRef<HTMLDivElement>(null);
  const finaleEl = useRef<HTMLDivElement>(null);
  const finH = useRef(120);
  const [place, setPlace] = useState<{ x: number; y: number; k: number } | null>(null);
  const [vp, setVp] = useState(0);
  useEffect(() => {
    const onResize = () => setVp((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const dealt = phase === 'deal' || phase === 'play';
  useLayoutEffect(() => {
    const g = grid.current;
    const spot = document.querySelector<HTMLElement>('.rv-field .spot');
    if (!dealt || !g || !spot) return;
    const r = spot.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const gw = g.offsetWidth;
    const gh = g.offsetHeight;
    const over = finale;
    if (finaleEl.current) finH.current = finaleEl.current.offsetHeight;
    const fin = over ? finH.current + 34 : 64;
    const head = plateau && !wide ? 140 : 72;
    // Place disponible de part et d'autre du centre (symétrique : la colonne des scores ne décentre pas les cartes).
    const k = over ? Math.max(1, Math.min(1.7, (W - 2 * side - 32) / gw, (H - head - fin - 12) / gh)) : 1;
    const half = (gh * k) / 2;
    const lo = head + half;
    const hi = H - fin - half;
    const y = lo > hi ? (lo + hi) / 2 : Math.min(Math.max(r.top + r.height / 2, lo), hi);
    setPlace({ x: r.left + r.width / 2, y, k });
  }, [dealt, finale, vp, run, cardW, plateau, wide, side]);

  return (
    <div className={`rv phase-${phase}${plateau ? ' plateau' : ''}`}>
      <div className="rv-pitch" aria-hidden>
        <div className="rv-field">
          <i className="mid" />
          <i className="circle" />
          <i className="box top" />
          <i className="box bottom" />
          <i className="spot" />
        </div>
      </div>
      <div className="rv-vignette" aria-hidden />

      <header className="rv-top">
        {onBack && (
          <button className="rv-icon" onClick={onBack} aria-label="Retour">
            <ArrowLeft />
          </button>
        )}
        <span className="grow" />
        {data.shareToken && (
          <button className="rv-icon" onClick={share} aria-label="Partager">
            <Share2 />
          </button>
        )}
        <button className="rv-icon" onClick={replay} aria-label="Rejouer l’animation">
          <RotateCcw />
        </button>
      </header>

      {/* Éclair « Match terminé » */}
      {(phase === 'flash' || phase === 'score') && (
        <div className="rv-center">
          <div className="rv-flash" key={`f${run}`} />
          <Bolt className="l" />
          <Bolt className="r" />
          <h1 className="rv-title" data-text={plateau ? 'PLATEAU TERMINÉ' : 'MATCH TERMINÉ'}>
            {plateau ? 'PLATEAU TERMINÉ' : 'MATCH TERMINÉ'}
          </h1>
          {phase === 'score' && games && (
            <div className="rv-score-list">
              {games.map((g, i) => (
                <span key={g.id} style={{ ['--i' as string]: i } as CSSProperties}>
                  <em>{g.opponent}</em>
                  <b>{g.us === null ? '–' : `${g.us} – ${g.them}`}</b>
                </span>
              ))}
            </div>
          )}
          {phase === 'score' && !games && (
            <div className="rv-score">
              <span>{data.team.category}</span>
              <b>
                {data.score.us}
                <i>–</i>
                {data.score.them}
              </b>
              <span>{data.opponent || 'Adversaire'}</span>
            </div>
          )}
        </div>
      )}

      {(phase === 'deal' || phase === 'play') && (
        <>
          {games ? (
            <GamesBoard games={games} team={data.team.category} />
          ) : (
            <div className="rv-head">
              <span className={`rv-result ${win ? 'win' : draw ? 'draw' : 'loss'}`}>{win ? 'Victoire' : draw ? 'Match nul' : 'Match terminé'}</span>
              <b>
                {data.team.category} {data.score.us} – {data.score.them} {data.opponent || ''}
              </b>
            </div>
          )}
          <div
            ref={grid}
            className="rv-grid"
            style={place ? { left: place.x, top: place.y, transform: `translate(-50%, -50%) scale(${place.k})` } : undefined}
          >
            {rows.map((row, r) => (
              <div key={r} className="rv-row">
                {row.map((i) => {
                  const c = data.cards[i];
                  const done = flipped.has(c.id);
                  return (
                    <button
                      key={`${run}-${c.id}`}
                      data-card={c.id}
                      className={`rv-slot${done ? ' done' : ''}${focus?.id === c.id ? ' away' : ''}`}
                      style={{ ['--i' as string]: i } as CSSProperties}
                      onClick={(e) => open(c, e.currentTarget)}
                      aria-label={done ? `Carte de ${c.firstName}` : 'Retourner la carte'}
                    >
                      {done ? <FutCard card={c} team={data.team} size={cardW} /> : <FutBack size={cardW} mine={c.mine} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {phase === 'play' && flipped.size === 0 && !focus && (
            <p className="rv-hint">
              <Sparkles size={16} /> Touchez une carte pour la retourner
            </p>
          )}
          {finale && !focus && (
            <div className="rv-finale" ref={finaleEl}>
              <Confetti colors={['#d5f58e', '#ffd76a', '#ffffff', data.team.color, '#56a8ff']} />
              <b>Bravo l’équipe !</b>
              {data.summary && <p>« {data.summary} »</p>}
            </div>
          )}
        </>
      )}

      {/* Carte au centre : vol, retournement, récompense */}
      {focus && (
        <div className={`rv-focus stage-${stage}${leaving ? ' leaving' : ''}`} onClick={(e) => e.target === e.currentTarget && stage === 'award' && close()}>
          <div className="rv-rays" style={{ ['--glow' as string]: (TIERS[focus.award.tier] ?? TIERS.gold).glow } as CSSProperties} />
          <div className="rv-flip" ref={flipper} style={{ width: bigW }}>
            <div className="rv-face back">
              <FutBack size={bigW} />
            </div>
            <div className="rv-face front">
              <FutCard card={focus} team={data.team} size={bigW} />
            </div>
          </div>
          {stage === 'award' && (
            <>
              <Confetti count={46} colors={['#ffd76a', '#ffffff', (TIERS[focus.award.tier] ?? TIERS.gold).glow, '#d5f58e']} />
              <div className="duo-award" style={{ ['--glow' as string]: (TIERS[focus.award.tier] ?? TIERS.gold).glow } as CSSProperties}>
                <Bolt className="al" />
                <span className="duo-pill">
                  <span className="duo-emoji">{focus.award.emoji}</span>
                  {focus.award.label}
                </span>
                <Bolt className="ar" />
              </div>
              <p className="duo-sub">
                {focus.firstName} · {focus.minutes} min jouées{focus.goals ? ` · ${focus.goals} but${focus.goals > 1 ? 's' : ''}` : ''}
                {focus.assists ? ` · ${focus.assists} passe${focus.assists > 1 ? 's' : ''} déc.` : ''}
              </p>
              <button className="duo-btn" onClick={close}>
                Continuer
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
