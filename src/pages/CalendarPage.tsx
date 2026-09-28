import { ArrowLeft, CalendarPlus, Pencil, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from '../components/Calendar';
import { Empty, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { EVENT_TYPES, eventTitle, formatTime, fromYMD, MONTHS_TILE, occurrences, toYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { relative, useApp } from '../lib/store';
import type { TeamEvent, Training } from '../lib/types';

const WD = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const REPEAT: Record<string, string> = { daily: 'Tous les jours', weekly: 'Chaque semaine', monthly: 'Chaque mois' };
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « Chaque mercredi et vendredi », « Toutes les 2 semaines », « Tous les jours »… */
function repeatLabel(e: TeamEvent) {
  const r = e.recurrence;
  if (r.freq === 'none') return null;
  if (r.freq === 'weekly' && r.interval === 1 && r.days.length) {
    const days = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]);
    return `Chaque ${days.length > 1 ? `${days.slice(0, -1).join(', ')} et ${days[days.length - 1]}` : days[0]}`;
  }
  if (r.interval > 1) return `Toutes les ${r.interval} ${r.freq === 'daily' ? 'jours' : r.freq === 'weekly' ? 'semaines' : 'mois'}`;
  return REPEAT[r.freq];
}

/** Calendrier en grand : le mois à gauche, les nouveautés (événements ajoutés ou modifiés) à droite. */
export function CalendarPage() {
  const { team, can, isStaff } = useApp();
  const q = useAsync(async () => {
    if (!team) return null;
    const [events, trainings] = await Promise.all([api.get<TeamEvent[]>(`/teams/${team.id}/events`), api.get<Training[]>(`/teams/${team.id}/trainings`)]);
    return { events, trainings };
  }, [team?.id]);
  useLive((m) => {
    if ((m.t === 'training' && m.teamId === team?.id) || m.t === 'conv') q.reload();
  });
  const [jump, setJump] = useState<{ date: string; n: number } | null>(null);

  // Fil : les événements les plus récemment ajoutés ou modifiés, avec leur prochaine date.
  const feed = useMemo(() => {
    const today = toYMD(new Date());
    const far = toYMD(new Date(Date.now() + 365 * 864e5));
    return (q.data?.events ?? [])
      .map((e) => {
        const next = occurrences(e, today, far)[0] ?? null;
        const created = e.createdAt ?? e.updatedAt ?? 0;
        const updated = e.updatedAt ?? created;
        return { e, next, at: Math.max(created, updated), edited: updated - created > 60_000 };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 30);
  }, [q.data?.events]);
  // « Ajouté / modifié · il y a… » n'a de sens que dans les 2 heures qui suivent.
  const fresh = Date.now() - 2 * 3600e3;

  if (!team) return <div className="page"><Empty title="Aucune équipe" /></div>;
  return (
    <div className="page wide cal-page">
      <Link to="/" className="back">
        <ArrowLeft size={15} /> Séances
      </Link>
      <div className="page-head">
        <div>
          <h1>Calendrier</h1>
          <div className="sub">{team.category} · entraînements, matchs et événements</div>
        </div>
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : q.data ? (
        <div className="cal-layout">
          <section className="cal-main card pad">
            <Calendar big teamId={team.id} events={q.data.events} trainings={q.data.trainings} canEdit={isStaff && can('events.manage')} onChanged={q.reload} jump={jump} />
          </section>
          <aside className="cal-feed">
            <h2>
              <Sparkles size={17} /> Nouveautés
            </h2>
            {!feed.length && <p className="muted small">Aucun événement pour l’instant.</p>}
            <ol>
              {feed.map(({ e, next, at, edited }) => {
                const color = e.color || EVENT_TYPES[e.type].color;
                const d = next ? fromYMD(next) : fromYMD(e.start);
                const repeat = repeatLabel(e);
                return (
                  <li key={e.id}>
                    <button onClick={() => setJump({ date: next ?? e.start, n: Date.now() })} disabled={!next && e.start < toYMD(new Date()) && !repeat}>
                      <span className="cf-date" style={{ ['--c' as string]: color }}>
                        <small>{WD[d.getDay()]}</small>
                        <b>{d.getDate()}</b>
                        <small>{MONTHS_TILE[d.getMonth()]}</small>
                      </span>
                      <span className="grow">
                        <span className="cf-kind" style={{ color }}>
                          {at > fresh ? (
                            <>
                              {edited ? <Pencil size={11} /> : <CalendarPlus size={11} />} {EVENT_TYPES[e.type].label} {edited ? 'modifié' : 'ajouté'} · {relative(at)}
                            </>
                          ) : (
                            EVENT_TYPES[e.type].label
                          )}
                        </span>
                        <b className="ellipsis">{e.group ? `${e.group} · ` : ''}{eventTitle(e)}</b>
                        <small className="ellipsis">
                          {repeat ?? (next ? 'À venir' : 'Passé')}
                          {e.time && !e.allDay ? ` · ${formatTime(e.time)}` : ''}
                          {e.location ? ` · ${e.location}` : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      ) : (
        <Empty title="Calendrier indisponible" text={q.error ?? undefined} />
      )}
    </div>
  );
}
