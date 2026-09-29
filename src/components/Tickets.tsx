import { Backpack, Car, Check, ChevronDown, CircleHelp, Clock, Home, MapPin, MessageCircle, Navigation, Plane, Trophy, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AVAIL, countdown, mapsUrl, matchPath, momentLabel } from '../lib/convocations';
import { MONTHS_TILE, formatTime, fromYMD } from '../lib/events';
import type { Availability, Ticket } from '../lib/types';
import { CarpoolPanel } from './Carpool';
import { useToast } from './ui';

const WD = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];

function DateBlock({ date }: { date: string }) {
  const d = fromYMD(date);
  return (
    <div className="tk-date">
      <small>{WD[d.getDay()]}</small>
      <b>{d.getDate()}</b>
      <small>{MONTHS_TILE[d.getMonth()]}</small>
    </div>
  );
}

/** Boutons de réponse : trois gros boutons, un seul geste. */
export function AnswerButtons({ value, onAnswer, busy }: { value: Availability | null; onAnswer: (a: Availability) => void; busy?: boolean }) {
  return (
    <div className="answer-row">
      <button className={`answer yes${value === 'yes' ? ' on' : ''}`} disabled={busy} onClick={() => onAnswer('yes')}>
        <Check /> Présent
      </button>
      <button className={`answer maybe${value === 'maybe' ? ' on' : ''}`} disabled={busy} onClick={() => onAnswer('maybe')}>
        <CircleHelp /> Incertain
      </button>
      <button className={`answer no${value === 'no' ? ' on' : ''}`} disabled={busy} onClick={() => onAnswer('no')}>
        <X /> Absent
      </button>
    </div>
  );
}

function Steps({ t }: { t: Ticket }) {
  const now = Date.now();
  const steps = [
    { label: 'Dispos', done: !!t.availability || !!t.publishedAt, hint: t.timeline.answerBy ? `avant ${momentLabel(t.timeline.answerBy)}` : '' },
    { label: 'Convocation', done: !!t.publishedAt, hint: t.publishedAt ? momentLabel(t.publishedAt, false) : `au plus tard ${momentLabel(t.timeline.deadline)}` },
    { label: 'Match', done: now > t.timeline.start || !!t.result, hint: '' },
    { label: 'Résumé', done: !!t.result, hint: '' },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="tk-steps">
      {steps.map((s, i) => (
        <li key={s.label} className={s.done ? 'done' : i === current ? 'now' : ''}>
          <i>{s.done ? <Check size={11} strokeWidth={3.5} /> : null}</i>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

const BAND: Record<Ticket['status'], string> = {
  to_answer: 'ask',
  answered: 'wait',
  convoked: 'in',
  not_selected: 'out',
  past: 'out',
};

/** Billet de match d'un enfant : en un coup d'œil, convoqué ou non, où et quand. */
export function MatchTicket({ t, onChanged, showChild = true, carpool: carpoolOpen = false }: { t: Ticket; onChanged: () => void; showChild?: boolean; carpool?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState(false);
  const [squad, setSquad] = useState(false);
  const [carpool, setCarpool] = useState(carpoolOpen);
  const name = t.child.firstName;

  // Accusé de lecture : le parent a vu la convocation publiée.
  useEffect(() => {
    if (t.publishedAt && !t.read) void api.post(`/convocations/${t.eventId}/${t.date}/read`).catch(() => undefined);
  }, [t.publishedAt, t.read, t.eventId, t.date]);

  const answer = async (status: Availability) => {
    setBusy(true);
    try {
      await api.put(`/convocations/${t.eventId}/${t.date}/availability/${t.child.id}`, { status });
      toast(status === 'yes' ? `${name} : présent 👍` : status === 'no' ? `${name} : absent, merci d’avoir prévenu` : `${name} : incertain`);
      setChange(false);
      onChanged();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  let head: { title: string; sub: string };
  switch (t.status) {
    case 'to_answer':
      head = { title: `${name} sera là ?`, sub: t.timeline.answerBy ? `Réponse souhaitée ${momentLabel(t.timeline.answerBy)}` : 'Répondez en un geste' };
      break;
    case 'answered':
      head = { title: `Réponse envoyée : ${AVAIL[t.availability!.status].label.toLowerCase()}`, sub: `Convocation publiée au plus tard ${momentLabel(t.timeline.deadline)}` };
      break;
    case 'convoked':
      head = { title: `${name} est dans le groupe`, sub: t.meetTime ? `Rendez-vous ${formatTime(t.meetTime)}` : `Coup d’envoi ${formatTime(t.time)}` };
      break;
    case 'not_selected':
      head = { title: `${name} n’est pas dans le groupe cette fois`, sub: 'Les convocations tournent pour que chacun joue autant.' };
      break;
    default:
      head = { title: 'Match passé', sub: '' };
  }
  const plateau = t.result?.games?.filter((g) => g.us !== null);
  const record = plateau ? `${plateau.filter((g) => g.us! > g.them!).length} V · ${plateau.filter((g) => g.us === g.them).length} N · ${plateau.filter((g) => g.us! < g.them!).length} D` : '';
  if (t.result) head = { title: plateau ? record : `${t.result.us} – ${t.result.them}`, sub: t.result.minutes !== null ? `${name} a joué ${t.result.minutes} min${t.result.goals ? ` · ⚽ ${t.result.goals}` : ''}` : head.title };

  const canAnswer = !t.publishedAt && Date.now() < t.timeline.start;

  return (
    <article className={`ticket band-${t.result ? 'result' : BAND[t.status]}`}>
      <header className="tk-band">
        <span className="tk-ic">
          {t.result ? <Trophy /> : t.status === 'convoked' ? <Check strokeWidth={3} /> : t.status === 'to_answer' ? <CircleHelp /> : t.status === 'answered' ? <Clock /> : <Users />}
        </span>
        <div className="grow">
          <b>{head.title}</b>
          {head.sub && <small>{head.sub}</small>}
        </div>
        {showChild && <span className="tk-child">{name}</span>}
      </header>

      <Link to={matchPath(t.eventId, t.date)} className="tk-body">
        <DateBlock date={t.date} />
        <div className="grow">
          <b className="tk-title">{t.group ? `${t.group} · ${t.title}` : t.title}</b>
          <div className="tk-meta">
            {t.venue === 'home' && (
              <span>
                <Home size={13} /> Domicile
              </span>
            )}
            {t.venue === 'away' && (
              <span>
                <Plane size={13} /> Extérieur
              </span>
            )}
            {t.time && <span>Coup d’envoi {formatTime(t.time)}</span>}
          </div>
          {t.status === 'convoked' && t.meetTime && !t.result && (
            <div className="tk-meet">
              RDV <b>{formatTime(t.meetTime)}</b>
              <small>{countdown(new Date(`${t.date}T${t.meetTime}`).getTime())}</small>
            </div>
          )}
        </div>
      </Link>

      <div className="tk-info">
        {t.location && (
          <a className="tk-line" href={mapsUrl(t.location)} target="_blank" rel="noreferrer">
            <MapPin size={15} />
            <span className="grow">{t.location}</span>
            <span className="tk-go">
              <Navigation size={13} /> Itinéraire
            </span>
          </a>
        )}
        {t.status === 'convoked' && t.bring && !t.result && (
          <div className="tk-line">
            <Backpack size={15} />
            <span className="grow">{t.bring}</span>
          </div>
        )}
        {t.message && !t.result && (
          <div className="tk-line">
            <MessageCircle size={15} />
            <span className="grow">{t.message}</span>
          </div>
        )}
        {t.result?.summary && (
          <div className="tk-line">
            <MessageCircle size={15} />
            <span className="grow">
              <i>« {t.result.summary} »</i>
            </span>
          </div>
        )}
      </div>

      {t.status === 'convoked' && !t.result && (
        <div className="tk-action">
          <Link to={`${matchPath(t.eventId, t.date)}/paquet`} className="pack-cta" style={{ ['--team' as string]: t.color || undefined }}>
            <span className="grow">
              <b>{t.read ? `Revoir le paquet de ${name}` : `${name} a reçu un paquet !`}</b>
              <small>{t.read ? 'Sa carte de convoqué et le groupe du match' : 'Ouvrez-le ensemble pour découvrir sa carte'}</small>
            </span>
            <span className="pack-cta-go">🎁</span>
          </Link>
        </div>
      )}
      {t.result && t.result.minutes !== null && (
        <div className="tk-action">
          <Link to={`${matchPath(t.eventId, t.date)}/cartes`} className="cards-cta">
            <span className="cards-cta-stack" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="grow">
              <b>Découvrir la carte de {name}</b>
              <small>Retournez les cartes et découvrez sa récompense</small>
            </span>
            <span className="cards-cta-go">🃏</span>
          </Link>
        </div>
      )}
      {(t.status === 'to_answer' || change) && canAnswer && (
        <div className="tk-action">
          <AnswerButtons value={t.availability?.status ?? null} onAnswer={answer} busy={busy} />
        </div>
      )}
      {t.status === 'answered' && !change && canAnswer && (
        <button className="tk-change" onClick={() => setChange(true)}>
          Modifier ma réponse
        </button>
      )}
      {t.publishedAt && t.squad.length > 0 && !t.result && (
        <div className="tk-squad">
          <button onClick={() => setSquad((s) => !s)} aria-expanded={squad}>
            <Users size={14} /> {t.squad.length} convoqués <ChevronDown size={14} className={squad ? 'rot' : ''} />
          </button>
          {squad && (
            <div className="tk-names">
              {t.squad.map((p) => (
                <span key={p.id} className={p.id === t.child.id ? 'me' : ''}>
                  {p.firstName}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!t.result && Date.now() < t.timeline.start && t.status !== 'not_selected' && (
        <div className="tk-carpool">
          {carpool ? (
            <CarpoolPanel eventId={t.eventId} date={t.date} compact />
          ) : (
            <button className="tk-carpool-btn" onClick={() => setCarpool(true)}>
              <Car size={16} /> <span className="grow">Covoiturage</span> <small>Proposer ou trouver une place</small>
            </button>
          )}
        </div>
      )}
      <footer>
        <Steps t={t} />
      </footer>
    </article>
  );
}

/** Rail des billets à venir (accueil parent). */
export function TicketRail({ tickets, onChanged }: { tickets: Ticket[]; onChanged: () => void }) {
  const multi = new Set(tickets.map((t) => t.child.id)).size > 1;
  return (
    <div className="tk-rail">
      {tickets.map((t) => (
        <MatchTicket key={t.key} t={t} onChanged={onChanged} showChild={multi} />
      ))}
    </div>
  );
}
