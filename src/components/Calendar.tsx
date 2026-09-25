import { ChevronLeft, ChevronRight, Clock, MapPin, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uid } from '../lib/api';
import {
  EVENT_TYPES, MONTHS_LONG, WEEKDAYS_SHORT, agenda, eventTitle, formatTime, fromYMD, toYMD, type Agenda,
} from '../lib/events';
import type { EventType, Recurrence, TeamEvent, Training } from '../lib/types';
import { createTraining } from '../pages/Trainings';
import { Field, Seg, Sheet, useConfirm, useToast } from './ui';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayTitle = (ymd: string) => {
  const d = fromYMD(ymd);
  return `${['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
};

/** Calendrier mensuel minimaliste : points de couleur par événement, un jour = un clic. */
export function Calendar({
  teamId, events, trainings, canEdit, onChanged,
}: { teamId: string; events: TeamEvent[]; trainings: Training[]; canEdit: boolean; onChanged: () => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1, 12);
  });
  const [day, setDay] = useState<string | null>(null);
  const today = toYMD(new Date());

  const cells = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset, 12);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const count = Math.ceil((offset + daysInMonth) / 7) * 7;
    return Array.from({ length: count }, (_, i) => toYMD(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)));
  }, [month]);

  const items = useMemo(() => agenda(events, trainings, cells[0], cells[cells.length - 1]), [events, trainings, cells]);
  const byDay = useMemo(() => {
    const m = new Map<string, Agenda[]>();
    for (const it of items) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return m;
  }, [items]);

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  const monthIdx = month.getMonth();

  return (
    <div className="cal">
      <div className="cal-head">
        <h2>
          {cap(MONTHS_LONG[monthIdx])} <span className="muted">{month.getFullYear()}</span>
        </h2>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn sm ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12))}>
            Aujourd’hui
          </button>
          <button className="btn icon sm ghost" onClick={() => shift(-1)} aria-label="Mois précédent">
            <ChevronLeft />
          </button>
          <button className="btn icon sm ghost" onClick={() => shift(1)} aria-label="Mois suivant">
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <span key={d} className="cal-dow">
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const list = byDay.get(d) ?? [];
          const date = fromYMD(d);
          return (
            <button
              key={d}
              className={`cal-day${date.getMonth() !== monthIdx ? ' out' : ''}${d === today ? ' today' : ''}${d === day ? ' sel' : ''}`}
              onClick={() => setDay(d)}
              aria-label={`${dayTitle(d)}${list.length ? `, ${list.length} événement${list.length > 1 ? 's' : ''}` : ''}`}
            >
              <span className="n">{date.getDate()}</span>
              <span className="cal-dots">
                {list.slice(0, 3).map((it) => (
                  <i key={it.key} style={{ background: it.color }} />
                ))}
              </span>
              {list[0] && <span className="cal-label">{list[0].title}</span>}
            </button>
          );
        })}
      </div>
      {day && <DaySheet teamId={teamId} date={day} items={byDay.get(day) ?? []} canEdit={canEdit} onClose={() => setDay(null)} onChanged={onChanged} />}
    </div>
  );
}

function DaySheet({
  teamId, date, items, canEdit, onClose, onChanged,
}: { teamId: string; date: string; items: Agenda[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  const [edit, setEdit] = useState<{ event?: TeamEvent; occurrence?: string } | null>(items.length || !canEdit ? null : {});
  if (edit)
    return (
      <EventForm
        teamId={teamId}
        date={date}
        event={edit.event}
        occurrence={edit.occurrence}
        onClose={() => (items.length ? setEdit(null) : onClose())}
        onSaved={() => {
          onChanged();
          onClose();
        }}
      />
    );
  return (
    <Sheet title={dayTitle(date)} onClose={onClose}>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((it) => (
          <button
            key={it.key}
            className="agenda-row"
            onClick={() => (it.training ? nav(`/seances/${it.training.id}`) : canEdit && setEdit({ event: it.event, occurrence: it.date }))}
          >
            <i style={{ background: it.color }} />
            <span className="grow">
              <b>{it.title}</b>
              <small>
                {it.time ? formatTime(it.time) : 'Journée'}
                {it.event?.endTime && !it.event.allDay ? ` – ${formatTime(it.event.endTime)}` : ''}
                {it.event?.meetTime ? ` · RDV ${formatTime(it.event.meetTime)}` : ''}
                {it.event?.location ? ` · ${it.event.location}` : ''}
                {it.training ? ' · Séance préparée' : ''}
              </small>
            </span>
            {it.event && it.event.recurrence.freq !== 'none' && <Repeat size={15} color="var(--ink-3)" />}
          </button>
        ))}
        {!items.length && <p className="muted" style={{ padding: '8px 0' }}>Rien de prévu ce jour-là.</p>}
        {canEdit && (
          <button className="btn full" onClick={() => setEdit({})}>
            <Plus /> Ajouter un événement
          </button>
        )}
      </div>
    </Sheet>
  );
}

type RepeatPreset = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
const presetOf = (r: Recurrence): RepeatPreset => {
  if (r.freq === 'none') return 'none';
  if (r.freq === 'daily' && r.interval === 1) return 'daily';
  if (r.freq === 'weekly' && r.interval === 1) return 'weekly';
  if (r.freq === 'weekly' && r.interval === 2) return 'biweekly';
  if (r.freq === 'monthly' && r.interval === 1) return 'monthly';
  return 'custom';
};

const SWATCHES = ['#3f8f63', '#e03131', '#f08c00', '#7048e8', '#1c7ed6', '#d6336c', '#0ca678', '#868e96'];

function EventForm({
  teamId, date, event, occurrence, onClose, onSaved,
}: { teamId: string; date: string; event?: TeamEvent; occurrence?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const weekday = fromYMD(date).getDay();
  const [e, setE] = useState<Omit<TeamEvent, 'id' | 'teamId'>>(
    event ?? {
      type: 'training', title: '', start: date, allDay: false, time: '14:00', endTime: '15:30', meetTime: '', location: '',
      opponent: '', venue: '', notes: '', color: '', parents: true, exdates: [],
      recurrence: { freq: 'none', interval: 1, days: [weekday], until: null, count: null },
    },
  );
  const [ends, setEnds] = useState<'never' | 'until' | 'count'>(event?.recurrence.until ? 'until' : event?.recurrence.count ? 'count' : 'never');
  const [prepare, setPrepare] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = e.recurrence;
  const preset = presetOf(r);
  const setR = (patch: Partial<Recurrence>) => setE({ ...e, recurrence: { ...r, ...patch } });

  const applyPreset = (p: RepeatPreset) => {
    const days = r.days.length ? r.days : [fromYMD(e.start).getDay()];
    if (p === 'none') setR({ freq: 'none', interval: 1 });
    if (p === 'daily') setR({ freq: 'daily', interval: 1 });
    if (p === 'weekly') setR({ freq: 'weekly', interval: 1, days });
    if (p === 'biweekly') setR({ freq: 'weekly', interval: 2, days });
    if (p === 'monthly') setR({ freq: 'monthly', interval: 1 });
    if (p === 'custom') setR({ freq: r.freq === 'none' ? 'weekly' : r.freq, interval: Math.max(2, r.interval), days });
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        ...e,
        teamId,
        recurrence: { ...r, until: ends === 'until' ? r.until : null, count: ends === 'count' ? r.count ?? 10 : null },
      };
      await api.put(`/events/${event?.id ?? uid()}`, body);
      if (prepare && !event) {
        const t = await createTraining(teamId, `${e.start}T${e.time || '14:00'}`, e.title || 'Entraînement');
        nav(`/seances/${t.id}`);
      }
      toast(event ? 'Événement modifié' : 'Événement ajouté');
      onSaved();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    if (event.recurrence.freq !== 'none' && occurrence) {
      const onlyThis = await confirm({ title: 'Événement récurrent', text: 'Supprimer uniquement cette date, ou toute la série ?', confirm: 'Cette date seulement' });
      if (onlyThis) {
        await api.put(`/events/${event.id}`, { ...event, exdates: [...event.exdates, occurrence] });
        onSaved();
        return;
      }
      if (!(await confirm({ title: 'Supprimer toute la série ?', confirm: 'Supprimer la série', danger: true }))) return;
    } else if (!(await confirm({ title: 'Supprimer cet événement ?', confirm: 'Supprimer', danger: true }))) return;
    await api.del(`/events/${event.id}`);
    onSaved();
  };

  const color = e.color || EVENT_TYPES[e.type].color;
  const isMatch = e.type === 'match' || e.type === 'plateau' || e.type === 'tournament';

  return (
    <Sheet
      title={event ? eventTitle(e) : 'Nouvel événement'}
      onClose={onClose}
      footer={
        <>
          {event && (
            <button className="btn ghost danger" onClick={remove} aria-label="Supprimer">
              <Trash2 />
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !e.start} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="chips">
          {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
            <button key={t} className={`chip${e.type === t ? ' on' : ''}`} onClick={() => setE({ ...e, type: t })}>
              <i style={{ width: 8, height: 8, borderRadius: 4, background: EVENT_TYPES[t].color }} /> {EVENT_TYPES[t].label}
            </button>
          ))}
        </div>

        <input
          className="input title"
          style={{ fontSize: 22, fontWeight: 650 }}
          placeholder={eventTitle({ ...e, title: '' })}
          value={e.title}
          onChange={(x) => setE({ ...e, title: x.target.value })}
        />

        {isMatch && (
          <div className="row wrap" style={{ gap: 10 }}>
            <Field label="Adversaire">
              <input className="input" value={e.opponent} placeholder="Ex. Teyran" onChange={(x) => setE({ ...e, opponent: x.target.value })} />
            </Field>
            <Field label="Lieu du match">
              <Seg<string>
                value={e.venue}
                onChange={(v) => setE({ ...e, venue: v as TeamEvent['venue'] })}
                options={[{ value: 'home', label: 'Domicile' }, { value: 'away', label: 'Extérieur' }, { value: 'neutral', label: 'Neutre' }]}
              />
            </Field>
          </div>
        )}

        <div className="ev-grid">
          <Field label="Date">
            <input className="input" type="date" value={e.start} onChange={(x) => x.target.value && setE({ ...e, start: x.target.value })} />
          </Field>
          {!e.allDay && (
            <>
              <Field label="Début">
                <input className="input" type="time" value={e.time} onChange={(x) => setE({ ...e, time: x.target.value })} />
              </Field>
              <Field label="Fin">
                <input className="input" type="time" value={e.endTime} onChange={(x) => setE({ ...e, endTime: x.target.value })} />
              </Field>
              <Field label="Convocation">
                <input className="input" type="time" value={e.meetTime} onChange={(x) => setE({ ...e, meetTime: x.target.value })} />
              </Field>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={e.allDay} onChange={(x) => setE({ ...e, allDay: x.target.checked })} />
          <span>Toute la journée</span>
        </label>

        <Field label="Lieu">
          <div style={{ position: 'relative' }}>
            <MapPin size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--ink-3)' }} />
            <input className="input" style={{ paddingLeft: 36 }} value={e.location} placeholder="Stade, gymnase, adresse…" onChange={(x) => setE({ ...e, location: x.target.value })} />
          </div>
        </Field>

        <Field label="Répétition">
          <select className="select" value={preset} onChange={(x) => applyPreset(x.target.value as RepeatPreset)}>
            <option value="none">Ne se répète pas</option>
            <option value="daily">Tous les jours</option>
            <option value="weekly">Toutes les semaines</option>
            <option value="biweekly">Toutes les 2 semaines</option>
            <option value="monthly">Tous les mois (le {fromYMD(e.start).getDate()})</option>
            <option value="custom">Personnalisé…</option>
          </select>
        </Field>

        {r.freq !== 'none' && (
          <div className="card pad stack" style={{ gap: 12, background: 'var(--surface-2)', border: 0, padding: 14 }}>
            {preset === 'custom' && (
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="small">Tous les</span>
                <input className="input" type="number" min={1} max={12} style={{ width: 70 }} value={r.interval} onChange={(x) => setR({ interval: Math.max(1, Number(x.target.value) || 1) })} />
                <select className="select" style={{ width: 140 }} value={r.freq} onChange={(x) => setR({ freq: x.target.value as Recurrence['freq'] })}>
                  <option value="daily">jours</option>
                  <option value="weekly">semaines</option>
                  <option value="monthly">mois</option>
                </select>
              </div>
            )}
            {r.freq === 'weekly' && (
              <div className="chips">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button
                    key={d}
                    className={`chip${r.days.includes(d) ? ' on' : ''}`}
                    onClick={() => setR({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                  >
                    {WEEKDAYS_SHORT[d]}
                  </button>
                ))}
              </div>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="small">Fin</span>
              <Seg<string>
                value={ends}
                onChange={(v) => setEnds(v as typeof ends)}
                options={[{ value: 'never', label: 'Jamais' }, { value: 'until', label: 'Le…' }, { value: 'count', label: 'Après…' }]}
              />
              {ends === 'until' && (
                <input className="input" type="date" style={{ width: 170 }} value={r.until ?? ''} min={e.start} onChange={(x) => setR({ until: x.target.value || null })} />
              )}
              {ends === 'count' && (
                <span className="row" style={{ gap: 6 }}>
                  <input className="input" type="number" min={1} max={200} style={{ width: 80 }} value={r.count ?? 10} onChange={(x) => setR({ count: Math.max(1, Number(x.target.value) || 1) })} />
                  <span className="small">fois</span>
                </span>
              )}
            </div>
          </div>
        )}

        <Field label="Couleur">
          <div className="row" style={{ gap: 8 }}>
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setE({ ...e, color: c === EVENT_TYPES[e.type].color ? '' : c })} aria-label={c} />
            ))}
          </div>
        </Field>

        <label className="check">
          <input type="checkbox" checked={e.parents} onChange={(x) => setE({ ...e, parents: x.target.checked })} />
          <span>
            <Users size={14} style={{ verticalAlign: -2 }} /> Visible par les parents
          </span>
        </label>

        {e.type === 'training' && !event && r.freq === 'none' && (
          <label className="check">
            <input type="checkbox" checked={prepare} onChange={(x) => setPrepare(x.target.checked)} />
            <span>
              <Clock size={14} style={{ verticalAlign: -2 }} /> Préparer la séance maintenant
            </span>
          </label>
        )}

        <Field label="Notes" hint="visibles des éducateurs uniquement">
          <textarea className="textarea" rows={2} value={e.notes ?? ''} onChange={(x) => setE({ ...e, notes: x.target.value })} placeholder="Matériel à prévoir, covoiturage, maillots…" />
        </Field>
      </div>
    </Sheet>
  );
}
