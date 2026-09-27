import { AlarmClock, BellRing, Minus, Plus, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, hourLabel, timelineOf } from '../lib/convocations';
import { fromYMD, toYMD } from '../lib/events';
import type { ConvSettings, When } from '../lib/types';
import { Field } from './ui';

const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Prochain samedi (date d'exemple pour l'aperçu). */
export function sampleDate() {
  const d = new Date();
  d.setDate(d.getDate() + (((6 - d.getDay() + 7) % 7) || 7));
  return toYMD(d);
}

function Stepper({ value, min, max, onChange, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Moins">
        <Minus />
      </button>
      <b>
        {value}
        {suffix && <small>{suffix}</small>}
      </b>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Plus">
        <Plus />
      </button>
    </span>
  );
}

/** « J-5 à 18:00 », phrase éditable. */
function WhenRow({ icon, label, value, onChange, toggle, children }: { icon: ReactNode; label: string; value: { days: number; time: string; on?: boolean }; onChange: (v: When) => void; toggle?: boolean; children?: ReactNode }) {
  const on = value.on !== false;
  return (
    <div className={`when-row${on ? '' : ' off'}`}>
      <span className="when-ic">{icon}</span>
      <div className="grow">
        <div className="row between wrap" style={{ gap: 8 }}>
          <b>{label}</b>
          {toggle && (
            <label className="switch">
              <input type="checkbox" checked={on} onChange={(e) => onChange({ ...value, on: e.target.checked } as When)} />
              <i />
            </label>
          )}
        </div>
        {on && (
          <div className="when-edit">
            <Stepper value={value.days} min={0} max={30} onChange={(days) => onChange({ ...value, on, days } as When)} suffix=" j avant" />
            <span className="muted small">à</span>
            <input className="input time" type="time" value={value.time} onChange={(e) => e.target.value && onChange({ ...value, on, time: e.target.value } as When)} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Frise de la semaine du match : où tombe chaque étape. */
export function TimelinePreview({ settings, date, time }: { settings: ConvSettings; date: string; time: string }) {
  const t = useMemo(() => timelineOf({ allDay: false, time: time || '10:00' }, date, settings), [settings, date, time]);
  const marks = [
    t.request && { at: t.request, label: 'Dispos demandées', tone: 'blue' },
    ...t.reminders.map((r) => ({ at: r, label: 'Relance', tone: 'blue' })),
    t.answerBy && { at: t.answerBy, label: 'Réponse parents', tone: 'blue' },
    t.coachAlert < t.deadline && { at: t.coachAlert, label: 'Alerte éducateur', tone: 'warn' },
    { at: t.deadline, label: 'Convocation publiée', tone: 'green' },
    t.eve && t.eve < t.start && { at: t.eve, label: 'Rappel veille', tone: 'green' },
    { at: t.start, label: 'Match', tone: 'ink' },
  ].filter(Boolean) as { at: number; label: string; tone: string }[];
  marks.sort((a, b) => a.at - b.at);
  const first = Math.min(...marks.map((m) => m.at));
  const startDay = fromYMD(toYMD(new Date(first)));
  startDay.setHours(0, 0, 0, 0);
  const endDay = fromYMD(date);
  endDay.setHours(24, 0, 0, 0);
  const span = endDay.getTime() - startDay.getTime();
  const days = Math.round(span / 864e5);
  const pos = (ts: number) => ((ts - startDay.getTime()) / span) * 100;
  return (
    <div className="tl-preview">
      <div className="tl-days" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(startDay.getTime() + i * 864e5 + 12 * 3600e3);
          return (
            <span key={i} className={i === days - 1 ? 'is-match' : ''}>
              {WD[d.getDay()]}
            </span>
          );
        })}
      </div>
      <div className="tl-track">
        {marks.map((m, i) => (
          <i key={i} className={`tl-dot ${m.tone}`} style={{ left: `${pos(m.at)}%` }} title={m.label} />
        ))}
      </div>
      <ul className="tl-legend">
        {marks.map((m, i) => {
          const d = new Date(m.at);
          return (
            <li key={i}>
              <i className={`tl-dot ${m.tone}`} />
              <span>{m.label}</span>
              <b>
                {WD[d.getDay()]} {hourLabel(d)}
              </b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Éditeur des réglages d'une convocation (réglage prédéfini ou personnalisé pour un match). */
export function ConvSettingsEditor({ value, onChange, date, time }: { value: ConvSettings; onChange: (s: ConvSettings) => void; date?: string; time?: string }) {
  const s = value;
  const set = (patch: Partial<ConvSettings>) => onChange({ ...s, ...patch });
  return (
    <div className="stack" style={{ gap: 18 }}>
      <TimelinePreview settings={s} date={date || sampleDate()} time={time || '10:00'} />

      <div className="when-list">
        <WhenRow icon={<Send />} label="Demander les disponibilités aux parents" value={s.request} toggle onChange={(request) => set({ request })} />
        <div className={`when-row${s.reminders.length ? '' : ' off'}`}>
          <span className="when-ic">
            <BellRing />
          </span>
          <div className="grow">
            <div className="row between wrap" style={{ gap: 8 }}>
              <b>Relancer ceux qui n’ont pas répondu</b>
              {s.reminders.length < 4 && (
                <button type="button" className="btn sm ghost" onClick={() => set({ reminders: [...s.reminders, { days: Math.max(0, (s.reminders.at(-1)?.days ?? s.request.days) - 1), time: '19:00' }] })}>
                  <Plus /> Relance
                </button>
              )}
            </div>
            {s.reminders.map((r, i) => (
              <div key={i} className="when-edit">
                <Stepper value={r.days} min={0} max={30} onChange={(days) => set({ reminders: s.reminders.map((x, j) => (j === i ? { ...x, days } : x)) })} suffix=" j avant" />
                <span className="muted small">à</span>
                <input className="input time" type="time" value={r.time} onChange={(e) => e.target.value && set({ reminders: s.reminders.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} />
                <button type="button" className="btn icon sm ghost" onClick={() => set({ reminders: s.reminders.filter((_, j) => j !== i) })} aria-label="Retirer la relance">
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </div>
        <WhenRow icon={<AlarmClock />} label="Réponse des parents souhaitée avant" value={s.answerBy} toggle onChange={(answerBy) => set({ answerBy })} />
        <WhenRow icon={<ShieldAlert />} label="Convocation publiée au plus tard" value={s.deadline} onChange={({ days, time }) => set({ deadline: { days, time } })}>
          <p className="small muted" style={{ marginTop: 6 }}>
            C’est la promesse faite aux parents : elle apparaît sur leur billet de match.
          </p>
          <div className="when-edit">
            <span className="small">Alerter l’éducateur</span>
            <Stepper value={s.coachAlert} min={0} max={96} onChange={(coachAlert) => set({ coachAlert })} suffix=" h avant" />
          </div>
          <label className="check small" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={s.escalate} onChange={(e) => set({ escalate: e.target.checked })} />
            <span>Prévenir les responsables du club si la date est dépassée</span>
          </label>
        </WhenRow>
        <WhenRow icon={<BellRing />} label="Rappel aux convoqués la veille" value={{ ...s.eve, days: s.eve.days || 1 }} toggle onChange={(eve) => set({ eve })} />
      </div>

      <div className="grid cols-2" style={{ gap: 14 }}>
        <Field label="Joueurs convoqués">
          <Stepper value={s.squad} min={1} max={30} onChange={(squad) => set({ squad })} />
        </Field>
        <Field label="Joueurs sur le terrain">
          <Stepper value={s.onField} min={1} max={11} onChange={(onField) => set({ onField })} />
        </Field>
        <Field label="Périodes">
          <Stepper value={s.periods} min={1} max={6} onChange={(periods) => set({ periods })} />
        </Field>
        <Field label="Durée d’une période">
          <Stepper value={s.periodMinutes} min={1} max={60} onChange={(periodMinutes) => set({ periodMinutes })} suffix=" min" />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.stats} onChange={(e) => set({ stats: e.target.checked })} />
        <span>Buts et passes décisives individuels <span className="muted small">(à désactiver pour les plus jeunes)</span></span>
      </label>
      <Field label="À prévoir" hint="affiché sur la convocation">
        <input className="input" value={s.bring} onChange={(e) => set({ bring: e.target.value })} placeholder={DEFAULT_SETTINGS.bring} />
      </Field>
    </div>
  );
}
