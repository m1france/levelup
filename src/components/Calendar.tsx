import { Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock, ImagePlus, MapPin, Maximize2, Megaphone, Pencil, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uid } from '../lib/api';
import {
  EVENT_TYPES, MONTHS_LONG, WEEKDAYS_SHORT, agenda, eventTitle, formatTime, fromYMD, playsPlateaux, toYMD, type Agenda,
} from '../lib/events';
import { CONV_TYPES, DEFAULT_SETTINGS, matchPath } from '../lib/convocations';
import type { ConvPreset, ConvSettings, EventType, Recurrence, TeamEvent, Training } from '../lib/types';
import { ConvSettingsEditor, TimelinePreview } from './ConvSettings';
import { createTraining } from '../pages/Trainings';
import { Field, Menu, Seg, Sheet, useConfirm, useToast } from './ui';
import { PlateauWizard } from './Plateau';
import { groupsOf } from '../lib/groups';
import { prepareLogo } from '../lib/images';
import { useApp } from '../lib/store';

/** L'événement a-t-il une convocation (matchs, plateaux, tournois par défaut) ? */
export const hasConv = (e: TeamEvent) => e.conv?.enabled ?? CONV_TYPES.includes(e.type);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayTitle = (ymd: string) => {
  const d = fromYMD(ymd);
  return `${['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
};

/** Calendrier mensuel minimaliste : points de couleur par événement, un jour = un clic. */
export function Calendar({
  teamId, events, trainings, canEdit, onChanged, big, onExpand, jump,
}: {
  teamId: string; events: TeamEvent[]; trainings: Training[]; canEdit: boolean; onChanged: () => void;
  /** Grand calendrier (page Calendrier) : plusieurs événements écrits dans chaque case. */
  big?: boolean;
  /** Petite icône pour ouvrir le calendrier en grand. */
  onExpand?: () => void;
  /** Ouvre un jour donné depuis l'extérieur (fil des nouveautés) ; `n` change à chaque demande. */
  jump?: { date: string; n: number } | null;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1, 12);
  });
  const [day, setDay] = useState<string | null>(null);
  const today = toYMD(new Date());
  useEffect(() => {
    if (!jump) return;
    const d = fromYMD(jump.date);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12));
    setDay(jump.date);
  }, [jump]);

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
    <div className={`cal${big ? ' big' : ''}`}>
      <div className="cal-head">
        <h2>
          {cap(MONTHS_LONG[monthIdx])} <span className="muted">{month.getFullYear()}</span>
          {onExpand && (
            <button className="cal-expand" onClick={onExpand} aria-label="Ouvrir le calendrier en grand" title="Ouvrir en grand">
              <Maximize2 size={14} />
            </button>
          )}
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
              {big ? (
                <span className="cal-pills">
                  {list.slice(0, 3).map((it) => (
                    <span key={it.key} className={`cal-pill${it.event?.type === 'training' && !it.training ? ' planned' : ''}`} style={{ ['--c' as string]: it.color }}>
                      <b>{it.title}</b>
                      {it.time && <small>{formatTime(it.time)}</small>}
                    </span>
                  ))}
                  {list.length > 3 && <small className="cal-more">+{list.length - 3}</small>}
                </span>
              ) : (
                <>
                  <span className="cal-dots">
                    {list.slice(0, 3).map((it) => (
                      <i key={it.key} style={{ background: it.color }} />
                    ))}
                  </span>
                  {list[0] && <span className="cal-label">{list[0].title}</span>}
                </>
              )}
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
  const { can, isStaff } = useApp();
  const prepare = usePrepareSession(teamId);
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
          <div key={it.key} className="row" style={{ gap: 6 }}>
          <button
            className="agenda-row"
            onClick={() =>
              it.training
                ? nav(`/seances/${it.training.id}`)
                : it.event && hasConv(it.event)
                  ? nav(matchPath(it.event.id, it.date))
                  : canEdit && setEdit({ event: it.event, occurrence: it.date })
            }
          >
            <i style={{ background: it.color }} />
            <span className="grow">
              <b>{it.title}</b>
              <small>
                {it.time ? formatTime(it.time) : 'Journée'}
                {it.event?.endTime && !it.event.allDay ? ` – ${formatTime(it.event.endTime)}` : ''}

                {it.training ? ' · Séance préparée' : it.event?.type === 'training' ? ' · Séance à préparer' : ''}
              </small>
            </span>
            {it.event && hasConv(it.event) && <Megaphone size={15} color="var(--accent)" />}
            {it.event && it.event.recurrence.freq !== 'none' && <Repeat size={15} color="var(--ink-3)" />}
          </button>
          {isStaff && can('trainings.manage') && it.event?.type === 'training' && !it.training && (
            <button className="btn sm" onClick={() => void prepare(it)}>
              <ClipboardList /> Préparer
            </button>
          )}
          {canEdit && it.event && (hasConv(it.event) || it.training) && (
            <button className="btn icon ghost" onClick={() => setEdit({ event: it.event, occurrence: it.date })} aria-label="Modifier l’événement">
              <Pencil />
            </button>
          )}
          </div>
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

 /** Crée la séance d'un entraînement programmé (même jour, même heure), puis l'ouvre. */
export function usePrepareSession(teamId: string) {
  const nav = useNavigate();
  const toast = useToast();
  return async (it: Pick<Agenda, 'date' | 'time' | 'event'>) => {
    try {
      const t = await createTraining(teamId, `${it.date}T${it.time || it.event?.time || '14:00'}`, it.event?.title || 'Entraînement');
      nav(`/seances/${t.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
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

/** Types proposés : jusqu'en U9, les matchs se jouent en plateau (le type « Match » disparaît). */
export function eventTypesFor(plateaux: boolean, current?: EventType) {
  return (Object.keys(EVENT_TYPES) as EventType[]).filter((t) => !(plateaux && t === 'match' && current !== 'match'));
}

/** Type d'événement, affiché en simple texte collé à droite du titre, avec une liste pour en changer. */
export function TypePicker({ value, types, onChange }: { value: EventType; types: EventType[]; onChange: (t: EventType) => void }) {
  return (
    <Menu
      trigger={(open) => (
        <button type="button" className="type-pick" onClick={open} aria-label={`Type : ${EVENT_TYPES[value].label}`}>
          <i style={{ background: EVENT_TYPES[value].color }} />
          {EVENT_TYPES[value].label}
          <ChevronDown size={15} />
        </button>
      )}
    >
      {(close) =>
        types.map((t) => (
          <button
            key={t}
            className={t === value ? 'on' : ''}
            onClick={() => {
              onChange(t);
              close();
            }}
          >
            <i className="type-dot" style={{ background: EVENT_TYPES[t].color }} />
            <span className="grow">{EVENT_TYPES[t].label}</span>
            {t === value && <Check size={15} color="var(--accent)" />}
          </button>
        ))
      }
    </Menu>
  );
}

/** Logo du club organisateur : choisi dans le formulaire, envoyé après l'enregistrement du match. */
export function useLogoPick() {
  const toast = useToast();
  const [logo, setLogo] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (file?: File) => {
    if (!file) return;
    try {
      setLogo(await prepareLogo(file));
    } catch {
      toast('Image illisible', true);
    }
    if (ref.current) ref.current.value = '';
  };
  const input = <input ref={ref} type="file" accept="image/*" hidden onChange={(x) => void pick(x.target.files?.[0])} />;
  return { logo, open: () => ref.current?.click(), input };
}

export function LogoField({ logo, saved, eventId, home, onPick }: { logo: string | null; saved?: number; eventId?: string; home: boolean; onPick: () => void }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <span className="ev-logo">{logo || saved ? <img src={logo ?? `/api/events/${eventId}/logo?v=${saved}`} alt="" /> : <ImagePlus size={20} />}</span>
      <button type="button" className="btn sm" onClick={onPick}>
        {logo || saved ? 'Changer le logo' : 'Ajouter le logo'}
      </button>
      {!logo && !saved && home && <small className="muted">Sinon, le logo de votre club</small>}
    </div>
  );
}

/** Réglages de convocation d'un événement (demandes de dispos, relances, publication). */
export function ConvBox({ teamId, e, setE }: { teamId: string; e: Omit<TeamEvent, 'id' | 'teamId'>; setE: (e: Omit<TeamEvent, 'id' | 'teamId'>) => void }) {
  const [presets, setPresets] = useState<ConvPreset[] | null>(null);
  useEffect(() => {
    api.get<{ presets: ConvPreset[] }>('/conv-presets').then((r) => setPresets(r.presets.filter((p) => !p.teamId || p.teamId === teamId))).catch(() => setPresets([]));
  }, [teamId]);
  const convOn = e.conv?.enabled ?? CONV_TYPES.includes(e.type);
  const teamDefault = presets?.find((p) => p.teamId === teamId && p.isDefault) ?? presets?.find((p) => !p.teamId && p.isDefault) ?? presets?.[0];
  const chosen = e.conv?.custom ? null : presets?.find((p) => p.id === e.conv?.presetId) ?? teamDefault;
  const convSettings: ConvSettings = e.conv?.custom ?? chosen?.settings ?? DEFAULT_SETTINGS;
  const setConv = (patch: TeamEvent['conv']) => setE({ ...e, conv: { ...e.conv, ...patch } });
  return (
    <div className="conv-box">
      <label className="check">
        <input type="checkbox" checked={convOn} onChange={(x) => setConv({ enabled: x.target.checked })} />
        <span>
          <Megaphone size={14} style={{ verticalAlign: -2 }} /> <b>Convocation</b> : demander les disponibilités, puis convoquer
        </span>
      </label>
      {convOn && (
        <>
          <Field label="Réglage">
            <select
              className="select"
              value={e.conv?.custom ? 'custom' : chosen?.id ?? ''}
              onChange={(x) => {
                const v = x.target.value;
                if (v === 'custom') setConv({ custom: { ...convSettings }, presetId: null });
                else setConv({ custom: null, presetId: v || null });
              }}
            >
              {!presets?.length && <option value="">Convocation par défaut</option>}
              {presets?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.teamId ? ' · équipe' : ''}
                </option>
              ))}
              <option value="custom">Personnalisé pour ce match…</option>
            </select>
          </Field>
          {e.conv?.custom ? (
            <ConvSettingsEditor value={e.conv.custom} onChange={(custom) => setConv({ custom })} date={e.start} time={e.time} />
          ) : (
            <TimelinePreview settings={convSettings} date={e.start} time={e.time} />
          )}
        </>
      )}
    </div>
  );
}

type Draft = Omit<TeamEvent, 'id' | 'teamId'>;

export interface EventFormProps {
  teamId: string; date: string; event?: TeamEvent; occurrence?: string;
  /** Nouvel événement : type et catégorie proposés (ex. « Nouveau match » depuis la page Matchs). */
  initialType?: EventType; initialGroup?: string | null;
  /** Nouvel événement répété chaque semaine (programmer les entraînements de la saison). */
  initialWeekly?: boolean;
  /** Événement récurrent : `one` ne modifie que l'occurrence `occurrence` (elle sort de la série). */
  scope?: EditScope;
  onClose: () => void;
  /** `saved` : l'événement tel qu'enregistré (date, heure…), quand il vient du formulaire classique. */
  onSaved: (saved?: Omit<TeamEvent, 'id' | 'teamId'>) => void;
}

/**
 * Création ou modification d'un événement. Jusqu'en U9, un match est un plateau :
 * il s'organise dans un assistant en plusieurs étapes (adversaires, matchs, convocation).
 */
export function EventForm(props: EventFormProps) {
  const { me } = useApp();
  const category = me.teams.find((t) => t.id === props.teamId)?.category;
  const plateaux = playsPlateaux(category);
  const first = props.event?.type ?? props.initialType ?? 'training';
  const [type, setType] = useState<EventType>(plateaux && first === 'match' && !props.event ? 'plateau' : first);
  if (plateaux && type === 'plateau') return <PlateauWizard {...props} onType={setType} />;
  return <ClassicEventForm key={type} {...props} type={type} plateaux={plateaux} onType={setType} />;
}

function ClassicEventForm({
  teamId, date, event, occurrence, type, plateaux, initialGroup, initialWeekly, scope, onType, onClose, onSaved,
}: EventFormProps & { type: EventType; plateaux: boolean; onType: (t: EventType) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useApp();
  const groups = groupsOf(me.teams.find((t) => t.id === teamId)?.category);
  const weekday = fromYMD(date).getDay();
  // Une seule date d'une série : on la modifie comme un événement à part.
  const detach = !!(event && scope === 'one' && occurrence && event.recurrence.freq !== 'none');
  const [e, setE] = useState<Draft>(() =>
    event
      ? detach
        ? { ...event, type, start: occurrence!, exdates: [], recurrence: { freq: 'none', interval: 1, days: [], until: null, count: null } }
        : { ...event, type }
      : {
          type, title: '', start: date, allDay: false, time: type === 'training' ? '14:00' : '10:00', endTime: type === 'training' ? '15:30' : '11:30', meetTime: '', location: '',
          opponent: '', venue: '', notes: '', color: '', parents: true, exdates: [], group: initialGroup ?? undefined,
          recurrence: { freq: initialWeekly ? 'weekly' : 'none', interval: 1, days: [weekday], until: null, count: null },
        },
  );
  const [ends, setEnds] = useState<'never' | 'until' | 'count'>(event?.recurrence.until ? 'until' : event?.recurrence.count ? 'count' : 'never');
  const [prepare, setPrepare] = useState(false);
  const [busy, setBusy] = useState(false);
  const logo = useLogoPick();
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

  const isMatch = e.type === 'match' || e.type === 'plateau' || e.type === 'tournament';
  // Équipe U8/U9 : chaque match appartient à une seule catégorie.
  const group = isMatch && groups.length ? (e.group && groups.includes(e.group) ? e.group : groups[0]) : undefined;

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        ...e,
        group,
        teamId,
        games: undefined,
        recurrence: { ...r, until: ends === 'until' ? r.until : null, count: ends === 'count' ? r.count ?? 10 : null },
      };
      if (detach) await api.put(`/events/${event!.id}`, { ...event, exdates: [...event!.exdates, occurrence] });
      const id = event && !detach ? event.id : uid();
      await api.put(`/events/${id}`, body);
      if (logo.logo && isMatch) await api.post(`/events/${id}/logo`, { image: logo.logo });
      if (prepare && !event) {
        const t = await createTraining(teamId, `${e.start}T${e.time || '14:00'}`, e.title || 'Entraînement');
        nav(`/seances/${t.id}`);
      }
      toast(event ? 'Événement modifié' : 'Événement ajouté');
      onSaved(body);
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const remove = useRemoveEvent(event, occurrence, () => onSaved());
  const color = e.color || EVENT_TYPES[e.type].color;
  const home = e.venue === 'home';

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
        <div className="title-field">
          <input className="input title" placeholder={eventTitle({ ...e, title: '' })} value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} />
          <TypePicker value={e.type} types={eventTypesFor(plateaux, event?.type)} onChange={onType} />
        </div>

        {isMatch && (
          <div className="ev-2col">
            {groups.length > 0 ? (
              <Field label="Catégorie">
                <Seg<string> value={group!} onChange={(g) => setE({ ...e, group: g })} options={groups.map((g) => ({ value: g, label: g }))} />
              </Field>
            ) : (
              <span className="ev-2col-gap" />
            )}
            <Field label="Lieu du match">
              <Seg<string>
                value={e.venue}
                onChange={(v) => setE({ ...e, venue: v as TeamEvent['venue'] })}
                options={[{ value: 'home', label: 'Domicile' }, { value: 'away', label: 'Extérieur' }, { value: 'neutral', label: 'Neutre' }]}
              />
            </Field>
          </div>
        )}

        {isMatch && (
          <div className="ev-2col">
            <Field label="Adversaire">
              <input className="input" value={e.opponent} placeholder="Ex. Teyran" onChange={(x) => setE({ ...e, opponent: x.target.value })} />
            </Field>
            <Field label="Club organisateur">
              <input
                className="input"
                value={home ? '' : e.organizer ?? ''}
                disabled={home}
                placeholder={home ? me.club?.name ?? 'Votre club' : e.opponent || 'Ex. AS Teyran'}
                onChange={(x) => setE({ ...e, organizer: x.target.value })}
              />
            </Field>
          </div>
        )}

        {isMatch && (
          <Field label="Logo du club organisateur">
            <LogoField logo={logo.logo} saved={e.logo} eventId={event?.id} home={home} onPick={logo.open} />
            {logo.input}
          </Field>
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
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={e.allDay} onChange={(x) => setE({ ...e, allDay: x.target.checked })} />
          <span>Toute la journée</span>
        </label>

        <Field label="Adresse">
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

        {e.type !== 'training' && e.type !== 'meeting' && <ConvBox teamId={teamId} e={e} setE={setE} />}

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

export type EditScope = 'one' | 'all';

/** Événement répété : l'action porte-t-elle sur cette date seulement, ou sur toute la série ? */
export function ScopeSheet({
  title, danger, onPick, onClose,
}: { title: string; danger?: boolean; onPick: (scope: EditScope) => void; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onPick('all')}>
            Cet événement et tous les autres
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => onPick('one')} autoFocus>
            Cet événement seulement
          </button>
        </>
      }
    >
      <p className="muted">Cet événement se répète. {danger ? 'Supprimer' : 'Modifier'} uniquement cette date, ou toute la série ?</p>
    </Sheet>
  );
}

/** Suppression d'un événement (une date ou toute la série s'il se répète). */
export function useRemoveEvent(event: TeamEvent | undefined, occurrence: string | undefined, onSaved: () => void) {
  const confirm = useConfirm();
  return async () => {
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
}
