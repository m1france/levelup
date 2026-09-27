import { CalendarPlus, ChevronRight, Megaphone, Plus, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PushCard } from '../components/Notifications';
import { MatchTicket } from '../components/Tickets';
import { Empty, Seg, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { TeamBadge } from '../components/Layout';
import { api } from '../lib/api';
import { PHASE, countdown, matchPath, momentLabel } from '../lib/convocations';
import { EventForm } from '../components/Calendar';
import { MatchActions, useMatchMenu, type MatchRef } from '../components/MatchActions';
import { MONTHS_TILE, formatTime, fromYMD, toYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { playerName, useApp } from '../lib/store';
import type { ConvSnapshot, TeamEvent, TeamStats, Ticket } from '../lib/types';
import { Gauge } from './Convocation';
import { MatchShowcase } from '../components/MatchShowcase';
import { WeekTimeline } from '../components/WeekTimeline';
import { groupsOf } from '../lib/groups';

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
  // Un match par diapositive, même si plusieurs enfants y sont attendus.
  const showcase = [...new Map(upcoming.map((t) => [`${t.eventId}:${t.date}`, t])).values()].slice(0, 5);
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Matchs</h1>
      </div>
      <MatchShowcase matches={showcase} />
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

type Tab = 'matchs' | 'equite';

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

function StaffMatches() {
  const { team, can } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { groups, group, setGroup } = useGroup();
  const tabs: { value: Tab; label: string }[] = [
    { value: 'matchs', label: 'Convocations' },
    { value: 'equite', label: 'Temps de jeu' },
  ];
  const tab = tabs.find((t) => t.value === params.get('vue'))?.value ?? 'matchs';
  const canEdit = can('events.manage');
  // Formulaire ouvert : nouveau match, ou match existant (clic droit › Modifier).
  const [form, setForm] = useState<{ event?: TeamEvent; date: string } | null>(null);
  // Recharge les listes après une création, une modification ou une suppression.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const eventOf = async (m: MatchRef) => {
    const list = await api.get<TeamEvent[]>(`/teams/${team!.id}/events`);
    const e = list.find((x) => x.id === m.eventId);
    if (!e) throw new Error('Match introuvable');
    return e;
  };
  const actions = {
    edit: async (m: MatchRef) => {
      try {
        setForm({ event: await eventOf(m), date: m.date });
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    remove: async (m: MatchRef) => {
      try {
        const e = await eventOf(m);
        if (e.recurrence.freq !== 'none') {
          const onlyThis = await confirm({ title: 'Match récurrent', text: 'Supprimer uniquement cette date, ou toute la série ?', confirm: 'Cette date seulement' });
          if (onlyThis) await api.put(`/events/${e.id}`, { ...e, exdates: [...e.exdates, m.date] });
          else if (await confirm({ title: 'Supprimer toute la série ?', confirm: 'Supprimer la série', danger: true })) await api.del(`/events/${e.id}`);
          else return;
        } else {
          if (!(await confirm({ title: 'Supprimer ce match ?', text: 'La convocation et les réponses des parents seront effacées.', confirm: 'Supprimer', danger: true }))) return;
          await api.del(`/events/${e.id}`);
        }
        toast('Match supprimé');
        refresh();
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
  };

  return (
    <MatchActions.Provider value={canEdit && team ? actions : null}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Matchs</h1>
            <div className="sub">{groups.length ? `${team?.category} · matchs, convocations et statistiques séparés par catégorie` : team?.category}</div>
          </div>
          <div className="actions">
            {groups.length > 0 && <Seg value={group!} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />}
            <Seg
              value={tab}
              onChange={(v) => setParams(() => {
                const n = new URLSearchParams();
                if (v !== 'matchs') n.set('vue', v);
                if (group) n.set('cat', group);
                return n;
              })}
              options={tabs}
            />
            {canEdit && team && (
              <button className="btn primary" onClick={() => setForm({ date: toYMD(new Date()) })}>
                <Plus /> Nouveau match
              </button>
            )}
          </div>
        </div>
        {tab === 'matchs' && <ConvList key={`${group ?? ''}:${version}`} group={group} />}
        {tab === 'equite' && <Equity key={`${group ?? ''}:${version}`} group={group} />}
      </div>
      {form && team && (
        <EventForm
          teamId={team.id}
          date={form.date}
          event={form.event}
          occurrence={form.event ? form.date : undefined}
          initialType="match"
          initialGroup={group}
          onClose={() => setForm(null)}
          onSaved={() => (setForm(null), refresh())}
        />
      )}
    </MatchActions.Provider>
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
    </>
  );
}

function ConvList({ group }: { group: string | null }) {
  const { team } = useApp();
  const q = useAsync(() => (team ? api.get<ConvSnapshot[]>(withGroup(`/teams/${team.id}/convocations`, group)) : Promise.resolve([])), [team?.id, group]);
  // La frise remonte au début de la saison pour retrouver le dernier match joué.
  const season = useAsync(() => (team ? api.get<ConvSnapshot[]>(withGroup(`/teams/${team.id}/convocations?past=1`, group)) : Promise.resolve([])), [team?.id, group]);
  useLive((m) => m.t === 'conv' && (q.reload(), season.reload()));
  const now = Date.now();
  const list = q.data ?? [];
  const todo = list.filter((c) => c.timeline.start > now && ['collecting', 'late', 'upcoming'].includes(c.phase));
  const ready = list.filter((c) => c.timeline.start > now && c.phase === 'published');
  const past = list.filter((c) => c.timeline.start <= now || c.phase === 'played').reverse();
  const coming = list.filter((c) => c.timeline.start > now && c.phase !== 'played').slice(0, 5);
  if (q.loading && !q.data) return <Spinner fill />;
  if (!list.length)
    return (
      <div className="card">
        <Empty
          icon={<Megaphone />}
          title={group ? `Aucun match ${group} programmé` : 'Aucun match programmé'}
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
      <MatchShowcase matches={coming} />
      <WeekTimeline list={season.data ?? list} />
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
