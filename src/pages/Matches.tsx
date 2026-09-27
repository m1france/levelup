import { Bell, CalendarPlus, Check, ChevronRight, Clock, Eye, Megaphone, Shield, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PushCard } from '../components/Notifications';
import { MatchTicket } from '../components/Tickets';
import { Empty, Seg, Spinner, useAsync } from '../components/ui';
import { TeamBadge } from '../components/Layout';
import { api } from '../lib/api';
import { PHASE, countdown, matchPath, momentLabel } from '../lib/convocations';
import { MONTHS_TILE, formatTime, fromYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { playerName, useApp } from '../lib/store';
import type { ClubTeamOverview, ConvSnapshot, TeamStats, Ticket } from '../lib/types';
import { Gauge } from './Convocation';

export function Matches() {
  const { isStaff } = useApp();
  return isStaff ? <StaffMatches /> : <ParentMatches />;
}

/* ------------------------------------------------------------------ parents */

export function useTickets() {
  const q = useAsync(() => api.get<Ticket[]>('/me/matches'), []);
  useLive((m) => m.t === 'conv' && q.reload());
  return q;
}

function ParentMatches() {
  const q = useTickets();
  const now = Date.now();
  const isPast = (t: Ticket) => !!t.result || t.timeline.start + 3 * 3600e3 <= now;
  const upcoming = (q.data ?? []).filter((t) => !isPast(t));
  const past = (q.data ?? []).filter(isPast).reverse();
  const multi = new Set((q.data ?? []).map((t) => t.child.id)).size > 1;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Matchs</h1>
      </div>
      <div style={{ marginBottom: 18 }}>
        <PushCard compact />
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : upcoming.length ? (
        <div className="stack" style={{ gap: 18 }}>
          {upcoming.map((t) => (
            <MatchTicket key={t.key} t={t} onChanged={q.reload} showChild={multi} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Trophy />} title="Pas de match prévu" text="Les prochains matchs apparaîtront ici dès que l’éducateur les aura programmés." />
        </div>
      )}
      {past.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 32 }}>
            Derniers matchs
          </div>
          <div className="stack" style={{ gap: 18 }}>
            {past.map((t) => (
              <MatchTicket key={t.key} t={t} onChanged={q.reload} showChild={multi} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ éducateurs */

type Tab = 'matchs' | 'equite' | 'club';

function StaffMatches() {
  const { team, can } = useApp();
  const [params, setParams] = useSearchParams();
  const tabs: { value: Tab; label: string }[] = [
    { value: 'matchs', label: 'Convocations' },
    { value: 'equite', label: 'Temps de jeu' },
    ...(can('club.dashboard') ? [{ value: 'club' as Tab, label: 'Club' }] : []),
  ];
  const tab = tabs.find((t) => t.value === params.get('vue'))?.value ?? 'matchs';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Matchs</h1>
          <div className="sub">{team?.category}</div>
        </div>
        <Seg value={tab} onChange={(v) => setParams(v === 'matchs' ? {} : { vue: v })} options={tabs} />
      </div>
      {tab === 'matchs' && <ConvList />}
      {tab === 'equite' && <Equity />}
      {tab === 'club' && <ClubBoard />}
    </div>
  );
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
function nextStep(c: ConvSnapshot) {
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
  return (
    <button className={`conv-card phase-${c.phase}${urgent ? ' urgent' : ''}`} onClick={() => nav(matchPath(c.eventId, c.date))}>
      <DateTile date={c.date} />
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}>
          {showTeam && team && <TeamBadge team={team} size={22} />}
          <b className="ellipsis">{c.title}</b>
        </div>
        <small className="muted">
          {c.time ? formatTime(c.time) : 'Journée'}
          {c.meetTime ? ` · RDV ${formatTime(c.meetTime)}` : ''}
          {c.location ? ` · ${c.location}` : ''}
        </small>
        <div className="conv-card-foot">
          <span className={`badge ${urgent ? 'warn' : phase.tone}`}>{phase.label}</span>
          <span className="small">{nextStep(c)}</span>
        </div>
      </div>
      <div className="conv-card-side">
        {c.phase === 'published' || c.phase === 'played' ? (
          <span className="big-num">
            {c.selected}
            <small>convoqués</small>
          </span>
        ) : (
          <span className="big-num">
            {answered}/{c.total}
            <small>réponses</small>
          </span>
        )}
        <div className="avail-bar mini" aria-hidden>
          <i className="yes" style={{ flex: c.counts.yes }} />
          <i className="maybe" style={{ flex: c.counts.maybe }} />
          <i className="none" style={{ flex: c.counts.none }} />
          <i className="no" style={{ flex: c.counts.no }} />
        </div>
      </div>
      <ChevronRight className="hide-mobile" color="var(--ink-3)" />
    </button>
  );
}

function ConvList() {
  const { team } = useApp();
  const q = useAsync(() => (team ? api.get<ConvSnapshot[]>(`/teams/${team.id}/convocations`) : Promise.resolve([])), [team?.id]);
  useLive((m) => m.t === 'conv' && q.reload());
  const now = Date.now();
  const list = q.data ?? [];
  const todo = list.filter((c) => c.timeline.start > now && ['collecting', 'late', 'upcoming'].includes(c.phase));
  const ready = list.filter((c) => c.timeline.start > now && c.phase === 'published');
  const past = list.filter((c) => c.timeline.start <= now || c.phase === 'played').reverse();
  if (q.loading && !q.data) return <Spinner fill />;
  if (!list.length)
    return (
      <div className="card">
        <Empty
          icon={<Megaphone />}
          title="Aucun match programmé"
          text="Ajoutez un match, un plateau ou un tournoi dans le calendrier : la convocation se prépare toute seule (disponibilités, relances, date limite)."
          action={
            <Link className="btn primary" to="/">
              <CalendarPlus /> Ouvrir le calendrier
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="stack" style={{ gap: 28 }}>
      {todo.length > 0 && (
        <section>
          <div className="section-title">À préparer</div>
          <div className="stack" style={{ gap: 10 }}>
            {todo.map((c) => (
              <ConvCard key={`${c.eventId}:${c.date}`} c={c} />
            ))}
          </div>
        </section>
      )}
      {ready.length > 0 && (
        <section>
          <div className="section-title">Convocations publiées</div>
          <div className="stack" style={{ gap: 10 }}>
            {ready.map((c) => (
              <ConvCard key={`${c.eventId}:${c.date}`} c={c} />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <div className="section-title">Joués</div>
          <div className="stack" style={{ gap: 10 }}>
            {past.map((c) => (
              <ConvCard key={`${c.eventId}:${c.date}`} c={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ équité */

type SortKey = 'played' | 'minutes' | 'notSelected' | 'name';

function Equity() {
  const { team } = useApp();
  const q = useAsync(() => (team ? api.get<TeamStats>(`/teams/${team.id}/stats`) : Promise.resolve(null)), [team?.id]);
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
                      {p.number !== undefined && <span className="cv-num">{p.number}</span>}
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

/* ------------------------------------------------------------------ club */

function ClubBoard() {
  const q = useAsync(() => api.get<ClubTeamOverview[]>('/club/overview'), []);
  if (q.loading && !q.data) return <Spinner fill />;
  const teams = q.data ?? [];
  const now = Date.now();
  const status = (c: ConvSnapshot | undefined) => {
    if (!c) return { tone: 'gray', label: 'Rien de prévu' };
    if (c.phase === 'published' || c.phase === 'played') return c.publishedLate ? { tone: 'orange', label: 'Publiée en retard' } : { tone: 'green', label: 'Convoqué à l’heure' };
    if (c.phase === 'late' || c.phase === 'missed') return { tone: 'red', label: 'En retard' };
    if (c.timeline.deadline - now < 24 * 3600e3) return { tone: 'orange', label: `Échéance ${momentLabel(c.timeline.deadline)}` };
    return { tone: 'gray', label: `À publier avant ${momentLabel(c.timeline.deadline)}` };
  };
  const totalPast = teams.reduce((a, t) => a + t.past, 0);
  const totalOnTime = teams.reduce((a, t) => a + t.onTime, 0);
  const late = teams.filter((t) => ['red'].includes(status(t.upcoming[0]).tone)).length;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid cols-3">
        <div className="card stat">
          <div className="v">{totalPast ? `${Math.round((totalOnTime / totalPast) * 100)} %` : '—'}</div>
          <div className="l">des convocations publiées dans les délais cette saison</div>
        </div>
        <div className="card stat">
          <div className="v" style={{ color: late ? 'var(--danger)' : undefined }}>{late}</div>
          <div className="l">équipe{late > 1 ? 's' : ''} en retard en ce moment</div>
        </div>
        <div className="card stat">
          <div className="v">{teams.reduce((a, t) => a + t.players, 0)}</div>
          <div className="l">
            joueurs · {teams.length} équipe{teams.length > 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <div className="club-grid">
        {teams.map((t) => {
          const next = t.upcoming[0];
          const st = status(next);
          return (
            <div key={t.team.id} className="card club-card">
              <div className="row" style={{ gap: 10 }}>
                <TeamBadge team={{ ...t.team, name: t.team.category, season: '', staff: [], playerCount: t.players }} size={38} />
                <div className="grow">
                  <b>{t.team.category}</b>
                  <small className="muted ellipsis" style={{ display: 'block' }}>
                    {t.staff.join(', ') || 'Pas d’éducateur'}
                  </small>
                </div>
                <span className={`pastille ${st.tone}`} title={st.label} />
              </div>
              {next ? (
                <Link to={matchPath(next.eventId, next.date)} className="club-next">
                  <span className="grow">
                    <b>{next.title}</b>
                    <small>
                      {momentLabel(next.timeline.start)} · {st.label}
                    </small>
                  </span>
                  <span className="small muted">
                    {next.publishedAt ? (
                      <>
                        <Eye size={12} /> {next.reads}/{next.readers}
                      </>
                    ) : (
                      <>
                        <Bell size={12} /> {next.counts.yes + next.counts.maybe + next.counts.no}/{next.total}
                      </>
                    )}
                  </span>
                </Link>
              ) : (
                <p className="small muted">Aucun match dans les 3 semaines.</p>
              )}
              <div className="club-foot">
                <span>
                  <Clock size={13} /> {t.past ? `${t.onTime}/${t.past} à l’heure` : 'Pas encore de match'}
                </span>
                <span>
                  <Shield size={13} /> Équité {t.equity ?? '—'}
                </span>
                <span>
                  <Check size={13} /> {t.players} joueurs
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
