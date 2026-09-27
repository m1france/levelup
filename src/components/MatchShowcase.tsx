import { MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { matchPath } from '../lib/convocations';
import { MONTHS_LONG, formatTime, fromYMD, relativeDay } from '../lib/events';
import { useApp } from '../lib/store';
import type { ConvEventInfo } from '../lib/types';
import { useMatchMenu } from './MatchActions';
import { Showcase } from './Showcase';

const WD = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Jour du match : « Aujourd'hui », « Demain », ou « Samedi 4 octobre ». */
function dayLine(date: string) {
  const rel = relativeDay(date);
  if (rel === 'Aujourd’hui' || rel === 'Demain') return rel;
  const d = fromYMD(date);
  return `${WD[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** Couleur stable dérivée d'un nom (écusson de repli). */
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Écusson dessiné quand le club n'a pas de logo : initiales sur un blason. */
export function Crest({ name, color }: { name: string; color?: string }) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w));
  const initials = (words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [...(words[0] ?? '?').slice(0, 2)]).join('').toUpperCase();
  const h = hue(name);
  const base = color ?? `hsl(${h} 55% 42%)`;
  const id = `crest-${h}-${initials}`;
  return (
    <svg viewBox="0 0 120 140" className="crest" aria-label={name}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: base }} />
          <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${base} 60%, #000)` }} />
        </linearGradient>
      </defs>
      <path d="M60 4 L112 20 V66 C112 104 88 124 60 136 C32 124 8 104 8 66 V20 Z" fill={`url(#${id})`} stroke="rgba(255,255,255,.85)" strokeWidth="5" />
      <path d="M60 16 L100 28 V66 C100 96 82 112 60 122 C38 112 20 96 20 66 V28 Z" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="2" />
      <text x="60" y="80" textAnchor="middle" fontSize={initials.length > 2 ? 34 : 44} fontWeight="800" fill="#fff" fontFamily="inherit" letterSpacing="-1">
        {initials}
      </text>
    </svg>
  );
}

type MatchInfo = Pick<ConvEventInfo, 'eventId' | 'date' | 'teamId' | 'title' | 'time' | 'location' | 'group' | 'organizer' | 'logo' | 'venue' | 'opponent'>;

/** Diapositive d'un match : titre et lieu à gauche, logo du club organisateur à droite, fondus l'un dans l'autre. */
function MatchSlide({ m }: { m: MatchInfo }) {
  const nav = useNavigate();
  const { me } = useApp();
  const team = me.teams.find((t) => t.id === m.teamId);
  const home = m.venue === 'home';
  const organizer = m.organizer || (home ? me.club?.name ?? '' : m.opponent) || '';
  const logo = m.logo ?? (home ? me.club?.logo ?? null : null);
  const crestColor = home ? team?.color : undefined;
  const open = () => nav(matchPath(m.eventId, m.date));
  const { bind, menu } = useMatchMenu(m);

  return (
    <div className="hs match-slide" onContextMenu={'onContextMenu' in bind ? bind.onContextMenu : undefined}>
      {menu}
      <div className="hero2-text">
        <div className="hs-eyebrow">
          {m.group && <b className="ms-group">{m.group}</b>}
          {dayLine(m.date)}
          {m.time ? ` · ${formatTime(m.time)}` : ''}
        </div>
        <h1 onClick={open} style={{ cursor: 'pointer' }}>
          {m.title}
        </h1>
        <div className="ms-foot">
          {m.location && (
            <span className="ms-place">
              <MapPin size={17} /> {m.location}
            </span>
          )}
          <button className="btn lime" onClick={open}>
            Plus d’infos
          </button>
        </div>
      </div>
      <div className="ms-side" onClick={open}>
        {/* Halo : le logo agrandi et flouté (ou la couleur de l'écusson) teinte le côté droit et se fond dans le texte. */}
        <div
          className="ms-halo"
          style={logo ? { backgroundImage: `url(${logo})` } : { background: `radial-gradient(closest-side, ${crestColor ?? `hsl(${hue(organizer || 'Club')} 55% 42%)`}, transparent)` }}
        />
        <div className="ms-logo">{logo ? <img src={logo} alt={organizer} /> : <Crest name={organizer || team?.category || 'Club'} color={crestColor} />}</div>
      </div>
    </div>
  );
}

/** Prochains matchs en diapositives. */
export function MatchShowcase({ matches }: { matches: MatchInfo[] }) {
  if (!matches.length) return null;
  return (
    <Showcase
      className="match-showcase"
      slides={matches.map((m) => ({ key: `${m.eventId}:${m.date}`, node: <MatchSlide m={m} /> }))}
    />
  );
}
