import { ChevronRight, RotateCcw, Users, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FutBack, FutCard } from '../components/FutCard';
import { Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { formatTime } from '../lib/events';
import { cardReveal, packBurst, packTap, unlockAudio, whoosh } from '../lib/sound';
import type { Pack } from '../lib/types';
import { longDate } from './Convocation';
import { Confetti } from './Reveal';

/**
 * Paquet de convocation : l'enfant convoqué tape trois fois sur le paquet aux couleurs du club,
 * qui se déchire ; les indices défilent dans le faisceau (poste, club, numéro) puis sa carte se retourne.
 * On termine sur les infos du match et les cartes des coéquipiers.
 */
export function PackPage() {
  const { eventId, date } = useParams();
  const [params] = useSearchParams();
  const player = params.get('joueur');
  const q = useAsync(() => api.get<Pack>(`/convocations/${eventId}/${date}/pack${player ? `?player=${encodeURIComponent(player)}` : ''}`), [eventId, date, player]);
  const nav = useNavigate();
  // « billet » : la page du match s'affiche sans renvoyer vers le paquet.
  const close = () => nav(`/matchs/${eventId}/${date}?billet`, { replace: true });
  const data = q.data;
  useEffect(() => {
    if (data && !data.preview) void api.post(`/convocations/${data.eventId}/${data.date}/read`).catch(() => undefined);
  }, [data]);
  if (q.loading && !data) return <Spinner fill />;
  if (!data)
    return (
      <div className="pk">
        <div className="pk-center">
          <h2 className="pk-when">Paquet indisponible</h2>
          <p style={{ opacity: 0.7 }}>{q.error}</p>
          <button className="duo-btn" onClick={close}>
            Retour
          </button>
        </div>
      </div>
    );
  return <PackShow data={data} onClose={close} />;
}

type Phase = 'pack' | 'burst' | 'walkout' | 'reveal' | 'card' | 'squad';
const TAPS = 3;
const CLUE_MS = 1350;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function PackShow({ data, onClose }: { data: Pack; onClose: () => void }) {
  const [k, setK] = useState(0);
  const [phase, setPhase] = useState<Phase>('pack');
  const [taps, setTaps] = useState(0);
  const [clue, setClue] = useState(0);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const card = data.cards.find((c) => c.id === data.opened[k]) ?? data.cards[0];
  const logo = data.team.logo;
  const clues = [
    { label: 'Poste', node: <b className="pk-clue-big">{card.position}</b> },
    {
      label: data.club || 'Club',
      node: logo ? (
        <span className="pk-clue-logo">
          <img src={logo} alt="" />
        </span>
      ) : (
        <b className="pk-clue-big">{data.team.category}</b>
      ),
    },
    card.number != null
      ? { label: 'Numéro', node: <b className="pk-clue-big">{card.number}</b> }
      : { label: 'Catégorie', node: <b className="pk-clue-big">{data.team.category}</b> },
  ];

  // Enchaînement automatique : déchirure → indices → retournement → infos.
  useEffect(() => {
    if (phase === 'burst') {
      const t = window.setTimeout(() => setPhase('walkout'), 1000);
      return () => window.clearTimeout(t);
    }
    if (phase === 'walkout') {
      whoosh();
      const t = window.setTimeout(() => (clue + 1 < clues.length ? setClue(clue + 1) : setPhase('reveal')), CLUE_MS);
      return () => window.clearTimeout(t);
    }
    if (phase === 'reveal') {
      const a = window.setTimeout(cardReveal, 850);
      const b = window.setTimeout(() => setPhase('card'), 2600);
      return () => {
        window.clearTimeout(a);
        window.clearTimeout(b);
      };
    }
  }, [phase, clue, clues.length]);

  const tap = () => {
    if (phase !== 'pack' || taps >= TAPS) return;
    unlockAudio();
    const n = taps + 1;
    packTap(n);
    setTaps(n);
    if (n >= TAPS)
      window.setTimeout(() => {
        packBurst();
        setPhase('burst');
      }, 380);
  };

  const restart = (next = k) => {
    setK(next);
    setTaps(0);
    setClue(0);
    setPhase('pack');
  };

  const cardW = Math.round(Math.max(150, Math.min(250, vp.w * 0.6, (vp.h - 360) / 1.4)));
  const others = data.opened.length > 1 && k + 1 < data.opened.length ? data.cards.find((c) => c.id === data.opened[k + 1]) : null;
  const squadCols = Math.min(data.cards.length, vp.w < 520 ? 3 : vp.w < 900 ? 4 : 6);
  const miniW = Math.round(Math.max(84, Math.min(150, (Math.min(vp.w, 1000) - 32 - (squadCols - 1) * 12) / squadCols)));
  const when = cap(longDate(data.date));
  const style = { ['--team' as string]: data.team.color, ['--charge' as string]: taps / TAPS } as CSSProperties;

  return (
    <div className={`pk phase-${phase}`} style={style}>
      <div className="pk-stage" aria-hidden>
        <i className="pk-spot l" />
        <i className="pk-spot r" />
        <div className="pk-dust">
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i } as CSSProperties} />
          ))}
        </div>
      </div>

      <div className="rv-top">
        <button className="rv-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <span className="grow" />
        {data.preview && <span className="pk-preview">Aperçu · {card.firstName}</span>}
      </div>

      {(phase === 'pack' || phase === 'burst') && (
        <div className="pk-center">
          <p className="pk-kicker">
            {data.team.category ? `${data.team.category} · ` : ''}
            {data.title}
          </p>
          <button className={`pk-pack${taps ? ' hit' : ''}`} key={taps} onClick={tap} aria-label="Ouvrir le paquet">
            <span className="pk-pack-top">
              <span>{data.club || 'Convocation'}</span>
            </span>
            <span className="pk-pack-body">
              {logo ? (
                <span className="pk-pack-logo">
                  <img src={logo} alt="" draggable={false} />
                </span>
              ) : (
                <span className="pk-pack-logo text">{data.team.category}</span>
              )}
              <b>Convocation</b>
              <em>{data.team.category}</em>
              <small>{when}</small>
            </span>
            <span className="pk-glow" />
            <svg className="pk-cracks" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
              <polyline className={taps >= 1 ? 'on' : ''} points="50,40 44,58 55,70 47,88" />
              <polyline className={taps >= 2 ? 'on' : ''} points="47,88 30,96 22,118 8,124" />
              <polyline className={taps >= 2 ? 'on' : ''} points="55,70 72,78 80,98 94,104" />
              <polyline className={taps >= 3 ? 'on' : ''} points="47,88 52,110 44,130 50,150" />
            </svg>
          </button>
          <p className="pk-hint">{taps === 0 ? 'Touche le paquet pour l’ouvrir !' : taps < TAPS ? `Encore ${TAPS - taps} !` : 'Ça s’ouvre…'}</p>
          {phase === 'burst' && <div className="pk-flash" />}
        </div>
      )}

      {phase === 'walkout' && (
        <div className="pk-center pk-walk" onClick={() => (clue + 1 < clues.length ? setClue(clue + 1) : setPhase('reveal'))}>
          <div className="pk-beam" />
          <div className="pk-clue" key={clue} style={{ animationDuration: `${CLUE_MS}ms` }}>
            <small>{clues[clue].label}</small>
            {clues[clue].node}
          </div>
          <div className="pk-dots">
            {clues.map((_, i) => (
              <i key={i} className={i < clue ? 'done' : i === clue ? 'now' : ''} />
            ))}
          </div>
        </div>
      )}

      {(phase === 'reveal' || phase === 'card') && (
        <div className="pk-center pk-show">
          <div className="pk-beam" />
          <div className="pk-rays" />
          <div className="pk-flip" style={{ width: cardW }}>
            <div className="pk-face back">
              <FutBack size={cardW} />
            </div>
            <div className="pk-face front">
              <FutCard card={card} team={data.team} size={cardW} foot={<span>{data.team.category || 'Convoqué'}</span>} />
            </div>
          </div>
          <div className="pk-banner">
            <span className="duo-pill" style={{ ['--glow' as string]: '#ffd76a' } as CSSProperties}>
              <span className="duo-emoji">✅</span> Convoqué !
            </span>
          </div>
          {phase === 'reveal' && <div className="pk-flash late" />}
          {phase === 'card' && (
            <>
              <Confetti colors={['#ffd76a', '#ffffff', data.team.color, '#d5f58e']} />
              <div className="pk-info">
                <h2 className="pk-when">
                  {when}
                  {data.time ? ` · ${formatTime(data.time)}` : ''}
                </h2>
                <p>
                  {data.title}
                  {data.meetTime ? ` · Rendez-vous ${formatTime(data.meetTime)}` : ''}
                </p>
                {data.location && <p className="pk-where">{data.location}</p>}
              </div>
              <div className="pk-actions">
                {others ? (
                  <button className="duo-btn" onClick={() => restart(k + 1)}>
                    Paquet de {others.firstName} <ChevronRight size={18} />
                  </button>
                ) : (
                  data.cards.length > 1 && (
                    <button className="duo-btn" onClick={() => setPhase('squad')}>
                      <Users size={18} /> Mes coéquipiers
                    </button>
                  )
                )}
                <button className="duo-btn ghost" onClick={onClose}>
                  Voir la convocation
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'squad' && (
        <div className="pk-center pk-squad">
          <h2 className="pk-when">Le groupe {data.team.category}</h2>
          <p className="pk-sub">
            {data.cards.length} joueurs · {when}
          </p>
          <div className="pk-grid">
            {data.cards.map((c, i) => (
              <div key={c.id} className={`pk-mini${c.mine ? ' mine' : ''}`} style={{ ['--i' as string]: i } as CSSProperties}>
                <FutCard card={c} team={data.team} size={miniW} foot={c.number != null ? <span>#{c.number}</span> : <span>{data.team.category}</span>} />
              </div>
            ))}
          </div>
          <div className="pk-actions">
            <button className="duo-btn ghost" onClick={() => restart(0)}>
              <RotateCcw size={17} /> Rejouer
            </button>
            <button className="duo-btn" onClick={onClose}>
              Voir la convocation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
