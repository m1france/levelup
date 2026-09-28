import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EventForm, usePrepareSession } from '../components/Calendar';
import { Empty, Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import { MONTHS_TILE, agenda, fromYMD, toYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { todayISO, useApp } from '../lib/store';
import type { TeamEvent, Training } from '../lib/types';
import { MonthAccordion, PlannedCard, SessionCard } from './Dashboard';
import { createTraining } from './Trainings';

const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Lundi de la semaine d'une date (AAAA-MM-JJ). */
function mondayOf(ymd: string) {
  const d = fromYMD(ymd);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toYMD(d);
}
function addDays(ymd: string, n: number) {
  const d = fromYMD(ymd);
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

/** Toutes les séances, semaine par semaine : on programme les entraînements et on retrouve les anciennes séances. */
export function SessionsPage() {
  const { team, can, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [plan, setPlan] = useState(false);
  const q = useAsync(async () => {
    if (!team) return null;
    const [trainings, events] = await Promise.all([api.get<Training[]>(`/teams/${team.id}/trainings`), api.get<TeamEvent[]>(`/teams/${team.id}/events`)]);
    return { trainings, events };
  }, [team?.id]);
  useLive((m) => {
    if ((m.t === 'training' || m.t === 'exercise') && m.teamId === team?.id) q.reload();
  });
  const prepare = usePrepareSession(team?.id ?? '');

  const today = todayISO();
  const [start, setStart] = useState(() => mondayOf(today));
  const end = addDays(start, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const items = useMemo(
    () => (q.data ? agenda(q.data.events.filter((e) => e.type === 'training'), q.data.trainings, start, end) : []),
    [q.data, start, end],
  );
  const past = useMemo(() => (q.data?.trainings ?? []).filter((t) => t.date.slice(0, 10) < today), [q.data?.trainings, today]);
  const lastPast = useMemo(() => [...past].sort((a, b) => b.date.localeCompare(a.date))[0], [past]);

  const canPlan = isStaff && can('trainings.manage');
  const current = start === mondayOf(today);
  const first = fromYMD(start);
  const last = fromYMD(end);
  const month = (d: Date) => MONTHS_TILE[d.getMonth()].toLowerCase();

  const newTraining = async () => {
    if (!team) return;
    try {
      nav(`/seances/${(await createTraining(team.id)).id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (!team) return <div className="page"><Empty title="Aucune équipe" /></div>;
  return (
    <div className="page wide sessions-page">
      <Link to="/" className="back">
        <ArrowLeft size={15} /> Accueil
      </Link>
      <div className="page-head">
        <div>
          <h1>Séances</h1>
          <div className="sub">{team.category} · semaine par semaine</div>
        </div>
        <div className="actions">
          {isStaff && can('events.manage') && (
            <button className="btn" onClick={() => setPlan(true)} title="Programmer des entraînements réguliers (ex. chaque mercredi et vendredi)">
              <Repeat /> Programmer
            </button>
          )}
          {canPlan && (
            <button className="btn lime" onClick={newTraining}>
              <Plus /> Nouvelle séance
            </button>
          )}
        </div>
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : (
        <>
          <section className="wk ss-week">
            <div className="wk-head">
              <h2>
                {current ? 'Cette semaine' : `Semaine du ${first.getDate()}${first.getMonth() !== last.getMonth() ? ` ${month(first)}` : ''} au ${last.getDate()} ${month(last)}`}
              </h2>
              <div className="row" style={{ gap: 4 }}>
                {lastPast && !(lastPast.date.slice(0, 10) >= start && lastPast.date.slice(0, 10) <= end) && (
                  <button className="plain-toggle" onClick={() => setStart(mondayOf(lastPast.date.slice(0, 10)))}>
                    Dernière séance
                  </button>
                )}
                {!current && (
                  <button className="plain-toggle" onClick={() => setStart(mondayOf(today))}>
                    Revenir à aujourd’hui
                  </button>
                )}
              </div>
            </div>
            <div className="wk-body">
              <button className="wk-side left" onClick={() => setStart(addDays(start, -7))} aria-label="Semaine précédente">
                <ChevronLeft size={16} />
                <span>Semaine précédente</span>
              </button>
              <div className="wk-days">
                {days.map((d, i) => {
                  const list = items.filter((it) => it.date === d);
                  return (
                    <div key={d} className={`wk-day${d === today ? ' today' : ''}${d < today ? ' gone' : ''}${list.length ? '' : ' empty'}`}>
                      <div className="wk-dlabel">
                        <small>{WD[i]}</small>
                        <b>{fromYMD(d).getDate()}</b>
                      </div>
                      <div className="wk-cards">
                        {list.map((it) =>
                          it.training ? (
                            <SessionCard key={it.key} t={it.training} past={d < today} onClick={() => nav(`/seances/${it.training!.id}`)} />
                          ) : (
                            <PlannedCard key={it.key} it={it} canPrepare={canPlan && d >= today} onPrepare={() => void prepare(it)} />
                          ),
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button className="wk-side right" onClick={() => setStart(addDays(start, 7))} aria-label="Semaine suivante">
                <span>Semaine suivante</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </section>

          {past.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>Anciennes séances</h2>
              </div>
              <MonthAccordion list={past} onOpen={(t) => nav(`/seances/${t.id}`)} />
            </section>
          )}
        </>
      )}
      {plan && (
        <EventForm
          teamId={team.id}
          date={today}
          initialType="training"
          initialWeekly
          onClose={() => setPlan(false)}
          onSaved={() => {
            setPlan(false);
            q.reload();
          }}
        />
      )}
    </div>
  );
}
