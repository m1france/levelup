import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EventForm, ScopeSheet, usePrepareSession, type EditScope } from '../components/Calendar';
import { Empty, Spinner, useAsync, useConfirm, useContextMenu, useToast } from '../components/ui';
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

/** Une carte de la page : un entraînement programmé (date d'une série ou non), sa séance préparée, ou les deux. */
interface Item {
  date: string;
  event?: TeamEvent;
  training?: Training;
}

const repeats = (it: Item) => !!it.event && it.event.recurrence.freq !== 'none';

/** Clic droit (ou appui long) sur une carte : « Modifier » et « Supprimer ». */
function CardMenu({ on, onEdit, onRemove, children }: { on: boolean; onEdit: () => void; onRemove: () => void; children: ReactNode }) {
  const { bind, menu } = useContextMenu();
  if (!on) return <>{children}</>;
  return (
    <div style={{ display: 'contents' }} {...bind}>
      {children}
      {menu((close) => (
        <>
          <button onClick={() => (close(), onEdit())}>
            <Pencil /> Modifier
          </button>
          <button onClick={() => (close(), onRemove())} style={{ color: 'var(--danger)' }}>
            <Trash2 /> Supprimer
          </button>
        </>
      ))}
    </div>
  );
}

/** Toutes les séances, semaine par semaine : on programme les entraînements et on retrouve les anciennes séances. */
export function SessionsPage() {
  const { team, can, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [plan, setPlan] = useState(false);
  const [ask, setAsk] = useState<{ item: Item; action: 'edit' | 'remove' } | null>(null);
  const [edit, setEdit] = useState<{ item: Item; scope: EditScope } | null>(null);
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
  const trainingEvents = useMemo(() => (q.data?.events ?? []).filter((e) => e.type === 'training'), [q.data?.events]);
  /** Toutes les séances rattachées à leur entraînement programmé (même jour). */
  const linked = useMemo(() => {
    if (!q.data) return [];
    const dates = [...q.data.trainings.map((t) => t.date.slice(0, 10)), ...trainingEvents.map((e) => e.start), today].sort();
    return agenda(trainingEvents, q.data.trainings, dates[0], dates[dates.length - 1]);
  }, [q.data, trainingEvents, today]);
  const itemOf = (t: Training): Item => linked.find((it) => it.training?.id === t.id) ?? { date: t.date.slice(0, 10), training: t };
  const canMenu = (it: Item) => isStaff && can(it.event ? 'events.manage' : 'trainings.manage');

  const onEdit = (it: Item) => {
    if (!it.event) return it.training && nav(`/seances/${it.training.id}`);
    if (repeats(it)) setAsk({ item: it, action: 'edit' });
    else setEdit({ item: it, scope: 'all' });
  };
  const onRemove = async (it: Item, scope?: EditScope) => {
    if (repeats(it) && !scope) return setAsk({ item: it, action: 'remove' });
    try {
      if (it.event && repeats(it) && scope === 'one') {
        await api.put(`/events/${it.event.id}`, { ...it.event, exdates: [...it.event.exdates, it.date] });
        if (it.training) await api.del(`/trainings/${it.training.id}`);
      } else if (it.event) {
        // Toute la série : ses séances préparées partent avec elle.
        const sessions = linked.filter((l) => l.event?.id === it.event!.id && l.training).map((l) => l.training!);
        const ok = await confirm({
          title: repeats(it) ? 'Supprimer toute la série ?' : 'Supprimer cet entraînement ?',
          text: sessions.length ? `${sessions.length > 1 ? `Les ${sessions.length} séances préparées seront` : 'La séance préparée sera'} également supprimée${sessions.length > 1 ? 's' : ''}.` : undefined,
          confirm: repeats(it) ? 'Supprimer la série' : 'Supprimer',
          danger: true,
        });
        if (!ok) return;
        await api.del(`/events/${it.event.id}`);
        for (const t of sessions) await api.del(`/trainings/${t.id}`);
      } else if (it.training) {
        if (!(await confirm({ title: 'Supprimer cette séance ?', confirm: 'Supprimer', danger: true }))) return;
        await api.del(`/trainings/${it.training.id}`);
      }
      toast('Supprimé');
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const card = (it: Item, node: ReactNode) => (
    <CardMenu on={canMenu(it)} onEdit={() => onEdit(it)} onRemove={() => void onRemove(it)}>
      {node}
    </CardMenu>
  );
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
                        {list.map((it) => (
                          <Fragment key={it.key}>
                            {card(
                              it,
                              it.training ? (
                                <SessionCard t={it.training} past={d < today} onClick={() => nav(`/seances/${it.training!.id}`)} />
                              ) : (
                                <PlannedCard it={it} meta={false} canPrepare={canPlan && d >= today} onPrepare={() => void prepare(it)} />
                              ),
                            )}
                          </Fragment>
                        ))}
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
              <MonthAccordion list={past} onOpen={(t) => nav(`/seances/${t.id}`)} wrap={(t, node) => card(itemOf(t), node)} />
            </section>
          )}
        </>
      )}
      {ask && (
        <ScopeSheet
          title={ask.action === 'edit' ? 'Modifier l’entraînement' : 'Supprimer l’entraînement'}
          danger={ask.action === 'remove'}
          onClose={() => setAsk(null)}
          onPick={(scope) => {
            const { item, action } = ask;
            setAsk(null);
            if (action === 'edit') setEdit({ item, scope });
            else void onRemove(item, scope);
          }}
        />
      )}
      {edit && edit.item.event && (
        <EventForm
          teamId={team.id}
          date={edit.item.date}
          event={edit.item.event}
          occurrence={edit.item.date}
          scope={edit.scope}
          onClose={() => setEdit(null)}
          onSaved={async (saved) => {
            const { item, scope } = edit;
            setEdit(null);
            // La séance préparée suit sa date quand on déplace cet entraînement seul.
            const t = item.training;
            const moved = saved && (scope === 'one' || !repeats(item)) && t && saved.start !== item.date;
            if (moved) {
              try {
                await api.put(`/trainings/${t.id}`, { ...t, date: `${saved.start}T${saved.time || t.date.slice(11, 16) || '14:00'}` });
              } catch (e) {
                toast((e as Error).message, true);
              }
            }
            q.reload();
          }}
        />
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
