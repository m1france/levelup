import {
  ArrowLeft, Bell, BellOff, Check, CircleHelp, Clock, Copy, Eye, Image as ImageIcon, Gift, Link2, ListChecks, MapPin, Megaphone, MessageCircle,
  Minus, Play, Send, TrendingDown, TrendingUp, Trophy, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CarpoolPanel } from '../components/Carpool';
import { MatchTicket } from '../components/Tickets';
import { GamesResults } from '../components/Plateau';
import { AWARDS, autoAwards } from '../lib/awards';
import { AwardsPicker, matchSeconds } from './MatchLive';
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
  const nav = useNavigate();
  // Parent d'un enfant convoqué : une convocation publiée pas encore vue s'ouvre d'abord sur le paquet (une fois par session).
  // Les enfants non convoqués n'ont pas de paquet : leur billet l'annonce simplement.
  const seenKey = `pack-seen:${eventId}:${date}`;
  const packFirst =
    q.data?.kind === 'parent' && !params.has('billet') && !sessionFlag(seenKey) && q.data.tickets.some((t) => t.status === 'convoked' && !t.read && !t.result);
  useEffect(() => {
    if (!packFirst) return;
    sessionFlag(seenKey, true);
    nav(`/matchs/${eventId}/${date}/paquet`, { replace: true });
  }, [packFirst, seenKey, nav, eventId, date]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Match introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/matchs">Retour</Link>} />
      </div>
    );
  if (q.data.kind === 'parent') {
    if (packFirst) return <Spinner fill />;
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

/** Petit drapeau de session (stockage indisponible : considéré comme déjà vu). */
function sessionFlag(key: string, set?: boolean) {
  try {
    if (set) sessionStorage.setItem(key, '1');
    return sessionStorage.getItem(key) === '1';
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ frise des étapes */

function Progress({ d, onRequest, busy }: { d: ConvDetail; onRequest: (reminder: boolean) => void; busy: boolean }) {
  const now = Date.now();
  const t = d.timeline;
  const missing = d.counts.none;
  const steps = [
    t.request !== null && {
      label: 'Dispos demandées', at: t.request, done: d.requestSent || now >= t.request,
      action: !d.requestSent && !d.publishedAt && now < (t.answerBy ?? t.deadline) && now < t.start ? { label: 'Demander les dispos maintenant', fn: () => onRequest(false) } : null,
    },
    ...t.reminders.map((r, i) => ({
      label: t.reminders.length > 1 ? `Relance ${i + 1}` : 'Relance', at: r, done: now >= r,
      action: null as null | { label: string; fn: () => void },
    })),
    t.answerBy !== null && { label: 'Date limite de dispos', at: t.answerBy, done: now >= t.answerBy, action: null },
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
          <li key={i} tabIndex={s.action ? 0 : undefined} className={`${s.done ? 'done' : ''}${i === cur ? ' now' : ''}${s.late ? ' late' : ''}`}>
            <i>{s.done ? <Check size={12} strokeWidth={3.5} /> : null}</i>
            <b>{s.label}</b>
            <small>
              {s.deadline ? 'avant ' : ''}
              {momentLabel(s.at)}
            </small>
            {i === cur && !s.done && <em>{countdown(s.at)}</em>}
            {s.action && <div className="progress-context"><button className="btn sm" disabled={busy} onClick={s.action.fn}><Send size={14} />{s.action.label}</button></div>}
          </li>
        ))}
      </ol>
      {!d.publishedAt && d.requestSent && missing > 0 && now < (t.answerBy ?? t.deadline) && <button className="btn sm" disabled={busy} onClick={() => onRequest(true)}><Bell /> Relancer les {missing} sans réponse</button>}
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
              <ListChecks size={13} />
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
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle');
  const dirty = useRef(false);

  // Nouvelle version du serveur (autre éducateur, réponse d'un parent) : on reprend la sélection enregistrée.
  useEffect(() => {
    if (!dirty.current) {
      setSel(new Set(d.selection));
      setMessage(d.message);
    }
  }, [d.selection, d.message]);

  // Enregistrement automatique du brouillon.
  useEffect(() => {
    if (!dirty.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const out = await api.put<ConvDetail>(`/convocations/${d.eventId}/${d.date}`, { selection: [...sel], message });
        dirty.current = false;
        setSaving('idle');
        setData(out);
      } catch {
        setSaving('error');
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, message]);

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
      if (dirty.current) await api.put(`/convocations/${d.eventId}/${d.date}`, { selection: [...sel], message });
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
        venue: d.venue === 'home' ? 'Domicile' : d.venue === 'away' ? 'Extérieur' : '', date: d.date, time: d.time,
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
      `📅 ${longDate(d.date)}${d.time ? ` · début ${formatTime(d.time)}` : ''}`,
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
    <div className={`page wide${played ? ' played-page' : ''}`}>
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
          {!played && (
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
          )}
        </div>
        {!played && (
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            className="btn lg"
            onClick={() => nav(`/matchs/${d.eventId}/${d.date}/paquet`)}
            disabled={!sel.size}
            title="L’entrée sur le terrain que vivent les enfants convoqués à la publication"
          >
            <Gift /> Aperçu du paquet
          </button>
          {canEdit && (
            <button className="btn lg primary" onClick={() => nav(`/matchs/${d.eventId}/${d.date}/live`)}>
              <Play fill="currentColor" /> Mode match
            </button>
          )}
        </div>
        )}
      </div>

      {d.score?.games && (
        <div className="report-results" style={{ marginBottom: 24 }}>
          <GamesResults
            cards={played}
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

      {played ? (
        <MatchReport d={d} canEdit={canEdit} />
      ) : (
      <>
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
              {canEdit && (
                <button
                  className="btn icon ghost cv-suggest"
                  onClick={applySuggestion}
                  disabled={!d.suggestion.length}
                  aria-label="Suggestion équitable"
                  title="Suggestion équitable : disponibles d’abord, puis ceux qui ont le moins joué, les non-retenus récents et les moins de minutes"
                >
                  <ListChecks />
                </button>
              )}
            </div>
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
            <div className="card cv-box cv-carpool">
              <CarpoolPanel eventId={d.eventId} date={d.date} compact hideEmpty />
            </div>
          )}
        </aside>
      </div>
      </>
      )}

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
              Chaque enfant convoqué reçoit un paquet : son entrée sur le terrain, façon FIFA, jusqu’à sa carte ; les parents des non-retenus reçoivent un message bienveillant : « Les convocations tournent pour que chacun joue autant. »
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

/* ------------------------------------------------------------------ match passé */

const AVAIL_ICON = { yes: Check, maybe: CircleHelp, no: X, none: Minus } as const;

/** Bilan d'un match joué : présences en un coup d'œil, temps de jeu et statistiques de chaque enfant, buts, récompenses. */
function MatchReport({ d, canEdit }: { d: ConvDetail; canEdit: boolean }) {
  const nav = useNavigate();
  const toast = useToast();
  const m = d.match;
  const byId = Object.fromEntries(d.players.map((p) => [p.id, p]));
  const squad = d.players.filter((p) => d.selection.includes(p.id));
  const present = m ? squad.filter((p) => !m.absent.includes(p.id)) : squad;
  const [awards, setAwards] = useState<Record<string, string>>(() =>
    m ? { ...autoAwards(m, present.map((p) => p.id)), ...(d.awards ?? {}) } : {},
  );
  const [editAwards, setEditAwards] = useState(false);

  // Présences : convoqués d'abord, puis les autres ; l'icône dit la réponse des parents.
  const roster = [...d.players].sort((a, b) => Number(d.selection.includes(b.id)) - Number(d.selection.includes(a.id)));
  const presence = (
    <div className="card pad">
      <h3 style={{ marginBottom: 10 }}>Joueurs</h3>
      <div className="av-chips">
        {roster.map((p) => {
          const a = p.availability?.status ?? 'none';
          const Icon = AVAIL_ICON[a];
          const convoked = d.selection.includes(p.id);
          const absent = !!m?.absent.includes(p.id);
          return (
            <Link
              key={p.id}
              to={`/joueurs/${p.id}`}
              className={`av-chip ${a}${convoked ? ' in' : ''}`}
              title={`${playerName(p)} · ${AVAIL[a].label}${convoked ? (absent ? ' · convoqué, absent le jour J' : ' · convoqué') : ' · non convoqué'}`}
            >
              <i>
                <Icon size={12} strokeWidth={3} />
              </i>
              {p.firstName}
              {absent && <small>abs.</small>}
            </Link>
          );
        })}
      </div>
      <div className="av-legend">
        {(['yes', 'maybe', 'no', 'none'] as const).map((a) => {
          const Icon = AVAIL_ICON[a];
          return (
            <span key={a} className={`av-chip ${a}`}>
              <i>
                <Icon size={12} strokeWidth={3} />
              </i>
              {AVAIL[a].short}
            </span>
          );
        })}
        <span className="muted">· en gras : convoqués</span>
      </div>
    </div>
  );

  if (!m) return presence;

  const total = matchSeconds(d);
  const goals = m.events.filter((e) => e.t === 'goal');
  const count = (pid: string, key: 'pid' | 'assist') => goals.filter((g) => g[key] === pid).length;
  const role = (pid: string) => Object.entries(m.roles?.[pid] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mins = (pid: string) => Math.round((m.seconds[pid] ?? 0) / 60);
  const avg = present.length ? Math.round(present.reduce((a, p) => a + mins(p.id), 0) / present.length) : 0;
  const us = d.score?.us ?? m.score.us;
  const them = d.score?.them ?? m.score.them;
  const rows = [...squad].sort((a, b) => (m.seconds[b.id] ?? 0) - (m.seconds[a.id] ?? 0));
  const stats = d.settings.stats;

  return (
    <div className="stack match-report" style={{ gap: 20 }}>
      <div className="kpis">
        <div className="kpi" style={{ ['--c' as string]: '#2f9e44' }}>
          <small>Buts marqués</small>
          <b>{us}</b>
          <span>{goals.filter((g) => g.pid).length ? `${new Set(goals.map((g) => g.pid).filter(Boolean)).size} buteur(s)` : '\u00a0'}</span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#e03131' }}>
          <small>Buts encaissés</small>
          <b>{them}</b>
          <span>{us > them ? 'Victoire' : us === them ? 'Nul' : 'Défaite'}</span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#1c7ed6' }}>
          <small>Joueurs présents</small>
          <b>
            {present.length}
            <em>/{squad.length}</em>
          </b>
          <span>{m.absent.length ? `${m.absent.length} absent${m.absent.length > 1 ? 's' : ''} le jour J` : 'Tous présents'}</span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#f08c00' }}>
          <small>Temps de jeu moyen</small>
          <b>
            {avg}
            <em>min</em>
          </b>
          <span>sur {Math.round(total / 60)} min de jeu</span>
        </div>
      </div>

      <div className="reveal-cta" style={{ marginTop: 0 }}>
        <button className="btn lime" onClick={() => nav(`/matchs/${d.eventId}/${d.date}/cartes`)}>
          🃏 Voir les cartes des joueurs
        </button>

      </div>

      <div className="mr-grid">
        <div className="card pad">
          <h3 style={{ marginBottom: 10 }}>Temps de jeu et statistiques</h3>
          <div className={`mr-table${stats ? '' : ' nostats'}`}>
            <div className="mr-row head">
              <span>Joueur</span>
              <span>Poste</span>
              <span>Temps de jeu</span>
              {stats && <span title="Buts">⚽</span>}
              {stats && <span title="Passes décisives">🅰️</span>}
            </div>
            {rows.map((p) => {
              const abs = m.absent.includes(p.id);
              return (
                <div key={p.id} className={`mr-row${abs ? ' abs' : ''}`}>
                  <span className="ellipsis">
                    <b>{p.firstName}</b>
                    {m.starters.includes(p.id) && <small title="Titulaire"> · tit.</small>}
                  </span>
                  <span className="muted">{abs ? '—' : role(p.id) ?? '—'}</span>
                  <span className="mr-time">
                    <span className="min-bar">
                      <i style={{ width: `${Math.min(100, ((m.seconds[p.id] ?? 0) / total) * 100)}%` }} />
                    </span>
                    <b>{abs ? 'abs.' : `${mins(p.id)}′`}</b>
                  </span>
                  {stats && <span>{count(p.id, 'pid') || ''}</span>}
                  {stats && <span>{count(p.id, 'assist') || ''}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {presence}
          {goals.length > 0 && stats && (
            <div className="card pad">
              <h3 style={{ marginBottom: 8 }}>
                <Trophy size={16} style={{ verticalAlign: -2 }} /> Buts
              </h3>
              {goals.map((g) => (
                <p key={g.id} className="small">
                  ⚽ {g.pid ? byId[g.pid]?.firstName : 'But'}
                  {g.assist ? ` (passe de ${byId[g.assist]?.firstName})` : ''} · {Math.floor(g.sec / 60) + 1}′
                  {d.games?.[g.period - 1] ? ` · contre ${d.games[g.period - 1].opponent}` : ''}
                </p>
              ))}
            </div>
          )}
          <div className="card pad">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3>Récompenses</h3>
              {canEdit && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (editAwards) {
                      await api.put(`/convocations/${d.eventId}/${d.date}/awards`, { awards });
                      toast('Récompenses enregistrées');
                    }
                    setEditAwards(!editAwards);
                  }}
                >
                  {editAwards ? 'Enregistrer' : 'Modifier'}
                </button>
              )}
            </div>
            {editAwards ? (
              <AwardsPicker players={present} value={awards} onChange={setAwards} />
            ) : (
              <div className="award-chips">
                {present.map((p) => (
                  <span key={p.id} className="chip">
                    {AWARDS[awards[p.id]]?.emoji} {p.firstName} · {AWARDS[awards[p.id]]?.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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

