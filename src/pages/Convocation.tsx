import {
  ArrowLeft, Bell, BellOff, Check, CircleHelp, Clock, Copy, Eye, Image as ImageIcon, Link2, MapPin, Megaphone, MessageCircle,
  Minus, Play, Send, Sparkles, TrendingDown, TrendingUp, Trophy, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CarpoolPanel } from '../components/Carpool';
import { MatchTicket } from '../components/Tickets';
import { GamesResults } from '../components/Plateau';
import { Empty, Field, Menu, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import { renderConvCard, shareCard } from '../lib/convCard';
import { AVAIL, PHASE, answerUrl, countdown, mapsUrl, momentLabel } from '../lib/convocations';
import { MONTHS_LONG, MONTHS_TILE, formatTime, fromYMD } from '../lib/events';
import { useLive } from '../lib/live';
import { playerName, useApp } from '../lib/store';
import type { Availability, ConvDetail, ConvPlayer, Ticket } from '../lib/types';

type Payload = ({ kind: 'staff' } & ConvDetail) | { kind: 'parent'; tickets: Ticket[] };

const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const longDate = (ymd: string) => {
  const d = fromYMD(ymd);
  return `${WD[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
};

export function ConvocationPage() {
  const { eventId, date } = useParams();
  const q = useAsync(() => api.get<Payload>(`/convocations/${eventId}/${date}`), [eventId, date]);
  const [params] = useSearchParams();
  useLive((m) => m.t === 'conv' && m.eventId === eventId && m.date === date && q.reload());
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Match introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/matchs">Retour</Link>} />
      </div>
    );
  if (q.data.kind === 'parent') {
    return (
      <div className="page narrow">
        <Link to="/matchs" className="back">
          <ArrowLeft size={15} /> Matchs
        </Link>
        <div className="stack" style={{ gap: 18 }}>
          {q.data.tickets.map((t) => (
            <MatchTicket key={t.key} t={t} onChanged={q.reload} carpool={params.has('covoiturage')} />
          ))}
        </div>
      </div>
    );
  }
  return <StaffConvocation d={q.data} reload={q.reload} setData={(d) => q.setData({ kind: 'staff', ...d })} />;
}

/* ------------------------------------------------------------------ frise des étapes */

function Progress({ d, onRequest, busy }: { d: ConvDetail; onRequest: (reminder: boolean) => void; busy: boolean }) {
  const now = Date.now();
  const t = d.timeline;
  const missing = d.counts.none;
  const steps = [
    t.request !== null && {
      label: 'Dispos demandées', at: t.request, done: d.requestSent || now >= t.request,
      action: !d.requestSent && !d.publishedAt ? { label: 'Demander maintenant', fn: () => onRequest(false) } : null,
    },
    ...t.reminders.map((r, i) => ({
      label: t.reminders.length > 1 ? `Relance ${i + 1}` : 'Relance', at: r, done: now >= r,
      action: null as null | { label: string; fn: () => void },
    })),
    t.answerBy !== null && { label: 'Réponses parents', at: t.answerBy, done: now >= t.answerBy, action: null },
    {
      label: 'Convocation', at: d.publishedAt ?? t.deadline, done: !!d.publishedAt, late: !d.publishedAt && now > t.deadline, deadline: !d.publishedAt, action: null,
    },
    { label: 'Match', at: t.start, done: now >= t.start, action: null },
  ].filter(Boolean) as { label: string; at: number; done: boolean; late?: boolean; deadline?: boolean; action: null | { label: string; fn: () => void } }[];
  const cur = steps.findIndex((s) => !s.done);
  return (
    <div className="conv-progress">
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={`${s.done ? 'done' : ''}${i === cur ? ' now' : ''}${s.late ? ' late' : ''}`}>
            <i>{s.done ? <Check size={12} strokeWidth={3.5} /> : null}</i>
            <b>{s.label}</b>
            <small>
              {s.deadline ? 'avant ' : ''}
              {momentLabel(s.at)}
            </small>
            {i === cur && !s.done && <em>{countdown(s.at)}</em>}
          </li>
        ))}
      </ol>
      {!d.publishedAt && (
        <div className="row wrap" style={{ gap: 8 }}>
          {!d.requestSent ? (
            <button className="btn sm" disabled={busy} onClick={() => onRequest(false)}>
              <Send /> Demander les dispos maintenant
            </button>
          ) : (
            missing > 0 && (
              <button className="btn sm" disabled={busy} onClick={() => onRequest(true)}>
                <Bell /> Relancer les {missing} sans réponse
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ligne joueur */

function PlayedBar({ m, mean, max }: { m: ConvPlayer['metrics']; mean: number; max: number }) {
  const scale = Math.max(1, max);
  return (
    <span className="played-bar" title={`${m.played} match${m.played > 1 ? 's' : ''} joué${m.played > 1 ? 's' : ''} · moyenne ${mean}`}>
      <i style={{ width: `${(m.played / scale) * 100}%` }} className={m.delta <= -1 ? 'low' : m.delta >= 1 ? 'high' : ''} />
      <u style={{ left: `${(mean / scale) * 100}%` }} />
    </span>
  );
}

function AvailPill({ p, canEdit, onSet }: { p: ConvPlayer; canEdit: boolean; onSet: (s: Availability | null) => void }) {
  const a = p.availability?.status ?? 'none';
  const pill = (
    <span className={`badge ${AVAIL[a].tone}`} title={p.availability ? `${AVAIL[a].label}${p.availability.by ? ` · ${p.availability.by}` : ' · via le lien'}${p.availability.note ? ` · « ${p.availability.note} »` : ''}` : 'Sans réponse'}>
      {a === 'yes' ? <Check /> : a === 'no' ? <X /> : a === 'maybe' ? <CircleHelp /> : <Minus />}
      <span className="hide-mobile">{AVAIL[a].short}</span>
    </span>
  );
  if (!canEdit) return pill;
  return (
    <Menu
      trigger={(open) => (
        <button className="pill-btn" onClick={open} aria-label="Changer la disponibilité">
          {pill}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">Réponse donnée de vive voix</div>
          {(['yes', 'maybe', 'no'] as Availability[]).map((s) => (
            <button key={s} onClick={() => (onSet(s), close())}>
              {s === 'yes' ? <Check /> : s === 'no' ? <X /> : <CircleHelp />} {AVAIL[s].label}
            </button>
          ))}
          {p.availability && (
            <button onClick={() => (onSet(null), close())}>
              <Minus /> Effacer la réponse
            </button>
          )}
        </>
      )}
    </Menu>
  );
}

function PlayerRow({
  p, selected, suggested, mean, max, canEdit, onToggle, onAvail, onCopyLink, published,
}: {
  p: ConvPlayer; selected: boolean; suggested: boolean; mean: number; max: number; canEdit: boolean; published: boolean;
  onToggle: () => void; onAvail: (s: Availability | null) => void; onCopyLink: () => void;
}) {
  const m = p.metrics;
  const readers = p.parents.filter((u) => u.readAt).length;
  const push = p.parents.some((u) => u.push);
  return (
    <div className={`cv-row${selected ? ' on' : ''}${p.availability?.status === 'no' ? ' out' : ''}`}>
      <button className="cv-pick" onClick={onToggle} disabled={!canEdit} aria-pressed={selected} aria-label={selected ? `Retirer ${p.firstName}` : `Convoquer ${p.firstName}`}>
        {selected ? <Check strokeWidth={3} /> : null}
      </button>
      <div className="cv-who">
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/joueurs/${p.id}`} className="cv-name ellipsis">
            {playerName(p)}
          </Link>
          {suggested && !selected && (
            <span className="cv-spark" title="Proposé par la suggestion équitable">
              <Sparkles size={13} />
            </span>
          )}
        </div>
        {p.reasons.length > 0 && (
          <div className="cv-reasons">
            {p.reasons.slice(0, 2).map((r, i) => (
              <span key={i} className={r.tone}>
                {r.tone === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {r.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="cv-metrics hide-mobile">
        <PlayedBar m={m} mean={mean} max={max} />
        <small>
          <b>{m.played}</b> joué{m.played > 1 ? 's' : ''} · {m.minutes} min
          {m.notSelected ? ` · ${m.notSelected} non retenu` : ''}
        </small>
      </div>
      <div className="cv-side">
        <span className="cv-played" title="Matchs joués">{m.played}</span>
        <AvailPill p={p} canEdit={canEdit} onSet={onAvail} />
        <span className="cv-parent" title={p.parents.length ? p.parents.map((u) => `${u.name}${u.push ? ' · notifications activées' : ''}${u.readAt ? ` · lu ${momentLabel(u.readAt)}` : ''}`).join('\n') : 'Aucun parent inscrit'}>
          {published && p.parents.length ? (
            <Eye size={15} className={readers ? 'ok' : ''} />
          ) : p.parents.length ? (
            push ? <Bell size={15} className="ok" /> : <BellOff size={15} />
          ) : (
            <Link2 size={15} />
          )}
        </span>
        {!p.availability && !published && canEdit && (
          <button className="btn icon sm ghost" onClick={onCopyLink} aria-label={`Copier le lien de réponse de ${p.firstName}`} title="Copier le lien de réponse (sans compte)">
            <Copy />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page éducateur */

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function StaffConvocation({ d, reload, setData }: { d: ConvDetail; reload: () => void; setData: (d: ConvDetail) => void }) {
  const { me, can } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const canEdit = can('convocations.manage');
  const team = me.teams.find((t) => t.id === d.teamId);
  const [sel, setSel] = useState<Set<string>>(() => new Set(d.selection));
  const [message, setMessage] = useState(d.message);
  const [meet, setMeet] = useState(d.meetTime);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle');
  const dirty = useRef(false);

  // Nouvelle version du serveur (autre éducateur, réponse d'un parent) : on reprend la sélection enregistrée.
  useEffect(() => {
    if (!dirty.current) {
      setSel(new Set(d.selection));
      setMessage(d.message);
      setMeet(d.meetTime);
    }
  }, [d.selection, d.message, d.meetTime]);

  // Enregistrement automatique du brouillon.
  useEffect(() => {
    if (!dirty.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const out = await api.put<ConvDetail>(`/convocations/${d.eventId}/${d.date}`, { selection: [...sel], message, meetTime: meet });
        dirty.current = false;
        setSaving('idle');
        setData(out);
      } catch {
        setSaving('error');
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, message, meet]);

  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    dirty.current = true;
    fn(v);
  };
  const toggle = (id: string) =>
    edit<string>((pid) =>
      setSel((s) => {
        const n = new Set(s);
        if (n.has(pid)) n.delete(pid);
        else n.add(pid);
        return n;
      }),
    )(id);

  const suggestion = new Set(d.suggestion);
  const published = !!d.publishedAt;
  const mean = d.stats.mean;
  const max = Math.max(1, ...d.players.map((p) => p.metrics.played));

  const groups = useMemo(() => {
    const order = (a: ConvPlayer, b: ConvPlayer) => (a.rank === -1 ? 999 : a.rank) - (b.rank === -1 ? 999 : b.rank);
    const by = (s: Availability | 'none') => d.players.filter((p) => (p.availability?.status ?? 'none') === s).sort(order);
    return [
      { key: 'yes', label: 'Disponibles', list: by('yes') },
      { key: 'maybe', label: 'Incertains', list: by('maybe') },
      { key: 'none', label: 'Sans réponse', list: by('none') },
      { key: 'no', label: 'Indisponibles', list: by('no') },
    ].filter((g) => g.list.length);
  }, [d.players]);

  // Écart entre le plus et le moins convoqué, avant / après cette sélection.
  const spread = useMemo(() => {
    const pool = d.players.filter((p) => p.metrics.matches > 0 || sel.has(p.id));
    if (pool.length < 2) return null;
    const before = pool.map((p) => p.metrics.played);
    const after = pool.map((p) => p.metrics.played + (sel.has(p.id) ? 1 : 0));
    const diff = (a: number[]) => Math.max(...a) - Math.min(...a);
    return { before: diff(before), after: diff(after) };
  }, [d.players, sel]);

  const setAvail = async (pid: string, status: Availability | null) => {
    try {
      await api.put(`/convocations/${d.eventId}/${d.date}/availability/${pid}`, { status });
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const request = async (reminder: boolean) => {
    setBusy(true);
    try {
      const r = await api.post<{ sent: number }>(`/convocations/${d.eventId}/${d.date}/request`, { onlyMissing: reminder });
      toast(r.sent ? `${r.sent} parent${r.sent > 1 ? 's' : ''} prévenu${r.sent > 1 ? 's' : ''}` : 'Aucun parent inscrit à prévenir : partagez les liens de réponse');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = () => {
    edit<Set<string>>(setSel)(new Set(d.suggestion));
    toast('Sélection équitable appliquée');
  };

  const changes = d.players.filter((p) => (sel.has(p.id) ? 'in' : 'out') !== p.notified);
  const publish = async () => {
    setPublishing(false);
    setBusy(true);
    try {
      if (dirty.current) await api.put(`/convocations/${d.eventId}/${d.date}`, { selection: [...sel], message, meetTime: meet });
      dirty.current = false;
      const out = await api.post<ConvDetail & { sent: number }>(`/convocations/${d.eventId}/${d.date}/publish`);
      setData(out);
      toast(`Convocation publiée · ${out.sent} notification${out.sent > 1 ? 's' : ''} envoyée${out.sent > 1 ? 's' : ''}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const convoked = d.players.filter((p) => sel.has(p.id));
  const card = async () => {
    try {
      const blob = await renderConvCard({
        club: me.club?.name ?? '', team: d.group ?? team?.category ?? '', color: team?.color ?? '#1f6f4a', title: d.title, opponent: d.opponent,
        venue: d.venue === 'home' ? 'Domicile' : d.venue === 'away' ? 'Extérieur' : '', date: d.date, time: d.time, meetTime: meet,
        location: d.location, bring: d.bring, message, players: convoked,
      });
      const r = await shareCard(blob, `convocation-${d.date}`, `Convocation ${d.group ?? team?.category ?? ''} · ${d.title}`);
      if (r === 'downloaded') toast('Image téléchargée');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const textMessage = () =>
    [
      `⚽ *Convocation ${d.group ?? team?.category ?? ''}* · ${d.title}`,
      `📅 ${longDate(d.date)}${meet ? ` · RDV ${formatTime(meet)}` : ''}${d.time ? ` · coup d’envoi ${formatTime(d.time)}` : ''}`,
      d.location ? `📍 ${d.location}` : null,
      '',
      `✅ Convoqués (${convoked.length}) : ${convoked.map((p) => p.firstName).join(', ')}`,
      d.bring ? `🎒 ${d.bring}` : null,
      message ? `💬 ${message}` : null,
    ].filter((l) => l !== null).join('\n');

  const phase = PHASE[d.phase];
  const over = sel.size > d.squad;
  const played = d.phase === 'played' || !!d.match?.finished;

  return (
    <div className="page wide">
      <Link to="/matchs" className="back">
        <ArrowLeft size={15} /> Matchs
      </Link>
      <div className="cv-head">
        <div className="tk-date big">
          <small>{longDate(d.date).split(' ')[0].slice(0, 3).toUpperCase()}</small>
          <b>{fromYMD(d.date).getDate()}</b>
          <small>{MONTHS_TILE[fromYMD(d.date).getMonth()]}</small>
        </div>
        <div className="grow">
          <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
            {d.group && <span className="badge green">{d.group}</span>}
            <span className={`badge ${phase.tone}`}>{phase.label}</span>
            {d.publishedLate && <span className="badge warn">Publiée après la date limite</span>}
          </div>
          <h1>{d.title}</h1>
          <div className="plan-meta">
            {d.time && (
              <span className="meta-pill">
                <Clock /> {formatTime(d.time)}
              </span>
            )}
            {d.location && (
              <a className="meta-pill" href={mapsUrl(d.location)} target="_blank" rel="noreferrer">
                <MapPin /> {d.location}
              </a>
            )}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {canEdit && (
            <button className="btn lg primary" onClick={() => nav(`/matchs/${d.eventId}/${d.date}/live`)}>
              {played ? <Trophy /> : <Play fill="currentColor" />} {played ? 'Feuille de match' : 'Mode match'}
            </button>
          )}
        </div>
      </div>

      {d.score?.games && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <GamesResults
            games={d.score.games.map((g) => ({ id: g.id, opponent: g.opponent, time: g.time, minutes: 0 }))}
            results={d.score.games.map((g) => (g.us === null || g.live ? undefined : { us: g.us, them: g.them! })) as { us: number; them: number }[]}
          />
          {d.summary?.text && <p className="muted" style={{ marginTop: 10, textAlign: 'center' }}>« {d.summary.text} »</p>}
        </div>
      )}
      {d.score && !d.score.games && (
        <div className="cv-score">
          <b>{d.group ?? team?.category}</b>
          <span>
            {d.score.us} – {d.score.them}
          </span>
          <b>{d.opponent || 'Adversaire'}</b>
          {d.summary?.text && <p>« {d.summary.text} »</p>}
        </div>
      )}

      <Progress d={d} onRequest={request} busy={busy} />

      <div className="cv-layout">
        <section className="cv-list">
          <div className="cv-list-head">
            <h2>
              Joueurs <span className="muted">· {d.counts.yes + d.counts.maybe + d.counts.no}/{d.total} réponses</span>
            </h2>
            <div className="avail-bar" aria-hidden>
              <i className="yes" style={{ flex: d.counts.yes }} />
              <i className="maybe" style={{ flex: d.counts.maybe }} />
              <i className="none" style={{ flex: d.counts.none }} />
              <i className="no" style={{ flex: d.counts.no }} />
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.key} className="cv-group">
              <div className="cv-group-head">
                <span className={`dot ${g.key}`} /> {g.label} <small>{g.list.length}</small>
              </div>
              {g.list.map((p) => (
                <PlayerRow
                  key={p.id}
                  p={p}
                  selected={sel.has(p.id)}
                  suggested={suggestion.has(p.id)}
                  mean={mean}
                  max={max}
                  canEdit={canEdit}
                  published={published}
                  onToggle={() => toggle(p.id)}
                  onAvail={(s) => setAvail(p.id, s)}
                  onCopyLink={async () => toast((await copy(answerUrl(p.answerToken))) ? `Lien de ${p.firstName} copié` : answerUrl(p.answerToken))}
                />
              ))}
            </div>
          ))}
          {!d.players.length && <Empty title="Aucun joueur dans l’effectif" action={<Link className="btn" to="/joueurs">Ajouter des joueurs</Link>} />}
        </section>

        <aside className="cv-panel">
          <div className="card cv-box">
            <div className="cv-count">
              <b className={over ? 'warn' : sel.size === d.squad ? 'ok' : ''}>{sel.size}</b>
              <span>/ {d.squad} convoqués</span>
              {canEdit && saving !== 'idle' && <span className={`save-dot ${saving}`} title={saving === 'error' ? 'Non enregistré' : 'Enregistrement…'} />}
            </div>
            {canEdit && (
              <button className="btn block" onClick={applySuggestion} disabled={!d.suggestion.length}>
                <Sparkles /> Suggestion équitable
              </button>
            )}
            <p className="small muted">
              Disponibles d’abord, puis ceux qui ont le moins joué, les non-retenus récents et les moins de minutes.
            </p>
            <div className="equity">
              <Gauge value={d.stats.equity} />
              <div>
                <b>Équité des convocations</b>
                <small>
                  {d.stats.matches
                    ? `Moyenne ${String(mean).replace('.', ',')} match${mean >= 2 ? 's' : ''} joué${mean >= 2 ? 's' : ''} sur ${d.stats.matches}`
                    : 'Premier match de la saison'}
                </small>
                {spread && spread.before !== spread.after && (
                  <small className={spread.after < spread.before ? 'ok' : 'warn'}>
                    Écart max. {spread.before} → {spread.after} avec cette sélection
                  </small>
                )}
              </div>
            </div>
          </div>

          <div className="card cv-box">
            <Field label="Mot aux parents" hint="facultatif">
              <textarea
                className="textarea"
                rows={2}
                disabled={!canEdit}
                value={message}
                placeholder="Ex. : pensez aux gourdes, match important pour le groupe…"
                onChange={(e) => edit<string>(setMessage)(e.target.value)}
              />
            </Field>
            {canEdit && (
              <button className="btn primary lg block" disabled={busy || !sel.size || (published && !changes.length && !dirty.current)} onClick={() => setPublishing(true)}>
                <Megaphone /> {published ? (changes.length ? `Mettre à jour (${changes.length})` : 'Convocation à jour') : 'Publier la convocation'}
              </button>
            )}
            {published ? (
              <p className="small" style={{ textAlign: 'center' }}>
                <Check size={13} /> Publiée {momentLabel(d.publishedAt!)} · <Eye size={13} /> lue par {d.reads}/{d.readers} parent{d.readers > 1 ? 's' : ''}
              </p>
            ) : (
              <p className="small muted" style={{ textAlign: 'center' }}>
                À publier avant <b>{momentLabel(d.timeline.deadline)}</b> ({countdown(d.timeline.deadline)})
              </p>
            )}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn grow" onClick={card} disabled={!sel.size}>
                <ImageIcon /> Carte
              </button>
              <button className="btn grow" onClick={async () => toast((await copy(textMessage())) ? 'Message copié pour WhatsApp' : 'Copie impossible', false)} disabled={!sel.size}>
                <MessageCircle /> Texte
              </button>
            </div>
          </div>
          {Date.now() < d.timeline.start && (
            <div className="card cv-box">
              <CarpoolPanel eventId={d.eventId} date={d.date} compact />
            </div>
          )}
        </aside>
      </div>

      {publishing && (
        <Sheet
          title={published ? 'Mettre à jour la convocation' : 'Publier la convocation'}
          onClose={() => setPublishing(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPublishing(false)}>
                Annuler
              </button>
              <button className="btn primary" onClick={publish}>
                <Send /> {published ? 'Prévenir les familles concernées' : 'Publier et prévenir'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="pub-sum">
              <div>
                <b>{convoked.length}</b>
                <span>convoqués</span>
              </div>
              <div>
                <b>{d.players.length - convoked.length}</b>
                <span>non retenus</span>
              </div>
              <div>
                <b>{new Set((published ? changes : d.players).flatMap((p) => p.parents.map((u) => u.id))).size}</b>
                <span>parents prévenus</span>
              </div>
            </div>
            {published && (
              <p className="small">
                Seules les familles dont la situation change sont prévenues :{' '}
                {changes.map((p) => `${p.firstName} (${sel.has(p.id) ? 'convoqué' : 'retiré'})`).join(', ')}.
              </p>
            )}
            <p className="small muted">
              Les parents des non-retenus reçoivent un message bienveillant : « Les convocations tournent pour que chacun joue autant. »
            </p>
            {!published && Date.now() > d.timeline.deadline && (
              <p className="form-error">La date limite ({momentLabel(d.timeline.deadline)}) est dépassée : la publication sera marquée en retard.</p>
            )}
            {over && <p className="form-error">Vous convoquez {sel.size} joueurs pour {d.squad} places prévues.</p>}
            {(() => {
              const skipped = d.players.filter((p) => !sel.has(p.id) && p.reasons.some((r) => r.tone === 'up') && p.availability?.status === 'yes');
              return skipped.length ? (
                <p className="small" style={{ color: 'var(--warn)' }}>
                  <TrendingUp size={13} /> Disponibles et prioritaires mais non retenus : {skipped.map((p) => p.firstName).join(', ')}.
                </p>
              ) : null;
            })()}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function Gauge({ value, size = 64 }: { value: number | null; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const tone = value === null ? 'var(--line-strong)' : v >= 80 ? 'var(--accent)' : v >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <span className="gauge" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 32 32)"
        />
      </svg>
      <b>{value === null ? '—' : value}</b>
    </span>
  );
}

