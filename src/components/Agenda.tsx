import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SceneThumb, coverToExercise } from './Pitch';
import { Calendar, EventForm, ScopeSheet, hasConv, usePrepareSession, type EditScope } from './Calendar';
import { MatchActions, useMatchMenu, type MatchRef } from './MatchActions';
import { Crest, useMatchCrest } from './MatchShowcase';
import { useConfirm, useContextMenu, useToast } from './ui';
import { api } from '../lib/api';
import { matchPath } from '../lib/convocations';
import {
  EVENT_TYPES, MONTHS_LONG, MONTHS_TILE, agenda, eventTitle, formatTime, fromYMD, mondayOf, occurrences, shiftYMD, toYMD, type Agenda,
} from '../lib/events';
import { dateTile, relative, todayISO, useApp } from '../lib/store';
import type { ConvSnapshot, EventType, GameResult, TeamEvent, Ticket, Training } from '../lib/types';
import { totalMinutes } from '../pages/Trainings';

/* ================================================================== modèle */

export type AgendaView = 'week' | 'month';
export type AgendaFilter = 'all' | 'training' | 'match';
type Kind = 'training' | 'match' | 'other';

const MATCH_TYPES: EventType[] = ['match', 'plateau', 'tournament'];
export const isMatchEvent = (e: Pick<TeamEvent, 'type'>) => MATCH_TYPES.includes(e.type);

/** Entraînement (programmé ou séance préparée), match (plateau, tournoi) ou autre événement. */
export function kindOf(it: { event?: TeamEvent; training?: Training }): Kind {
  if (it.training || it.event?.type === 'training') return 'training';
  return it.event && isMatchEvent(it.event) ? 'match' : 'other';
}

/** Un filtre de l'agenda laisse-t-il passer cet élément ? La catégorie (U8, U9…) ne concerne que les matchs. */
export function passes(it: { event?: TeamEvent; training?: Training }, filter: AgendaFilter, group: string) {
  const k = kindOf(it);
  if (filter !== 'all' && k !== filter) return false;
  return !(group && k === 'match' && it.event?.group && it.event.group !== group);
}

const occKey = (eventId: string, date: string) => `${eventId}:${date}`;

/** Données de l'agenda : les événements, les séances, et l'état des matchs (convocations côté éducateurs, billets côté parents). */
export interface AgendaData {
  events: TeamEvent[];
  trainings: Training[];
  convs: ConvSnapshot[];
  tickets: Ticket[];
}

/** Score d'un match, ou bilan d'un plateau (« 2 V · 1 N »). */
function scoreText(s: { us: number; them: number; games?: GameResult[] | null } | null | undefined) {
  if (!s) return null;
  if (s.games?.length) {
    const g = s.games.filter((x) => x.us !== null && !x.live);
    if (!g.length) return null;
    const w = g.filter((x) => x.us! > x.them!).length;
    const d = g.filter((x) => x.us === x.them).length;
    return [w && `${w} V`, d && `${d} N`, g.length - w - d && `${g.length - w - d} D`].filter(Boolean).join(' · ');
  }
  return `${s.us} – ${s.them}`;
}

interface MatchState {
  label: ReactNode;
  tone?: 'warn' | 'ok' | 'mute';
  score?: string | null;
}

/** Où en est le match, en quelques mots : réponses, convoqués, score, ou ce que le parent doit faire. */
function useMatchState(data: AgendaData) {
  const { me, isStaff } = useApp();
  const convs = useMemo(() => new Map(data.convs.map((c) => [occKey(c.eventId, c.date), c])), [data.convs]);
  const tickets = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of data.tickets) m.set(occKey(t.eventId, t.date), [...(m.get(occKey(t.eventId, t.date)) ?? []), t]);
    return m;
  }, [data.tickets]);
  const multi = me.children.length > 1;
  const state = (it: Agenda): MatchState | null => {
    if (!it.event) return null;
    const c = convs.get(occKey(it.event.id, it.date));
    if (c) {
      const answered = c.counts.yes + c.counts.maybe + c.counts.no;
      const score = scoreText(c.score);
      if (score) return { label: 'Terminé', score, tone: 'mute' };
      if (c.phase === 'played') return { label: 'Terminé', tone: 'mute' };
      if (c.phase === 'published') return { label: `${c.selected} convoqué${c.selected > 1 ? 's' : ''}`, tone: 'ok' };
      if (c.phase === 'missed') return { label: 'Jamais publiée', tone: 'warn' };
      return { label: `${answered}/${c.total} réponses`, tone: c.phase === 'late' ? 'warn' : undefined };
    }
    const ts = tickets.get(occKey(it.event.id, it.date));
    if (ts?.length) {
      const t = ts.find((x) => x.status === 'to_answer') ?? ts[0];
      const who = multi ? `${t.child.firstName} · ` : '';
      const score = scoreText(t.result);
      if (score) return { label: 'Terminé', score, tone: 'mute' };
      if (t.status === 'to_answer') return { label: `${who}À répondre`, tone: 'warn' };
      if (t.status === 'convoked') return { label: `${who}Convoqué`, tone: 'ok' };
      if (t.status === 'not_selected') return { label: `${who}Non retenu`, tone: 'mute' };
      if (t.status === 'answered') return { label: `${who}Réponse envoyée` };
      return { label: 'Terminé', tone: 'mute' };
    }
    return null;
  };
  /** Le match s'ouvre-t-il ? Éducateurs : toujours ; parents : seulement ceux où leur enfant a un billet. */
  const opens = (it: Agenda) => !!it.event && hasConv(it.event) && (isStaff || tickets.has(occKey(it.event.id, it.date)));
  return { state, opens };
}

/* ================================================================== préférences */

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v !== null && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* navigation privée : on garde le choix pour la visite */
  }
}

/** Vue (semaine, mois), filtre et catégorie de l'agenda : mémorisés sur l'appareil, `?vue=mois` et `?cat=U9` dans l'adresse. */
export function useAgendaPrefs(groups: string[]) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<AgendaView>(() => {
    const v = params.get('vue');
    return v === 'mois' ? 'month' : v === 'semaine' ? 'week' : stored('atelier.agenda.view', ['week', 'month'] as const, 'week');
  });
  const [filter, setFilter] = useState<AgendaFilter>(() => stored('atelier.agenda.filter', ['all', 'training', 'match'] as const, 'all'));
  const [groupPref, setGroupPref] = useState<string>(() => params.get('cat') ?? stored<string>('atelier.agenda.group', [...groups, ''], ''));
  const group = groups.includes(groupPref) ? groupPref : '';
  return {
    view, filter, group, groups,
    setView: (v: AgendaView) => {
      setView(v);
      remember('atelier.agenda.view', v);
      // Le lien « ?vue=mois » (ancienne page Calendrier) ne sert qu'à l'ouverture.
      if (params.has('vue'))
        setParams((p) => {
          const n = new URLSearchParams(p);
          n.delete('vue');
          return n;
        }, { replace: true });
    },
    setFilter: (f: AgendaFilter) => (setFilter(f), remember('atelier.agenda.filter', f)),
    setGroup: (g: string) => (setGroupPref(g), remember('atelier.agenda.group', g)),
  };
}
export type AgendaPrefs = ReturnType<typeof useAgendaPrefs>;

/* ================================================================== actions */

const repeats = (it: Pick<Agenda, 'event'>) => !!it.event && it.event.recurrence.freq !== 'none';

const THIS: Record<EventType, string> = {
  training: 'cet entraînement', match: 'ce match', plateau: 'ce plateau', tournament: 'ce tournoi', meeting: 'cette réunion', other: 'cet événement',
};
const THE: Record<EventType, string> = {
  training: 'l’entraînement', match: 'le match', plateau: 'le plateau', tournament: 'le tournoi', meeting: 'la réunion', other: 'l’événement',
};

/**
 * Tout ce qu'on fait depuis le calendrier : créer un événement sur un jour, modifier ou supprimer
 * (une date ou toute la série), et le menu contextuel des cartes (clic droit ou appui long).
 */
export function useAgendaActions(teamId: string, data: AgendaData | null, reload: () => void) {
  const { isStaff, can } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [ask, setAsk] = useState<{ it: Agenda; action: 'edit' | 'remove' } | null>(null);
  const [edit, setEdit] = useState<{ it: Agenda; scope: EditScope } | null>(null);
  const [create, setCreate] = useState<{ date: string; type?: EventType; group?: string | null } | null>(null);

  /** Entraînements programmés rattachés à leur séance (même jour), sur toute la période connue. */
  const linked = useMemo(() => {
    if (!data) return [];
    const training = data.events.filter((e) => e.type === 'training');
    const dates = [...data.trainings.map((t) => t.date.slice(0, 10)), ...training.map((e) => e.start), todayISO()].sort();
    return agenda(training, data.trainings, dates[0], shiftYMD(dates[dates.length - 1], 400));
  }, [data]);
  const itemOfTraining = (t: Training): Agenda =>
    linked.find((it) => it.training?.id === t.id) ?? { key: t.id, date: t.date.slice(0, 10), time: t.date.slice(11, 16), title: t.title, color: EVENT_TYPES.training.color, training: t };
  const itemOfMatch = (m: MatchRef): Agenda | null => {
    const e = data?.events.find((x) => x.id === m.eventId);
    return e ? { key: occKey(e.id, m.date), date: m.date, time: e.time, title: eventTitle(e), color: e.color || EVENT_TYPES[e.type].color, event: e } : null;
  };

  const canEdit = isStaff && can('events.manage');
  const canMenu = (it: Agenda) => isStaff && can(it.event ? 'events.manage' : 'trainings.manage');

  const onEdit = (it: Agenda) => {
    if (!it.event) return it.training && nav(`/seances/${it.training.id}`);
    if (repeats(it)) setAsk({ it, action: 'edit' });
    else setEdit({ it, scope: 'all' });
  };
  const onRemove = async (it: Agenda, scope?: EditScope) => {
    if (repeats(it) && !scope) return setAsk({ it, action: 'remove' });
    try {
      if (it.event && repeats(it) && scope === 'one') {
        await api.put(`/events/${it.event.id}`, { ...it.event, exdates: [...it.event.exdates, it.date] });
        if (it.training) await api.del(`/trainings/${it.training.id}`);
      } else if (it.event) {
        // Toute la série : ses séances préparées partent avec elle.
        const sessions = linked.filter((l) => l.event?.id === it.event!.id && l.training).map((l) => l.training!);
        const match = isMatchEvent(it.event);
        const ok = await confirm({
          title: repeats(it) ? 'Supprimer toute la série ?' : `Supprimer ${THIS[it.event.type]} ?`,
          text: sessions.length
            ? `${sessions.length > 1 ? `Les ${sessions.length} séances préparées seront` : 'La séance préparée sera'} également supprimée${sessions.length > 1 ? 's' : ''}.`
            : match
              ? 'La convocation et les réponses des parents seront effacées.'
              : undefined,
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
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  /** Habille une carte de son menu contextuel « Modifier / Supprimer » (les matchs ont déjà le leur, branché sur les mêmes actions). */
  const wrap = (it: Agenda, node: ReactNode) =>
    kindOf(it) === 'match' ? (
      node
    ) : (
      <CardMenu on={canMenu(it)} onEdit={() => onEdit(it)} onRemove={() => void onRemove(it)}>
        {node}
      </CardMenu>
    );

  /** Actions branchées sur les cartes de match qui ont leur propre menu (convocations, diapositives). */
  const matchActions = canEdit
    ? {
        edit: (m: MatchRef) => {
          const it = itemOfMatch(m);
          if (it) onEdit(it);
        },
        remove: (m: MatchRef) => {
          const it = itemOfMatch(m);
          if (it) void onRemove(it);
        },
      }
    : null;

  const sheets = (
    <>
      {ask && (
        <ScopeSheet
          title={`${ask.action === 'edit' ? 'Modifier' : 'Supprimer'} ${THE[ask.it.event?.type ?? 'other']}`}
          danger={ask.action === 'remove'}
          onClose={() => setAsk(null)}
          onPick={(scope) => {
            const { it, action } = ask;
            setAsk(null);
            if (action === 'edit') setEdit({ it, scope });
            else void onRemove(it, scope);
          }}
        />
      )}
      {edit && edit.it.event && (
        <EventForm
          teamId={teamId}
          date={edit.it.date}
          event={edit.it.event}
          occurrence={edit.it.date}
          scope={edit.scope}
          onClose={() => setEdit(null)}
          onSaved={async (saved) => {
            const { it, scope } = edit;
            setEdit(null);
            // La séance préparée suit sa date quand on déplace cet entraînement seul.
            const t = it.training;
            if (saved && t && (scope === 'one' || !repeats(it)) && saved.start !== it.date) {
              try {
                await api.put(`/trainings/${t.id}`, { ...t, date: `${saved.start}T${saved.time || t.date.slice(11, 16) || '14:00'}` });
              } catch (e) {
                toast((e as Error).message, true);
              }
            }
            reload();
          }}
        />
      )}
      {create && (
        <EventForm
          teamId={teamId}
          date={create.date}
          initialType={create.type}
          initialGroup={create.group}
          onClose={() => setCreate(null)}
          onSaved={() => {
            setCreate(null);
            reload();
          }}
        />
      )}
    </>
  );

  return {
    canEdit, wrap, sheets, matchActions, onEdit, itemOfTraining,
    create: canEdit ? (date: string, type?: EventType, group?: string | null) => setCreate({ date, type, group }) : null,
  };
}
export type AgendaActions = ReturnType<typeof useAgendaActions>;

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

/** Le menu des matchs (convocations, diapositives) passe par les mêmes actions que le calendrier. */
export function AgendaMatchActions({ actions, children }: { actions: AgendaActions; children: ReactNode }) {
  return <MatchActions.Provider value={actions.matchActions}>{children}</MatchActions.Provider>;
}

/* ================================================================== cartes */

/** Titres donnés automatiquement : inutile de les répéter sous chaque carte du calendrier. */
const GENERIC = new Set(['Entraînement', 'Nouvelle séance']);

export function SessionCard({
  t, past, onClick, onLive, bare,
}: {
  t: Training; past?: boolean; onClick: () => void;
  /** Bouton « Lancer » sur la vignette (éducateurs, séance du jour ou à venir). */
  onLive?: () => void;
  /** Calendrier : le titre n'apparaît que s'il dit quelque chose de plus qu'« Entraînement ». */
  bare?: boolean;
}) {
  const tile = dateTile(t.date);
  const cover = useMemo(() => (t.cover ? coverToExercise(t.cover) : null), [t.cover]);
  const done = !!t.attendance?.length;
  const minutes = totalMinutes(t);
  const title = bare && GENERIC.has(t.title.trim()) ? null : t.title;
  return (
    <div className={`s-card${past ? ' past' : ''}`} onClick={onClick} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="cover">
        {cover ? <SceneThumb ex={cover} /> : <div className="cover-empty" />}
        <span className="date-chip">
          {tile.weekday} {tile.day} {tile.month}
        </span>
        {done && (
          <span className="done-chip" title={`${t.attendance!.length} présents`}>
            <Check size={14} strokeWidth={3} /> {t.attendance!.length}
          </span>
        )}
        {onLive && (
          <button
            className="s-live"
            onClick={(e) => {
              e.stopPropagation();
              onLive();
            }}
            aria-label="Lancer la séance"
            title="Lancer la séance"
          >
            <Play fill="currentColor" />
          </button>
        )}
      </div>
      {title && <b className="s-title">{title}</b>}
      {(minutes > 0 || !bare) && <span className="s-meta">{minutes} min</span>}
    </div>
  );
}

/** Entraînement programmé dont la séance n'est pas encore préparée : la date est connue de tous, le contenu viendra. */
export function PlannedCard({
  it, canPrepare, onPrepare, bare,
}: {
  it: Agenda; canPrepare: boolean; onPrepare: () => void;
  /** Calendrier : pas de titre sous la carte, sauf un titre personnalisé (« Entraînement gardiens »). */
  bare?: boolean;
}) {
  const tile = dateTile(`${it.date}T${it.time || '12:00'}`);
  const title = it.event?.title || 'Entraînement';
  return (
    <div
      className={`s-card planned${canPrepare ? '' : ' readonly'}`}
      onClick={canPrepare ? onPrepare : undefined}
      role={canPrepare ? 'button' : undefined}
      tabIndex={canPrepare ? 0 : undefined}
      onKeyDown={canPrepare ? (e) => e.key === 'Enter' && onPrepare() : undefined}
    >
      <div className="cover">
        <div className="cover-planned">
          <CalendarClock />
          <span>{canPrepare ? 'Préparer la séance' : 'Séance bientôt en ligne'}</span>
        </div>
        <span className="date-chip">
          {tile.weekday} {tile.day} {tile.month}
        </span>
      </div>
      {!(bare && GENERIC.has(title)) && <b className="s-title">{title}</b>}
    </div>
  );
}

const WD_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Écusson du club organisateur (logo, sinon initiales sur un blason). */
function MatchCrest({ it }: { it: Agenda }) {
  const e = it.event!;
  const { organizer, logo, crestColor, fallback } = useMatchCrest({
    teamId: e.teamId, venue: e.venue, organizer: e.organizer ?? '', opponent: e.opponent, logo: e.logo ? `/api/events/${e.id}/logo?v=${e.logo}` : null,
  });
  return logo ? <img src={logo} alt={organizer} draggable={false} /> : <Crest name={fallback} color={crestColor} />;
}

/** Titre sous l'heure : « Plateau » est déjà écrit au-dessus, on nomme plutôt le club organisateur. */
function tileTitle(e: TeamEvent) {
  const t = eventTitle(e);
  if (t !== EVENT_TYPES[e.type].label) return t;
  return e.organizer ? `à ${e.organizer}` : e.venue === 'home' ? 'À domicile' : t;
}

/** Match dans une colonne de la semaine : type, heure, adversaire et état de la convocation. */
function MatchTile({ it, state, past, onOpen }: { it: Agenda; state: MatchState | null; past: boolean; onOpen?: () => void }) {
  const e = it.event!;
  const { bind, menu } = useMatchMenu({ eventId: e.id, date: it.date });
  return (
    <>
      {menu}
      <button
        {...bind}
        className={`mt${past ? ' past' : ''}`}
        onClick={onOpen}
        disabled={!onOpen}
        style={{ ['--c' as string]: it.color }}
        aria-label={`${EVENT_TYPES[e.type].label} : ${eventTitle(e)}${it.time ? ` à ${formatTime(it.time)}` : ''}`}
      >
        <span className="mt-top">
          <span className="mt-kind">
            {e.group && <b>{e.group}</b>}
            {EVENT_TYPES[e.type].label}
          </span>
          <span className="mt-crest" aria-hidden>
            <MatchCrest it={it} />
          </span>
        </span>
        <b className="mt-time">{it.time ? formatTime(it.time) : 'Journée'}</b>
        <span className="mt-title">{tileTitle(e)}</span>
        {state && (
          <span className={`mt-state ${state.tone ?? ''}`}>
            {state.score ? <strong>{state.score}</strong> : state.label}
          </span>
        )}
      </button>
    </>
  );
}

/** Match joué, en grande vignette (historique) : écusson, score, date. */
function MatchCover({ it, state, onOpen }: { it: Agenda; state: MatchState | null; onOpen?: () => void }) {
  const e = it.event!;
  const d = fromYMD(it.date);
  const { bind, menu } = useMatchMenu({ eventId: e.id, date: it.date });
  return (
    <>
      {menu}
      <div
        {...bind}
        className={`s-card m-card${onOpen ? '' : ' readonly'}`}
        onClick={onOpen}
        role={onOpen ? 'link' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onKeyDown={onOpen ? (x) => x.key === 'Enter' && onOpen() : undefined}
      >
        <div className="cover m-cover">
          <span className="m-logo" aria-hidden>
            <MatchCrest it={it} />
          </span>
          <span className="date-chip">
            {WD_SHORT[d.getDay()]} {d.getDate()} {MONTHS_SHORT[d.getMonth()]}
          </span>
          {state?.score && <span className="m-score">{state.score}</span>}
          <span className="m-kind">
            {e.group && <b>{e.group}</b>}
            {EVENT_TYPES[e.type].label}
          </span>
        </div>
        <b className="s-title">{eventTitle(e)}</b>
        {state && !state.score && <span className="s-meta">{state.label}</span>}
      </div>
    </>
  );
}

/** Réunion, événement divers : une étiquette de couleur. */
function EventChip({ it, onOpen }: { it: Agenda; onOpen?: () => void }) {
  return (
    <button className="ev-chip" onClick={onOpen} disabled={!onOpen} style={{ ['--c' as string]: it.color }}>
      <i />
      <span>
        <b>{it.title}</b>
        <small>{it.time ? formatTime(it.time) : 'Journée'}</small>
      </span>
    </button>
  );
}

/* ================================================================== commandes */

/** Choix unique en pastilles, avec un curseur qui glisse d'une option à l'autre. */
function Pills<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number; ready: boolean } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const place = () => {
      const on = box.querySelector<HTMLElement>('[aria-checked="true"]');
      if (on) setThumb((t) => ({ x: on.offsetLeft, w: on.offsetWidth, ready: !!t }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div className="pills" role="radiogroup" aria-label={label} ref={ref}>
      {thumb && <i className={`pills-thumb${thumb.ready ? ' ready' : ''}`} style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} aria-hidden />}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {!!o.count && <small>{o.count}</small>}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== agenda */

const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WD_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthStart = (ymd: string) => {
  const d = fromYMD(ymd);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
};

/** Intitulé d'une semaine : « Cette semaine », « Semaine prochaine », ou « Semaine du 5 au 11 oct. ». */
function weekLabel(start: string, today: string) {
  const diff = Math.round((fromYMD(start).getTime() - fromYMD(mondayOf(today)).getTime()) / (7 * 864e5));
  if (diff === 0) return 'Cette semaine';
  if (diff === 1) return 'Semaine prochaine';
  if (diff === -1) return 'Semaine dernière';
  const a = fromYMD(start);
  const b = fromYMD(shiftYMD(start, 6));
  return `Semaine du ${a.getDate()}${a.getMonth() !== b.getMonth() ? ` ${MONTHS_SHORT[a.getMonth()]}` : ''} au ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

/**
 * Le calendrier de l'équipe : entraînements, séances et matchs réunis.
 * Semaine en colonnes (un clic sur un jour crée un événement ce jour-là) ou mois complet avec la vue d'ensemble.
 */
export function AgendaBoard({ teamId, data, prefs, actions, onChanged }: { teamId: string; data: AgendaData; prefs: AgendaPrefs; actions: AgendaActions; onChanged: () => void }) {
  const { isStaff, can } = useApp();
  const nav = useNavigate();
  const prepare = usePrepareSession(teamId);
  const match = useMatchState(data);
  const { view, filter, group, groups } = prefs;
  const today = todayISO();
  const canPlan = isStaff && can('trainings.manage');

  const [start, setStart] = useState(() => mondayOf(today));
  const [month, setMonth] = useState(() => monthStart(today));
  const [dir, setDir] = useState<'next' | 'prev' | 'none'>('none');
  const [jump, setJump] = useState<{ date: string; n: number } | null>(null);

  const go = (n: -1 | 1) => {
    setDir(n > 0 ? 'next' : 'prev');
    if (view === 'week') setStart((s) => shiftYMD(s, 7 * n));
    else setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  };
  const current = view === 'week' ? start === mondayOf(today) : toYMD(month).slice(0, 7) === today.slice(0, 7);
  const toToday = () => {
    setDir(view === 'week' ? (start < mondayOf(today) ? 'next' : 'prev') : toYMD(month) < today ? 'next' : 'prev');
    setStart(mondayOf(today));
    setMonth(monthStart(today));
  };
  // Passer d'une vue à l'autre garde la période : la semaine affichée ouvre son mois, et inversement.
  const switchView = (v: AgendaView) => {
    if (v === view) return;
    setDir('none');
    if (v === 'month') setMonth(monthStart(start));
    else setStart(toYMD(month).slice(0, 7) === today.slice(0, 7) ? mondayOf(today) : mondayOf(toYMD(month)));
    prefs.setView(v);
  };

  // Période visible, pour les compteurs des filtres.
  const range = useMemo(() => {
    if (view === 'week') return [start, shiftYMD(start, 6)] as const;
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
    return [toYMD(month), toYMD(last)] as const;
  }, [view, start, month]);
  const all = useMemo(() => agenda(data.events, data.trainings, range[0], range[1]), [data, range]);
  const counts = useMemo(() => {
    const c = { all: 0, training: 0, match: 0 };
    for (const it of all) {
      if (!passes(it, 'all', group)) continue;
      c.all++;
      const k = kindOf(it);
      if (k !== 'other') c[k]++;
    }
    return c;
  }, [all, group]);
  const items = useMemo(() => all.filter((it) => passes(it, filter, group)), [all, filter, group]);

  // Flèches du clavier : semaine (ou mois) précédente et suivante, « T » pour aujourd'hui.
  const root = useRef<HTMLElement>(null);
  const visible = useRef(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!visible.current || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"], body > .menu')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 't' || e.key === 'T') toToday();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Nouvel événement : le type suit le filtre (« Matchs » propose un match), la catégorie aussi.
  const newType: EventType | undefined = filter === 'match' ? 'match' : filter === 'training' ? 'training' : undefined;
  const newGroup = group || null;

  const open = (it: Agenda) => {
    if (it.training) return nav(`/seances/${it.training.id}`);
    if (it.event && match.opens(it)) return nav(matchPath(it.event.id, it.date));
    if (actions.canEdit && it.event) actions.onEdit(it);
  };

  const card = (it: Agenda, past: boolean) => {
    const k = kindOf(it);
    if (k === 'training')
      return it.training ? (
        <SessionCard
          t={it.training}
          past={past}
          bare
          onClick={() => open(it)}
          onLive={canPlan && !past && it.training.blocks.length ? () => nav(`/seances/${it.training!.id}/live`) : undefined}
        />
      ) : (
        // Un jour passé se prépare aussi : l'éducateur y retrouve l'appel et le contenu de la séance.
        <PlannedCard it={it} bare canPrepare={canPlan} onPrepare={() => void prepare(it)} />
      );
    if (k === 'match') {
      const canOpen = match.opens(it) || actions.canEdit;
      return <MatchTile it={it} state={match.state(it)} past={past} onOpen={canOpen ? () => open(it) : undefined} />;
    }
    return <EventChip it={it} onOpen={actions.canEdit ? () => open(it) : undefined} />;
  };

  const monthIdx = month.getMonth();
  const title = view === 'week' ? weekLabel(start, today) : (
    <>
      {cap(MONTHS_LONG[monthIdx])} <span className="muted">{month.getFullYear()}</span>
    </>
  );

  return (
    <section className="ag" data-view={view} ref={root} aria-label="Calendrier">
      <div className="ag-head">
        <div className="ag-title">
          <h2 key={view === 'week' ? start : toYMD(month)} className={`ag-h ${dir}`}>{title}</h2>
          {view === 'month' && (
            <span className="ag-arrows">
              <button className="btn icon sm ghost" onClick={() => go(-1)} aria-label="Mois précédent">
                <ChevronLeft />
              </button>
              <button className="btn icon sm ghost" onClick={() => go(1)} aria-label="Mois suivant">
                <ChevronRight />
              </button>
            </span>
          )}
          {!current && (
            <button className="plain-toggle ag-today" onClick={toToday}>
              Revenir à aujourd’hui
            </button>
          )}
        </div>
        <div className="ag-tools">
          <Pills<AgendaFilter>
            label="Afficher"
            value={filter}
            onChange={(f) => (setDir('none'), prefs.setFilter(f))}
            options={[
              { value: 'all', label: 'Tout' },
              { value: 'training', label: <><i className="dot" style={{ background: EVENT_TYPES.training.color }} />Séances</>, count: counts.training },
              { value: 'match', label: <><i className="dot" style={{ background: EVENT_TYPES.match.color }} />Matchs</>, count: counts.match },
            ]}
          />
          {groups.length > 0 && (
            <Pills<string>
              label="Catégorie des matchs"
              value={group}
              onChange={(g) => (setDir('none'), prefs.setGroup(g))}
              options={[{ value: '', label: 'Toutes' }, ...groups.map((g) => ({ value: g, label: g }))]}
            />
          )}
          <Pills<AgendaView>
            label="Vue"
            value={view}
            onChange={switchView}
            options={[
              { value: 'week', label: 'Semaine' },
              { value: 'month', label: 'Mois' },
            ]}
          />
        </div>
      </div>

      {view === 'week' ? (
        <WeekBoard
          key="week"
          start={start}
          dir={dir}
          stamp={`${start}|${filter}|${group}`}
          items={items}
          today={today}
          card={card}
          wrap={actions.wrap}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onCreate={actions.create ? (d) => actions.create!(d, newType, newGroup) : undefined}
        />
      ) : (
        <div key="month" className="ag-month">
          <div className={`cal-main card pad ag-swap ${dir}`} key={`${toYMD(month)}|${filter}|${group}`}>
            <Calendar
              big
              bare
              teamId={teamId}
              events={data.events.filter((e) => passes({ event: e }, filter, group))}
              trainings={filter === 'match' ? [] : data.trainings}
              canEdit={actions.canEdit}
              onChanged={onChanged}
              month={month}
              onMonth={setMonth}
              jump={jump}
              initialType={newType}
              initialGroup={newGroup}
            />
          </div>
          <AgendaFeed
            events={data.events.filter((e) => passes({ event: e }, filter, group))}
            onJump={(date) => {
              setDir('none');
              setJump({ date, n: Date.now() });
            }}
          />
        </div>
      )}
      {actions.canEdit && <p className="ag-hint hide-mobile">Cliquez sur un jour pour y ajouter un entraînement, un match ou un événement · ← → pour changer de {view === 'week' ? 'semaine' : 'mois'}</p>}
    </section>
  );
}

/** La semaine en colonnes : un jour par colonne, ses cartes, et tout l'espace libre pour ajouter un événement. */
function WeekBoard({
  start, dir, stamp, items, today, card, wrap, onPrev, onNext, onCreate,
}: {
  start: string; dir: string; stamp: string; items: Agenda[]; today: string;
  card: (it: Agenda, past: boolean) => ReactNode;
  wrap: (it: Agenda, node: ReactNode) => ReactNode;
  onPrev: () => void; onNext: () => void;
  onCreate?: (date: string) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftYMD(start, i)), [start]);
  const byDay = useMemo(() => {
    const m = new Map<string, Agenda[]>();
    for (const it of items) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return m;
  }, [items]);

  // Sur téléphone, les jours défilent de côté : aujourd'hui arrive en premier.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const t = el.querySelector<HTMLElement>('.wk-day.today');
    el.scrollTo({ left: t ? el.scrollLeft + t.getBoundingClientRect().left - el.getBoundingClientRect().left : 0, behavior: 'instant' as ScrollBehavior });
  }, [start]);

  return (
    <div className="wk-body ag-week">
      <button className="wk-side left" onClick={onPrev} aria-label="Semaine précédente">
        <ChevronLeft size={16} />
        <span>Semaine précédente</span>
      </button>
      <div className={`wk-days ag-swap ${dir}`} key={stamp} ref={scroller}>
        {days.map((d, i) => {
          const list = byDay.get(d) ?? [];
          const date = fromYMD(d);
          const past = d < today;
          return (
            <div
              key={d}
              className={`wk-day${d === today ? ' today' : ''}${past ? ' gone' : ''}${list.length ? '' : ' empty'}${onCreate ? ' can-add' : ''}`}
              style={{ ['--i' as string]: i }}
            >
              {onCreate && (
                <button
                  className="ag-hit"
                  onClick={() => onCreate(d)}
                  aria-label={`Ajouter un événement le ${WD_LONG[date.getDay()]} ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`}
                />
              )}
              <div className="wk-dlabel">
                <small>{WD[i]}</small>
                <b>{date.getDate()}</b>
                {date.getDate() === 1 && <small className="ag-mo">{MONTHS_TILE[date.getMonth()]}</small>}
              </div>
              <div className="wk-cards">
                {list.map((it) => (
                  <Fragment key={it.key}>{wrap(it, card(it, past))}</Fragment>
                ))}
              </div>
              {onCreate && (
                <span className="ag-plus" aria-hidden>
                  <Plus /> <span>Ajouter</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button className="wk-side right" onClick={onNext} aria-label="Semaine suivante">
        <span>Semaine suivante</span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

const WD_TILE = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const REPEAT: Record<string, string> = { daily: 'Tous les jours', weekly: 'Chaque semaine', monthly: 'Chaque mois' };

/** « Chaque mercredi et vendredi », « Toutes les 2 semaines », « Tous les jours »… */
function repeatLabel(e: TeamEvent) {
  const r = e.recurrence;
  if (r.freq === 'none') return null;
  if (r.freq === 'weekly' && r.interval === 1 && r.days.length) {
    const days = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD_LONG[d]);
    return `Chaque ${days.length > 1 ? `${days.slice(0, -1).join(', ')} et ${days[days.length - 1]}` : days[0]}`;
  }
  if (r.interval > 1) return `Toutes les ${r.interval} ${r.freq === 'daily' ? 'jours' : r.freq === 'weekly' ? 'semaines' : 'mois'}`;
  return REPEAT[r.freq];
}

/** Vue d'ensemble (vue mois) : les événements du plus proche au plus lointain, les passés à la fin. */
function AgendaFeed({ events, onJump }: { events: TeamEvent[]; onJump: (date: string) => void }) {
  const feed = useMemo(() => {
    const today = toYMD(new Date());
    const far = toYMD(new Date(Date.now() + 365 * 864e5));
    return events
      .map((e) => {
        const next = occurrences(e, today, far)[0] ?? null;
        const created = e.createdAt ?? e.updatedAt ?? 0;
        const updated = e.updatedAt ?? created;
        return { e, next, at: Math.max(created, updated), edited: updated - created > 60_000 };
      })
      .sort((a, b) => {
        if (!!a.next !== !!b.next) return a.next ? -1 : 1;
        const ka = `${a.next ?? a.e.start}T${a.e.time || '00:00'}`;
        const kb = `${b.next ?? b.e.start}T${b.e.time || '00:00'}`;
        return a.next ? ka.localeCompare(kb) : kb.localeCompare(ka);
      })
      .slice(0, 30);
  }, [events]);
  // « Ajouté / modifié · il y a… » n'a de sens que dans les 2 heures qui suivent.
  const fresh = Date.now() - 2 * 3600e3;
  return (
    <aside className="cal-feed">
      <h2>Vue d’ensemble</h2>
      {!feed.length && <p className="muted small">Aucun événement pour l’instant.</p>}
      <ol>
        {feed.map(({ e, next, at, edited }, i) => {
          const color = e.color || EVENT_TYPES[e.type].color;
          const d = next ? fromYMD(next) : fromYMD(e.start);
          const repeat = repeatLabel(e);
          return (
            <li key={e.id} style={{ ['--i' as string]: Math.min(i, 12) }}>
              <button onClick={() => onJump(next ?? e.start)} disabled={!next && e.start < toYMD(new Date()) && !repeat}>
                <span className="cf-date" style={{ ['--c' as string]: color }}>
                  <small>{WD_TILE[d.getDay()]}</small>
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
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ================================================================== historique */

/**
 * Tout ce qui s'est passé, mois par mois : séances et matchs joués dans la même ligne,
 * le mois le plus récent ouvert.
 */
export function AgendaHistory({ data, actions, group }: { data: AgendaData; actions: AgendaActions; group: string }) {
  const nav = useNavigate();
  const match = useMatchState(data);
  const today = todayISO();

  const entries = useMemo(() => {
    const out: { key: string; at: string; node: (wrap: AgendaActions['wrap']) => ReactNode }[] = [];
    for (const t of data.trainings) {
      if (t.date.slice(0, 10) >= today) continue;
      out.push({
        key: t.id,
        at: t.date.length > 10 ? t.date : `${t.date}T12:00`,
        node: (wrap) => wrap(actions.itemOfTraining(t), <SessionCard t={t} past onClick={() => nav(`/seances/${t.id}`)} />),
      });
    }
    const matches = data.events.filter((e) => isMatchEvent(e) && passes({ event: e }, 'match', group));
    if (matches.length) {
      const from = [...matches.map((e) => e.start)].sort()[0];
      for (const it of agenda(matches, [], from, shiftYMD(today, -1))) {
        out.push({
          key: it.key,
          at: `${it.date}T${it.time || '12:00'}`,
          node: () => <MatchCover it={it} state={match.state(it)} onOpen={match.opens(it) ? () => nav(matchPath(it.event!.id, it.date)) : undefined} />,
        });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, group, today]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof entries>();
    for (const e of entries) m.set(e.at.slice(0, 7), [...(m.get(e.at.slice(0, 7)) ?? []), e]);
    return [...m];
  }, [entries]);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const isOpen = (k: string) => (open ? open.has(k) : k === groups[0]?.[0]);
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o ?? (groups[0] ? [groups[0][0]] : []));
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!groups.length) return null;
  return (
    <section className="ag-history">
      <div className="sec-head">
        <h2>Historique</h2>
        <small className="muted">Séances passées et matchs joués</small>
      </div>
      <div className="months">
        {groups.map(([k, list]) => {
          const [y, m] = k.split('-').map(Number);
          const o = isOpen(k);
          return (
            <div key={k} className={`month-row${o ? ' open' : ''}`}>
              <button className="month-head" onClick={() => toggle(k)} aria-expanded={o}>
                <ChevronRight className="chev" />
                <b>{cap(MONTHS_LONG[m - 1])}</b>
                <small>{y}</small>
                <span className="rule" />
                <small className="count">{list.length}</small>
              </button>
              {o && (
                <div className="month-line">
                  {list.map((e) => (
                    <Fragment key={e.key}>{e.node(actions.wrap)}</Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
