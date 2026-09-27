import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { matchPath } from '../lib/convocations';
import { MONTHS_LONG, formatTime, fromYMD, toYMD } from '../lib/events';
import type { ConvSnapshot } from '../lib/types';
import { useMatchMenu } from './MatchActions';

const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WD_LONG = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const month = (d: Date) => MONTHS_SHORT[d.getMonth()];

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

/** Carte compacte d'un match : la date, l'heure et les réponses (ou les convoqués), rien d'autre. */
function MatchChip({ c }: { c: ConvSnapshot }) {
  const nav = useNavigate();
  const d = fromYMD(c.date);
  const published = c.phase === 'published' || c.phase === 'played';
  const answered = c.counts.yes + c.counts.maybe + c.counts.no;
  const past = c.phase === 'played' || c.timeline.start < Date.now();
  const { bind, menu } = useMatchMenu(c);
  return (
    <>
    {menu}
    <button
      {...bind}
      className={`wk-card${past ? ' past' : ''}`}
      onClick={() => nav(matchPath(c.eventId, c.date))}
      title={c.title}
      aria-label={`${c.title}, ${WD_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`}
    >
      <span className="wk-date">
        {WD_LONG[d.getDay()]} {d.getDate()} {month(d)}
      </span>
      <b className="wk-time">{c.time ? formatTime(c.time) : 'Journée'}</b>
      <span className="wk-count">
        {published ? (
          <>
            <strong>{c.selected}</strong> convoqué{c.selected > 1 ? 's' : ''}
          </>
        ) : (
          <>
            <strong>
              {answered}/{c.total}
            </strong>{' '}
            réponses
          </>
        )}
      </span>
    </button>
    </>
  );
}

/**
 * La semaine en un coup d'œil : un jour par colonne, les matchs du jour en cartes.
 * Sur les côtés, deux boutons discrets sautent à la semaine du dernier match joué ou des prochains matchs.
 */
export function WeekTimeline({ list }: { list: ConvSnapshot[] }) {
  const today = toYMD(new Date());
  const [start, setStart] = useState(() => mondayOf(today));
  const end = addDays(start, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const sorted = useMemo(() => [...list].sort((a, b) => a.timeline.start - b.timeline.start), [list]);
  const before = [...sorted].reverse().find((c) => c.date < start);
  const after = sorted.find((c) => c.date > end);
  const first = fromYMD(start);
  const last = fromYMD(end);
  const current = start === mondayOf(today);

  return (
    <section className="wk">
      <div className="wk-head">
        <h2>
          {current ? 'Cette semaine' : `Semaine du ${first.getDate()}${first.getMonth() !== last.getMonth() ? ` ${month(first)}` : ''} au ${last.getDate()} ${month(last)}`}
        </h2>
        {!current && (
          <button className="plain-toggle" onClick={() => setStart(mondayOf(today))}>
            Revenir à aujourd’hui
          </button>
        )}
      </div>
      <div className="wk-body">
        <button className="wk-side left" disabled={!before} onClick={() => before && setStart(mondayOf(before.date))} title={before ? `Dernier match : ${before.title}` : 'Aucun match avant'}>
          <ChevronLeft size={16} />
          <span>Dernier match</span>
        </button>
        <div className="wk-days">
          {days.map((d, i) => {
            const matches = sorted.filter((c) => c.date === d);
            const date = fromYMD(d);
            return (
              <div key={d} className={`wk-day${d === today ? ' today' : ''}${d < today ? ' gone' : ''}${matches.length ? '' : ' empty'}`}>
                <div className="wk-dlabel">
                  <small>{WD[i]}</small>
                  <b>{date.getDate()}</b>
                </div>
                <div className="wk-cards">
                  {matches.map((c) => (
                    <MatchChip key={`${c.eventId}:${c.date}`} c={c} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <button className="wk-side right" disabled={!after} onClick={() => after && setStart(mondayOf(after.date))} title={after ? `Prochain match : ${after.title}` : 'Aucun match après'}>
          <span>Prochains matchs</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}
