import type { EventType, TeamEvent, Training } from './types';

export const EVENT_TYPES: Record<EventType, { label: string; color: string }> = {
  training: { label: 'Entraînement', color: '#3f8f63' },
  match: { label: 'Match', color: '#e03131' },
  plateau: { label: 'Plateau', color: '#f08c00' },
  tournament: { label: 'Tournoi', color: '#7048e8' },
  meeting: { label: 'Réunion', color: '#1c7ed6' },
  other: { label: 'Autre', color: '#868e96' },
};

export const WEEKDAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromYMD = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

/** Dates (AAAA-MM-JJ) d'un événement comprises entre from et to inclus. */
export function occurrences(e: TeamEvent, from: string, to: string): string[] {
  const r = e.recurrence ?? { freq: 'none', interval: 1, days: [], until: null, count: null };
  const out: string[] = [];
  const ex = new Set(e.exdates ?? []);
  const until = r.until && r.until < to ? r.until : to;
  let n = 0;
  const push = (d: string) => {
    n++;
    if (d >= from && d <= until && !ex.has(d)) out.push(d);
  };
  const done = (d: string) => d > until || (r.count !== null && n >= r.count);

  if (r.freq === 'none') {
    if (e.start >= from && e.start <= to && !ex.has(e.start)) out.push(e.start);
    return out;
  }
  const start = fromYMD(e.start);
  const step = Math.max(1, r.interval || 1);
  for (let i = 0; i < 2000; i++) {
    if (r.freq === 'daily') {
      const d = toYMD(addDays(start, i * step));
      if (done(d)) break;
      push(d);
    } else if (r.freq === 'monthly') {
      const d0 = new Date(start.getFullYear(), start.getMonth() + i * step, 1, 12);
      const last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
      if (start.getDate() > last) continue; // pas de 31 en avril : on saute ce mois
      const d = toYMD(new Date(d0.getFullYear(), d0.getMonth(), start.getDate(), 12));
      if (done(d)) break;
      push(d);
    } else {
      // Hebdomadaire : semaine de départ (lundi), toutes les `step` semaines, jours choisis.
      const days = r.days.length ? [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [start.getDay()];
      const monday = addDays(start, -((start.getDay() + 6) % 7) + i * 7 * step);
      if (toYMD(monday) > until) break;
      let stop = false;
      for (const wd of days) {
        const d = toYMD(addDays(monday, (wd + 6) % 7));
        if (d < e.start) continue;
        if (done(d)) {
          stop = true;
          break;
        }
        push(d);
      }
      if (stop) break;
    }
  }
  return out;
}

export function eventTitle(e: Pick<TeamEvent, 'type' | 'title' | 'opponent' | 'venue'>) {
  if (e.title) return e.title;
  if (e.type === 'match' && e.opponent) return `Match ${e.venue === 'away' ? 'à' : 'contre'} ${e.opponent}`;
  return EVENT_TYPES[e.type].label;
}

/** Élément affiché dans le calendrier : un événement (occurrence) ou une séance préparée. */
export interface Agenda {
  key: string;
  date: string;
  time: string;
  title: string;
  color: string;
  event?: TeamEvent;
  training?: Training;
}

export function agenda(events: TeamEvent[], trainings: Training[], from: string, to: string): Agenda[] {
  const items: Agenda[] = [];
  for (const e of events) {
    for (const d of occurrences(e, from, to)) {
      items.push({ key: `${e.id}:${d}`, date: d, time: e.allDay ? '' : e.time, title: eventTitle(e), color: e.color || EVENT_TYPES[e.type].color, event: e });
    }
  }
  for (const t of trainings) {
    const d = t.date.slice(0, 10);
    if (d < from || d > to) continue;
    items.push({ key: t.id, date: d, time: t.date.slice(11, 16), title: t.title, color: EVENT_TYPES.training.color, training: t });
  }
  return items.sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
}

/** « Aujourd'hui », « Demain », « Samedi » (dans la semaine) ou « sam. 4 oct. ». */
export function relativeDay(ymd: string) {
  const today = fromYMD(toYMD(new Date()));
  const d = fromYMD(ymd);
  const diff = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff > 1 && diff < 7) {
    const w = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d.getDay()];
    return w;
  }
  return `${WEEKDAYS_SHORT[d.getDay()].toLowerCase()}. ${d.getDate()} ${MONTHS_LONG[d.getMonth()].slice(0, 4).replace(/\.$/, '')}${MONTHS_LONG[d.getMonth()].length > 4 ? '.' : ''}`;
}

export const formatTime = (t: string) => (t ? t.replace(':', 'h') : '');
