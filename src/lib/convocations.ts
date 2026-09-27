import type { Availability, ConvPhase, ConvSettings, TeamEvent } from './types';

/** Mêmes valeurs par défaut que le serveur (server/convocations.js). */
export const DEFAULT_SETTINGS: ConvSettings = {
  request: { on: true, days: 5, time: '18:00' },
  reminders: [{ days: 4, time: '19:00' }],
  answerBy: { on: true, days: 3, time: '12:00' },
  deadline: { days: 3, time: '20:00' },
  coachAlert: 24,
  escalate: true,
  eve: { on: true, days: 1, time: '18:00' },
  squad: 10,
  onField: 8,
  periods: 2,
  periodMinutes: 25,
  stats: true,
  bring: 'Tenue du club, protège-tibias, gourde',
};

export const CONV_TYPES = ['match', 'plateau', 'tournament'];

export function at(ymd: string, days: number, time: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d - days, hh || 0, mm || 0).getTime();
}

/** Calendrier d'une convocation (identique au calcul du serveur). */
export function timelineOf(e: Pick<TeamEvent, 'allDay' | 'time'>, date: string, s: ConvSettings) {
  const start = at(date, 0, e.allDay || !e.time ? '09:00' : e.time);
  const deadline = Math.min(at(date, s.deadline.days, s.deadline.time), start);
  return {
    request: s.request.on ? Math.min(at(date, s.request.days, s.request.time), deadline) : null,
    reminders: s.reminders.map((r) => at(date, r.days, r.time)).filter((t) => t < deadline).sort((a, b) => a - b),
    answerBy: s.answerBy.on ? Math.min(at(date, s.answerBy.days, s.answerBy.time), deadline) : null,
    deadline,
    coachAlert: deadline - s.coachAlert * 3600e3,
    eve: s.eve.on ? at(date, s.eve.days || 1, s.eve.time) : null,
    start,
  };
}

const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WD_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const hourLabel = (d: Date) => `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;

/** « aujourd'hui 18h », « demain 20h », « mercredi 20h » (dans la semaine), sinon « mer. 8 oct. 20h ». */
export function momentLabel(ts: number, withHour = true) {
  const d = new Date(ts);
  const diff = Math.round((dayStart(d) - dayStart(new Date())) / 864e5);
  let day: string;
  if (diff === 0) day = 'aujourd’hui';
  else if (diff === 1) day = 'demain';
  else if (diff === -1) day = 'hier';
  else if (diff > 1 && diff < 7) day = WD[d.getDay()];
  else day = `${WD_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withHour ? `${day} ${hourLabel(d)}` : day;
}

/** Position relative à la date du match : « J-5 · lun. 18h ». */
export function relativeTo(ts: number, start: number) {
  const days = Math.round((dayStart(new Date(start)) - dayStart(new Date(ts))) / 864e5);
  const d = new Date(ts);
  return { j: days === 0 ? 'Jour J' : `J-${days}`, label: `${WD_SHORT[d.getDay()]} ${hourLabel(d)}` };
}

/** « dans 2 j », « dans 5 h », « dans 20 min » ou « il y a 3 h ». */
export function countdown(ts: number) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const v = abs >= 864e5 ? `${Math.floor(abs / 864e5)} j` : abs >= 3600e3 ? `${Math.floor(abs / 3600e3)} h` : `${Math.max(1, Math.floor(abs / 60e3))} min`;
  return diff >= 0 ? `dans ${v}` : `il y a ${v}`;
}

export const AVAIL: Record<Availability | 'none', { label: string; short: string; tone: string }> = {
  yes: { label: 'Disponible', short: 'Dispo', tone: 'green' },
  maybe: { label: 'Incertain', short: 'Incertain', tone: 'warn' },
  no: { label: 'Indisponible', short: 'Absent', tone: 'red' },
  none: { label: 'Sans réponse', short: 'Attente', tone: '' },
};

export const PHASE: Record<ConvPhase, { label: string; tone: string }> = {
  upcoming: { label: 'À venir', tone: '' },
  collecting: { label: 'Disponibilités en cours', tone: 'blue' },
  late: { label: 'Convocation en retard', tone: 'red' },
  published: { label: 'Convocation publiée', tone: 'green' },
  played: { label: 'Joué', tone: '' },
  missed: { label: 'Jamais publiée', tone: 'red' },
};

export const matchPath = (eventId: string, date: string) => `/matchs/${eventId}/${date}`;

/** Lien Maps pour un lieu. */
export const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export const answerUrl = (token: string) => `${location.origin}/r/${token}`;
