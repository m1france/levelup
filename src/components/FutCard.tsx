import { useId, type ReactNode } from 'react';
import type { PlayerCard } from '../lib/types';

/** Silhouette de la carte (façon Ultimate Team) : couronne en haut, pointe en bas. */
export const SHAPE = 'M22 34 Q62 34 92 14 Q125 -3 158 14 Q188 34 228 34 L240 46 L240 296 Q240 310 228 317 L137 345 Q125 350 113 345 L22 317 Q10 310 10 296 L10 46 Z';

export const TIERS: Record<string, { from: string; mid: string; to: string; ink: string; line: string; glow: string }> = {
  gold: { from: '#fff3c4', mid: '#e7c35a', to: '#b8891f', ink: '#3b2a05', line: 'rgba(90,60,0,.35)', glow: '#ffd76a' },
  silver: { from: '#ffffff', mid: '#cfd6df', to: '#8e98a6', ink: '#1f252d', line: 'rgba(30,40,55,.3)', glow: '#e3ecf7' },
  red: { from: '#ff9a7a', mid: '#e8392f', to: '#8c0f16', ink: '#fff4d6', line: 'rgba(255,230,190,.45)', glow: '#ff6b52' },
  blue: { from: '#9fd3ff', mid: '#2f7de1', to: '#0f2f7a', ink: '#f2f8ff', line: 'rgba(210,235,255,.45)', glow: '#56a8ff' },
  green: { from: '#b4f5c8', mid: '#23a35c', to: '#0b4f2c', ink: '#f1fff5', line: 'rgba(210,255,225,.45)', glow: '#4ee08b' },
  totw: { from: '#4a4a4a', mid: '#1c1c1c', to: '#050505', ink: '#f6d77a', line: 'rgba(246,215,122,.55)', glow: '#f6d77a' },
  pink: { from: '#ffc2dd', mid: '#e8488f', to: '#8d1450', ink: '#fff2f8', line: 'rgba(255,220,238,.45)', glow: '#ff7ab6' },
  bronze: { from: '#f6d9bd', mid: '#c98c56', to: '#7c4a22', ink: '#2e1807', line: 'rgba(70,35,5,.32)', glow: '#e7a86e' },
};

function Silhouette({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 100 110" className="fut-sil" aria-hidden>
      <circle cx="50" cy="34" r="20" fill={color} />
      <path d="M12 110 Q14 66 50 62 Q86 66 88 110 Z" fill={color} />
    </svg>
  );
}

/**
 * Carte de joueur, face visible. `size` = largeur en px (tout le reste est proportionnel).
 * `foot` remplace la ligne du bas (minutes, buts) : l'effectif y met l'année de naissance.
 */
export interface CardTeam { category: string; color: string; logo?: string | null }

/** Écusson de la carte : le logo du club, sinon la catégorie sur la couleur de l'équipe. */
function Crest({ team }: { team: CardTeam }) {
  if (team.logo)
    return (
      <span className="fut-club logo">
        <img src={team.logo} alt="" draggable={false} />
      </span>
    );
  return (
    <span className="fut-club" style={{ background: team.color }}>
      {team.category.replace(/\s+/g, '').slice(0, 5)}
    </span>
  );
}

export function FutCard({ card, team, size = 240, foot }: { card: PlayerCard; team: CardTeam; size?: number; foot?: ReactNode }) {
  const uid = useId().replace(/:/g, '');
  const t = TIERS[card.award.tier] ?? TIERS.gold;
  return (
    <div className={`fut tier-${card.award.tier}`} style={{ width: size, ['--ink' as string]: t.ink, ['--line' as string]: t.line, ['--glow' as string]: t.glow, fontSize: size / 10 }}>
      <svg className="fut-bg" viewBox="0 0 250 350" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={t.from} />
            <stop offset=".5" stopColor={t.mid} />
            <stop offset="1" stopColor={t.to} />
          </linearGradient>
          <linearGradient id={`s${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`c${uid}`}>
            <path d={SHAPE} />
          </clipPath>
        </defs>
        <path d={SHAPE} fill={`url(#g${uid})`} />
        <g clipPath={`url(#c${uid})`}>
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${-60 + i * 40} 350 L${40 + i * 40} 0`} stroke={t.line} strokeWidth="14" opacity=".18" />
          ))}
          <rect className="fut-shine" x="-120" y="-20" width="90" height="400" fill={`url(#s${uid})`} transform="skewX(-18)" />
        </g>
        <path d={SHAPE} fill="none" stroke={t.line} strokeWidth="2.5" transform="translate(125 175) scale(.93) translate(-125 -175)" />
      </svg>

      <div className={`fut-photo${card.cutout ? ' cutout' : ''}`}>
        {card.photo ? <img src={card.photo} alt={card.firstName} draggable={false} /> : <Silhouette color={t.line} />}
      </div>
      <div className="fut-left">
        <b className="fut-ovr">{card.ovr}</b>
        <span className="fut-pos">{card.position}</span>
        <Crest team={team} />
      </div>
      <div className="fut-name">{card.firstName}</div>
      <div className="fut-stats">
        {card.stats.map(([k, v]) => (
          <span key={k}>
            <b>{v}</b> {k}
          </span>
        ))}
      </div>
      <div className="fut-foot">
        {foot ?? (
          <>
            {card.number !== undefined && <span>#{card.number}</span>}
            <span>{card.minutes}′</span>
            {card.goals > 0 && <span>⚽ {card.goals}</span>}
            {card.assists > 0 && <span>🎯 {card.assists}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** Dos de carte (avant le retournement). */
export function FutBack({ size = 240, mine }: { size?: number; mine?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div className={`fut fut-back${mine ? ' mine' : ''}`} style={{ width: size, fontSize: size / 10 }}>
      <svg className="fut-bg" viewBox="0 0 250 350" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={`b${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#23553f" />
            <stop offset=".55" stopColor="#0f2a20" />
            <stop offset="1" stopColor="#07140f" />
          </linearGradient>
          <clipPath id={`k${uid}`}>
            <path d={SHAPE} />
          </clipPath>
        </defs>
        <path d={SHAPE} fill={`url(#b${uid})`} />
        <g clipPath={`url(#k${uid})`} opacity=".22">
          {Array.from({ length: 14 }, (_, i) => (
            <circle key={i} cx="125" cy="175" r={14 + i * 16} fill="none" stroke="#d5f58e" strokeWidth="1.2" />
          ))}
        </g>
        <path d={SHAPE} fill="none" stroke="#d5f58e" strokeOpacity=".7" strokeWidth="2.5" transform="translate(125 175) scale(.93) translate(-125 -175)" />
      </svg>
      <div className="fut-back-mark">
        <b>?</b>
      </div>
      {mine && <em className="fut-mine">Mon enfant</em>}
    </div>
  );
}
