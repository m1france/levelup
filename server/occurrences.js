/**
 * Dates d'un événement récurrent, côté serveur (même logique que src/lib/events.ts).
 * Les heures sont locales au serveur : index.js fixe TZ=Europe/Paris par défaut.
 */

export const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromYMD = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
export const todayYMD = () => toYMD(new Date());
export const ymdAdd = (ymd, n) => toYMD(addDays(fromYMD(ymd), n));

/** Début de saison : 1er août. */
export function seasonStart(d = new Date()) {
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-08-01`;
}

/** Horodatage local d'un jour J moins `days` jours, à l'heure HH:MM. */
export function at(ymd, days, time) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d - days, hh || 0, mm || 0).getTime();
}

export function occurrences(e, from, to) {
  const r = e.recurrence ?? { freq: 'none', interval: 1, days: [], until: null, count: null };
  const out = [];
  const ex = new Set(e.exdates ?? []);
  const until = r.until && r.until < to ? r.until : to;
  let n = 0;
  const push = (d) => {
    n++;
    if (d >= from && d <= until && !ex.has(d)) out.push(d);
  };
  const done = (d) => d > until || (r.count !== null && r.count !== undefined && n >= r.count);

  if (!r.freq || r.freq === 'none') {
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
      if (start.getDate() > last) continue;
      const d = toYMD(new Date(d0.getFullYear(), d0.getMonth(), start.getDate(), 12));
      if (done(d)) break;
      push(d);
    } else {
      const days = r.days?.length ? [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [start.getDay()];
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

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const hm = (t) => (t ? t.replace(':', 'h') : '');

/** « samedi 4 oct. » */
export function dayLabel(ymd) {
  const d = fromYMD(ymd);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** « samedi » si dans la semaine qui vient, sinon « samedi 4 oct. ». */
export function shortDay(ymd) {
  const diff = Math.round((fromYMD(ymd) - fromYMD(todayYMD())) / 864e5);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff > 1 && diff < 7) return WEEKDAYS[fromYMD(ymd).getDay()];
  return dayLabel(ymd);
}

/** « mercredi 20h » à partir d'un horodatage. */
export function momentLabel(ts) {
  const d = new Date(ts);
  const day = shortDay(toYMD(d));
  return `${day} ${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
}
