import { CheckCircle2, Home, MapPin, Plane } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnswerButtons } from '../components/Tickets';
import { Spinner, useAsync } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { AVAIL, mapsUrl, momentLabel } from '../lib/convocations';
import { formatTime } from '../lib/events';
import type { Availability, ConvEventInfo } from '../lib/types';
import { longDate } from './Convocation';

interface View extends ConvEventInfo {
  team: { category: string; color: string };
  club: string;
  child: { firstName: string };
  availability: { status: Availability } | null;
  published: boolean;
  convoked: boolean;
  timeline: { answerBy: number | null; deadline: number; start: number };
  closed: boolean;
}

/** Réponse aux disponibilités depuis un lien (SMS, WhatsApp), sans compte. */
export function Answer() {
  const { token } = useParams();
  const q = useAsync(() => api.get<View>(`/public/answer/${token}`), [token]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.loading && !q.data) return <Spinner fill />;
  if (!q.data)
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Lien expiré</h1>
          <p className="lead">{q.error}</p>
        </div>
      </div>
    );
  const v = q.data;
  const answer = async (status: Availability) => {
    setBusy(true);
    setError(null);
    try {
      q.setData(await api.post<View>(`/public/answer/${token}`, { status }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="answer-page">
      <div className="answer-card">
        <div className="row" style={{ gap: 10, marginBottom: 18 }}>
          <span className="team-badge" style={{ width: 40, height: 40, background: v.team.color, fontSize: 13 }}>
            {v.team.category.replace(/\s+/g, '')}
          </span>
          <div>
            <b>{v.club}</b>
            <small className="muted" style={{ display: 'block' }}>
              {v.team.category}
            </small>
          </div>
        </div>
        <h1>{v.title}</h1>
        <p className="answer-when">
          {longDate(v.date)}
          {v.time ? ` · ${formatTime(v.time)}` : ''}
          {v.venue === 'home' && (
            <span className="badge" style={{ marginLeft: 8 }}>
              <Home /> Domicile
            </span>
          )}
          {v.venue === 'away' && (
            <span className="badge" style={{ marginLeft: 8 }}>
              <Plane /> Extérieur
            </span>
          )}
        </p>
        {v.location && (
          <a className="tk-line" href={mapsUrl(v.location)} target="_blank" rel="noreferrer" style={{ padding: '6px 0' }}>
            <MapPin size={15} /> {v.location}
          </a>
        )}

        {v.published ? (
          <div className={`answer-result ${v.convoked ? 'in' : 'out'}`}>
            <CheckCircle2 />
            <div>
              <b>{v.convoked ? `${v.child.firstName} est dans le groupe` : `${v.child.firstName} n’est pas dans le groupe cette fois`}</b>
              <small>{v.convoked ? (v.meetTime ? `Début ${formatTime(v.meetTime)}. ${v.bring}` : v.bring) : 'Les convocations tournent pour que chacun joue autant.'}</small>
            </div>
          </div>
        ) : v.closed ? (
          <p className="muted" style={{ marginTop: 20 }}>Ce match a eu lieu.</p>
        ) : (
          <>
            <h2 className="answer-q">{v.child.firstName} sera là ?</h2>
            <AnswerButtons value={v.availability?.status ?? null} onAnswer={answer} busy={busy} />
            {v.availability && (
              <p className="answer-ok">
                <CheckCircle2 size={16} /> Réponse enregistrée : <b>{AVAIL[v.availability.status].label.toLowerCase()}</b>. Vous pouvez la modifier jusqu’au match.
              </p>
            )}
            {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
            <p className="small muted" style={{ marginTop: 18 }}>
              {v.timeline.answerBy && <>Réponse souhaitée {momentLabel(v.timeline.answerBy)}. </>}
              La convocation sera publiée au plus tard <b>{momentLabel(v.timeline.deadline)}</b>.
            </p>
          </>
        )}
      </div>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>
        LevelUp · recevez les convocations directement sur votre téléphone en rejoignant l’app du club.
      </p>
    </div>
  );
}
