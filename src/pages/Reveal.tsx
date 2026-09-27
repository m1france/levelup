import { ArrowLeft, RotateCcw, Share2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FutBack, FutCard, TIERS } from '../components/FutCard';
import { Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import type { PlayerCard, Reveal } from '../lib/types';

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

function Confetti({ count = 60, colors }: { count?: number; colors: string[] }) {
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

export function RevealShow({ data, onBack }: { data: Reveal; onBack?: () => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('intro');
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<PlayerCard | null>(null);
  const [stage, setStage] = useState<'fly' | 'flip' | 'award'>('fly');
  const [finale, setFinale] = useState(false);
  const [run, setRun] = useState(0);
  const rows = layout(data.cards.length);
  const win = data.score.us > data.score.them;
  const draw = data.score.us === data.score.them;

  // Séquence d'ouverture : éclair « Match terminé », score, puis distribution des cartes.
  useEffect(() => {
    setPhase('intro');
    const t = [
      setTimeout(() => setPhase('flash'), 350),
      setTimeout(() => setPhase('score'), 1900),
      setTimeout(() => setPhase('deal'), 3300),
      setTimeout(() => setPhase('play'), 3300 + data.cards.length * 140 + 700),
    ];
    return () => t.forEach(clearTimeout);
  }, [run, data.cards.length]);

  const open = (c: PlayerCard) => {
    if (phase !== 'play' && phase !== 'deal') return;
    setFocus(c);
    setStage('fly');
    setTimeout(() => setStage('flip'), 380);
    setTimeout(() => setStage('award'), 380 + 950);
  };
  const close = () => {
    if (!focus) return;
    const next = new Set(flipped).add(focus.id);
    setFlipped(next);
    setFocus(null);
    if (next.size === data.cards.length) setTimeout(() => setFinale(true), 350);
  };
  const replay = () => {
    setFlipped(new Set());
    setFinale(false);
    setFocus(null);
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
  const maxCols = Math.max(...rows.map((r) => r.length));
  const cardW = Math.max(
    70,
    Math.min(150, Math.floor((window.innerWidth - 36 - (maxCols - 1) * 12) / maxCols), Math.floor((window.innerHeight - 230 - (rows.length - 1) * 14) / rows.length / 1.4)),
  );

  return (
    <div className={`rv phase-${phase}`}>
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
          <h1 className="rv-title" data-text="MATCH TERMINÉ">
            MATCH TERMINÉ
          </h1>
          {phase === 'score' && (
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
          <div className="rv-head">
            <span className={`rv-result ${win ? 'win' : draw ? 'draw' : 'loss'}`}>{win ? 'Victoire' : draw ? 'Match nul' : 'Match terminé'}</span>
            <b>
              {data.team.category} {data.score.us} – {data.score.them} {data.opponent || ''}
            </b>
          </div>
          <div className="rv-grid">
            {rows.map((row, r) => (
              <div key={r} className="rv-row">
                {row.map((i) => {
                  const c = data.cards[i];
                  const done = flipped.has(c.id);
                  return (
                    <button
                      key={`${run}-${c.id}`}
                      className={`rv-slot${done ? ' done' : ''}${focus?.id === c.id ? ' away' : ''}`}
                      style={{ ['--i' as string]: i } as CSSProperties}
                      onClick={() => {
                        if (!done) return open(c);
                        setFocus(c);
                        setStage('award');
                      }}
                      aria-label={done ? `Carte de ${c.firstName}` : 'Retourner la carte'}
                    >
                      {done ? <FutCard card={c} team={data.team} size={cardW} /> : <FutBack team={data.team} size={cardW} mine={c.mine} />}
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
            <div className="rv-finale">
              <Confetti colors={['#d5f58e', '#ffd76a', '#ffffff', data.team.color, '#56a8ff']} />
              <b>Bravo l’équipe !</b>
              {data.summary && <p>« {data.summary} »</p>}
              <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
                <button className="duo-btn ghost" onClick={replay}>
                  Rejouer
                </button>
                {data.shareToken && (
                  <button className="duo-btn" onClick={share}>
                    Partager
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Carte au centre : vol, retournement, récompense */}
      {focus && (
        <div className={`rv-focus stage-${stage}`} onClick={(e) => e.target === e.currentTarget && stage === 'award' && close()}>
          <div className="rv-rays" style={{ ['--glow' as string]: (TIERS[focus.award.tier] ?? TIERS.gold).glow } as CSSProperties} />
          <div className="rv-flip">
            <div className="rv-face back">
              <FutBack team={data.team} size={260} />
            </div>
            <div className="rv-face front">
              <FutCard card={focus} team={data.team} size={260} />
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
