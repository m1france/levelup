import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Seg, Spinner, useAsync } from '../components/ui';
import { TeamBadge } from '../components/Layout';
import { api } from '../lib/api';
import { PHASE, countdown, matchPath, momentLabel } from '../lib/convocations';
import { useMatchMenu } from '../components/MatchActions';
import { MONTHS_TILE, formatTime, fromYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { playerName, useApp } from '../lib/store';
import type { ConvSnapshot, TeamStats, Ticket } from '../lib/types';
import { Gauge } from './Convocation';
import { groupsOf } from '../lib/groups';

/* ------------------------------------------------------------------ parents */

export function useTickets() {
  const q = useAsync(() => api.get<Ticket[]>('/me/matches'), []);
  useLive((m) => m.t === 'conv' && q.reload());
  return q;
}

/* ------------------------------------------------------------------ éducateurs */

/** Équipe U8/U9 : la catégorie affichée (dans l'adresse, ?cat=U9). */
function useGroup() {
  const { team } = useApp();
  const [params, setParams] = useSearchParams();
  const groups = groupsOf(team?.category);
  const group = groups.length ? (groups.includes(params.get('cat') ?? '') ? params.get('cat')! : groups[0]) : null;
  const setGroup = (g: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('cat', g);
      return n;
    });
  return { groups, group, setGroup };
}

const withGroup = (url: string, group: string | null) => (group ? `${url}${url.includes('?') ? '&' : '?'}group=${group}` : url);

/** Temps de jeu : équité des convocations et minutes jouées, par catégorie (U8, U9…). */
export function PlayingTime() {
  const { team } = useApp();
  const { groups, group, setGroup } = useGroup();
  return (
    <div className="page">
      <Link to="/" className="back">
        <ArrowLeft size={15} /> Calendrier
      </Link>
      <div className="page-head">
        <div>
          <h1>Temps de jeu</h1>
          <div className="sub">{team?.category}{groups.length ? ' · statistiques séparées par catégorie' : ''} · équité des convocations et minutes jouées</div>
        </div>
        {groups.length > 0 && (
          <div className="actions">
            <Seg value={group!} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />
          </div>
        )}
      </div>
      <Equity key={group ?? ''} group={group} />
    </div>
  );
}

/** Ancienne page Matchs : tout est désormais dans le calendrier (le temps de jeu a sa page). */
export function MatchesRedirect() {
  const [params] = useSearchParams();
  const cat = params.get('cat');
  if (params.get('vue') === 'equite') return <Navigate to={`/temps-de-jeu${cat ? `?cat=${cat}` : ''}`} replace />;
  return <Navigate to="/" replace />;
}

function DateTile({ date }: { date: string }) {
  const d = fromYMD(date);
  return (
    <div className="tk-date">
      <small>{['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'][d.getDay()]}</small>
      <b>{d.getDate()}</b>
      <small>{MONTHS_TILE[d.getMonth()]}</small>
    </div>
  );
}

/** Ce qu'il reste à faire, en une phrase. */
export function nextStep(c: ConvSnapshot) {
  const now = Date.now();
  switch (c.phase) {
    case 'upcoming':
      return c.timeline.request ? `Dispos demandées ${momentLabel(c.timeline.request)}` : `À publier avant ${momentLabel(c.timeline.deadline)}`;
    case 'collecting':
      return `À publier avant ${momentLabel(c.timeline.deadline)} · ${countdown(c.timeline.deadline)}`;
    case 'late':
      return `Date limite dépassée ${countdown(c.timeline.deadline)}`;
    case 'published':
      return now > c.timeline.start ? 'Match en cours ou à compléter' : `Lue par ${c.reads}/${c.readers} parents`;
    default:
      if (c.score?.games) {
        const g = c.score.games.filter((x) => x.us !== null && !x.live);
        const w = g.filter((x) => x.us! > x.them!).length;
        const d = g.filter((x) => x.us === x.them).length;
        return `Plateau · ${w} V · ${d} N · ${g.length - w - d} D`;
      }
      return c.score ? `${c.score.us} – ${c.score.them}` : 'Terminé';
  }
}

export function ConvCard({ c, showTeam }: { c: ConvSnapshot; showTeam?: boolean }) {
  const nav = useNavigate();
  const { me } = useApp();
  const team = me.teams.find((t) => t.id === c.teamId) ?? null;
  const answered = c.counts.yes + c.counts.maybe + c.counts.no;
  const phase = PHASE[c.phase];
  const urgent = c.phase === 'collecting' && c.timeline.deadline - Date.now() < 24 * 3600e3;
  const { bind, menu } = useMatchMenu(c);
  return (
    <>
    {menu}
    <button className={`conv-card phase-${c.phase}${urgent ? ' urgent' : ''}`} onClick={() => nav(matchPath(c.eventId, c.date))} {...bind}>
      <div className="match-card-date"><DateTile date={c.date} /></div>
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}>
          {showTeam && team && <TeamBadge team={team} size={22} brand={false} />}
          <b className="ellipsis">{c.title}</b>
        </div>
        <small className="muted">
          {fromYMD(c.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}{c.phase !== 'played' && c.time ? ` · ${formatTime(c.time)}` : ''}

          {c.location ? ` · ${c.location}` : ''}
        </small>
        <div className="conv-card-foot">
          <span className={`badge ${urgent ? 'warn' : phase.tone}`}>{phase.label}</span>
          <span className="small">{nextStep(c)}</span>
        </div>
      </div>
      <div className="conv-card-side match-card-scores">
        {c.score?.games?.length ? c.score.games.map((g) => <strong key={g.id} title={g.opponent}>{g.us === null ? '–' : `${g.us}-${g.them}`}</strong>) : c.score ? <strong>{c.score.us}-{c.score.them}</strong> : <span className="match-card-upcoming">{c.phase === 'published' ? `${c.selected} convoqués` : `${answered}/${c.total} réponses`}</span>}
      </div>
      <ChevronRight className="hide-mobile" color="var(--ink-3)" />
    </button>
    </>
  );
}

/* ------------------------------------------------------------------ équité */

type SortKey = 'played' | 'minutes' | 'notSelected' | 'name';

function Equity({ group }: { group: string | null }) {
  const { team } = useApp();
  const q = useAsync(() => (team ? api.get<TeamStats>(withGroup(`/teams/${team.id}/stats`, group)) : Promise.resolve(null)), [team?.id, group]);
  const [sort, setSort] = useState<SortKey>('played');
  const rows = useMemo(() => {
    const list = [...(q.data?.players ?? [])];
    if (sort === 'name') list.sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'));
    if (sort === 'played') list.sort((a, b) => a.played - b.played || a.minutes - b.minutes);
    if (sort === 'minutes') list.sort((a, b) => a.minutes - b.minutes);
    if (sort === 'notSelected') list.sort((a, b) => b.notSelected - a.notSelected);
    return list;
  }, [q.data, sort]);
  if (q.loading && !q.data) return <Spinner fill />;
  const s = q.data;
  if (!s) return null;
  const maxPlayed = Math.max(1, ...s.players.map((p) => p.played));
  const maxMin = Math.max(1, ...s.players.map((p) => p.minutes));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid cols-3">
        <div className="card stat row" style={{ gap: 14 }}>
          <Gauge value={s.equity} />
          <div>
            <div className="l">Équité des convocations</div>
            <small className="muted">{s.equity === null ? 'Pas encore assez de matchs' : s.equity >= 80 ? 'Très équilibré' : s.equity >= 60 ? 'Quelques écarts' : 'Déséquilibré'}</small>
          </div>
        </div>
        <div className="card stat row" style={{ gap: 14 }}>
          <Gauge value={s.minutesEquity} />
          <div>
            <div className="l">Équité du temps de jeu</div>
            <small className="muted">{s.avgMinutes ? `${s.avgMinutes} min par match en moyenne` : 'Utilisez le mode match'}</small>
          </div>
        </div>
        <div className="card stat">
          <div className="v">{s.matches}</div>
          <div className="l">matchs cette saison · moyenne {String(s.mean).replace('.', ',')} joués</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ paddingBottom: 12 }}>
          <h3>Par joueur</h3>
          <Seg<SortKey>
            value={sort}
            onChange={setSort}
            options={[
              { value: 'played', label: 'Joués' },
              { value: 'minutes', label: 'Minutes' },
              { value: 'notSelected', label: 'Non retenus' },
              { value: 'name', label: 'A–Z' },
            ]}
          />
        </div>
        <div className="table-scroll">
          <table className="eq-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Matchs joués</th>
                <th className="hide-mobile">Minutes</th>
                <th title="Non retenu alors qu’il était disponible">Non retenu</th>
                <th title="Indisponible (excusé)">Indispo.</th>
                <th className="hide-mobile" title="Convoqué mais absent">Absent</th>
                <th className="hide-mobile">Titulaire</th>
                <th className="hide-mobile">Buts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.matches && p.delta <= -1 ? 'low' : ''}>
                  <td>
                    <Link to={`/joueurs/${p.id}`} className="row" style={{ gap: 8 }}>
                      <b>{playerName(p)}</b>
                    </Link>
                  </td>
                  <td>
                    <span className="bar-cell">
                      <span className="played-bar">
                        <i style={{ width: `${(p.played / maxPlayed) * 100}%` }} className={p.delta <= -1 ? 'low' : p.delta >= 1 ? 'high' : ''} />
                        <u style={{ left: `${(s.mean / maxPlayed) * 100}%` }} />
                      </span>
                      <b>{p.played}</b>
                      {p.matches > 0 && Math.abs(p.delta) >= 0.5 && (
                        <small className={p.delta < 0 ? 'neg' : 'pos'}>{`${p.delta > 0 ? '+' : ''}${String(p.delta).replace('.', ',')}`}</small>
                      )}
                    </span>
                  </td>
                  <td className="hide-mobile">
                    <span className="bar-cell">
                      <span className="played-bar">
                        <i style={{ width: `${(p.minutes / maxMin) * 100}%` }} />
                      </span>
                      <b>{p.minutes}′</b>
                    </span>
                  </td>
                  <td>{p.notSelected || '·'}</td>
                  <td>{p.unavailable || '·'}</td>
                  <td className="hide-mobile">{p.noShow || '·'}</td>
                  <td className="hide-mobile">{p.starts || '·'}</td>
                  <td className="hide-mobile">{p.goals || '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ padding: '10px 20px 16px' }}>
          Le trait vertical marque la moyenne de l’équipe. En orange : au moins un match de moins que la moyenne, ils sont proposés en priorité à la prochaine convocation.
        </p>
      </div>
    </div>
  );
}
