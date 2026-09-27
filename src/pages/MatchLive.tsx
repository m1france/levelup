import { AlertTriangle, ArrowLeft, ArrowLeftRight, Flag, Pause, Play, RotateCcw, Send, Share2, Trophy, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { useApp } from '../lib/store';
import type { ConvDetail, ConvPlayer, MatchEvent, MatchState } from '../lib/types';
import { useWakeLock } from '../lib/wakelock';
import { whistle, unlockAudio } from '../lib/sound';
import { AWARDS, autoAwards, slotPosition } from '../lib/awards';

/* ------------------------------------------------------------------ formations */

const FORMATIONS: Record<number, string[]> = {
  1: ['1'], 2: ['1-1'], 3: ['2-1', '1-1-1'], 4: ['2-2', '1-2-1'], 5: ['2-2', '1-2-1'], 6: ['2-2-1', '3-2'],
  7: ['2-3-1', '3-2-1', '3-3'], 8: ['3-3-1', '2-3-2', '3-2-2'], 9: ['3-3-2', '3-4-1'], 10: ['4-3-2', '3-4-2'], 11: ['4-4-2', '4-3-3', '3-5-2'],
};

interface Slot { x: number; y: number; gk: boolean }

/** Postes d'une formation sur un terrain vertical (notre but en bas). Gardien dès 5 joueurs. */
export function slotsFor(formation: string, onField: number): Slot[] {
  const gk = onField >= 5;
  const outfield = onField - (gk ? 1 : 0);
  let rows = formation.split('-').map(Number).filter((n) => n > 0);
  if (rows.reduce((a, b) => a + b, 0) !== outfield) rows = (FORMATIONS[onField]?.[0] ?? String(outfield)).split('-').map(Number);
  const slots: Slot[] = [];
  if (gk) slots.push({ x: 50, y: 90, gk: true });
  rows.forEach((k, i) => {
    const y = rows.length === 1 ? 45 : 72 - (i * 54) / (rows.length - 1);
    for (let j = 0; j < k; j++) slots.push({ x: ((j + 1) / (k + 1)) * 100, y, gk: false });
  });
  return slots;
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function initial(d: ConvDetail): MatchState {
  const onField = d.settings.onField;
  const formation = FORMATIONS[onField]?.[0] ?? String(onField);
  const slots = slotsFor(formation, onField);
  const squad = d.players.filter((p) => d.selection.includes(p.id));
  const field: (string | null)[] = slots.map(() => null);
  const keeper = squad.find((p) => p.positions[0] === 'GB') ?? squad.find((p) => p.positions.includes('GB'));
  const rest = squad.filter((p) => p !== keeper);
  slots.forEach((s, i) => {
    if (s.gk && keeper) field[i] = keeper.id;
    else field[i] = rest.shift()?.id ?? null;
  });
  return {
    formation, field, absent: [], starters: [], period: 1, running: false, since: null, elapsed: 0, seconds: {}, events: [],
    score: { us: 0, them: 0 }, started: false, finished: false,
  };
}

/** Ajoute le temps écoulé depuis le dernier point aux joueurs sur le terrain. */
function commit(m: MatchState, at = Date.now()): MatchState {
  if (!m.running || !m.since) return m;
  const d = (at - m.since) / 1000;
  const seconds = { ...m.seconds };
  const roles = { ...(m.roles ?? {}) };
  const slots = slotsFor(m.formation, m.field.length);
  m.field.forEach((pid, i) => {
    if (!pid) return;
    seconds[pid] = (seconds[pid] ?? 0) + d;
    const pos = slotPosition(slots[i] ?? { x: 50, y: 50, gk: false });
    roles[pid] = { ...(roles[pid] ?? {}), [pos]: (roles[pid]?.[pos] ?? 0) + d };
  });
  return { ...m, seconds, roles, elapsed: m.elapsed + d, since: at };
}

/* ------------------------------------------------------------------ page */

export function MatchLive() {
  const { eventId, date } = useParams();
  const q = useAsync(() => api.get<{ kind: string } & ConvDetail>(`/convocations/${eventId}/${date}`), [eventId, date]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data || q.data.kind !== 'staff')
    return (
      <div className="page">
        <Empty title="Match introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/matchs">Retour</Link>} />
      </div>
    );
  return <MatchBoard d={q.data} />;
}

type Pick = { where: 'field'; idx: number } | { where: 'bench'; pid: string } | null;
const storeKey = (id: string, date: string) => `levelup.match.${id}.${date}`;

function MatchBoard({ d }: { d: ConvDetail }) {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useApp();
  const team = me.teams.find((t) => t.id === d.teamId);
  useWakeLock(true);
  const s = d.settings;
  const [m, setM] = useState<MatchState>(() => {
    try {
      const local = JSON.parse(localStorage.getItem(storeKey(d.eventId, d.date)) || 'null') as MatchState | null;
      if (local && (!d.match || (local.events.length >= d.match.events.length && local.elapsed >= d.match.elapsed))) return local;
    } catch {
      /* rien */
    }
    return d.match ?? initial(d);
  });
  const [pick, setPick] = useState<Pick>(null);
  const [, setTick] = useState(0);
  const [goal, setGoal] = useState(false);
  const [finish, setFinish] = useState(false);
  const [summary, setSummary] = useState(d.summary?.text ?? '');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const players = useMemo(() => Object.fromEntries(d.players.map((p) => [p.id, p])), [d.players]);
  const squad = d.players.filter((p) => d.selection.includes(p.id) || m.field.includes(p.id));
  const slots = useMemo(() => slotsFor(m.formation, s.onField), [m.formation, s.onField]);
  const bench = squad.filter((p) => !m.field.includes(p.id) && !m.absent.includes(p.id));
  const absent = squad.filter((p) => m.absent.includes(p.id));

  // Chrono affiché.
  useEffect(() => {
    if (!m.running) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [m.running]);

  // Sauvegarde locale immédiate, serveur toutes les 2 s (mise en file si le réseau manque au bord du terrain).
  const persist = useCallback(
    (next: MatchState, now = false) => {
      try {
        localStorage.setItem(storeKey(d.eventId, d.date), JSON.stringify(next));
      } catch {
        /* rien */
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const send = () => void api.put(`/convocations/${d.eventId}/${d.date}/match`, next).catch(() => undefined);
      if (now) send();
      else saveTimer.current = setTimeout(send, 2000);
    },
    [d.eventId, d.date],
  );
  const update = (fn: (m: MatchState) => MatchState, now = false) =>
    setM((cur) => {
      const next = fn(cur);
      persist(next, now);
      return next;
    });

  const live = (x: MatchState) => (x.running && x.since ? (Date.now() - x.since) / 1000 : 0);
  const periodSec = s.periodMinutes * 60;
  const elapsed = m.elapsed + live(m);
  const totalSec = s.periods * periodSec;
  const played = (m.period - 1) * periodSec + Math.min(elapsed, periodSec);
  const remaining = Math.max(0, totalSec - played);
  const secOf = (pid: string) => (m.seconds[pid] ?? 0) + (m.running && m.field.includes(pid) ? live(m) : 0);
  const present = squad.filter((p) => !m.absent.includes(p.id));
  const target = present.length ? (totalSec * Math.min(s.onField, present.length)) / present.length : 0;
  const periodLabel = s.periods === 2 ? (m.period === 1 ? '1re mi-temps' : '2e mi-temps') : `Période ${m.period}/${s.periods}`;
  const overtime = elapsed > periodSec;

  // Remplaçants qui n'atteindront plus leur part de temps de jeu s'ils n'entrent pas dans les 5 prochaines minutes.
  const alerts = bench
    .map((p) => ({ p, slack: secOf(p.id) + remaining - target * 0.9 }))
    .filter((a) => m.started && remaining > 0 && a.slack < 300)
    .sort((a, b) => a.slack - b.slack);

  /* ---- actions */

  const startStop = () => {
    unlockAudio();
    if (m.finished) return;
    if (m.running) update((x) => ({ ...commit(x), running: false, since: null }), true);
    else {
      if (!m.started) whistle();
      update((x) => ({ ...x, running: true, since: Date.now(), started: true, starters: x.starters.length ? x.starters : (x.field.filter(Boolean) as string[]) }), true);
    }
  };

  const endPeriod = async () => {
    whistle();
    const last = m.period >= s.periods;
    update((x) => {
      const c = commit(x);
      const ev: MatchEvent = { id: uid(8), t: 'period', period: x.period, sec: c.elapsed };
      return last ? { ...c, running: false, since: null, events: [...c.events, ev] } : { ...c, running: false, since: null, period: x.period + 1, elapsed: 0, events: [...c.events, ev] };
    }, true);
    if (last) setFinish(true);
  };

  const tap = (target: Pick) => {
    if (m.finished || !target) return;
    if (!pick) {
      if (target.where === 'field' && !m.field[target.idx] && !bench.length) return;
      setPick(target);
      return;
    }
    // Deuxième geste : échange.
    const a = pick;
    const b = target;
    setPick(null);
    if (a.where === 'bench' && b.where === 'bench') {
      setPick(b);
      return;
    }
    update((x) => {
      const c = commit(x);
      const field = [...c.field];
      const events = [...c.events];
      if (a.where === 'field' && b.where === 'field') {
        [field[a.idx], field[b.idx]] = [field[b.idx], field[a.idx]];
      } else {
        const idx = a.where === 'field' ? a.idx : (b as { idx: number }).idx;
        const incoming = a.where === 'bench' ? a.pid : (b as { pid: string }).pid;
        const out = field[idx];
        field[idx] = incoming;
        if (c.started) events.push({ id: uid(8), t: 'sub', pid: incoming, out: out ?? undefined, period: c.period, sec: c.elapsed });
      }
      return { ...c, field, events };
    }, true);
  };

  const pickedPid = pick ? (pick.where === 'field' ? m.field[pick.idx] : pick.pid) : null;

  const setFormation = (f: string) => {
    const nextSlots = slotsFor(f, s.onField);
    update((x) => {
      const onPitch = x.field.filter(Boolean) as string[];
      const field = nextSlots.map((_, i) => onPitch[i] ?? null);
      return { ...x, formation: f, field };
    });
  };

  const markAbsent = (pid: string) => {
    setPick(null);
    update((x) => ({ ...x, absent: x.absent.includes(pid) ? x.absent.filter((a) => a !== pid) : [...x.absent, pid], field: x.field.map((f) => (f === pid ? null : f)) }));
  };

  const addGoal = (pid?: string, assist?: string) => {
    setGoal(false);
    update((x) => ({
      ...x,
      score: { ...x.score, us: x.score.us + 1 },
      events: [...x.events, { id: uid(8), t: 'goal', pid, assist, period: x.period, sec: x.elapsed + live(x) }],
    }), true);
    toast(pid ? `⚽ But de ${players[pid]?.firstName}` : '⚽ But !');
  };
  const addAgainst = () =>
    update((x) => ({ ...x, score: { ...x.score, them: x.score.them + 1 }, events: [...x.events, { id: uid(8), t: 'against', period: x.period, sec: x.elapsed + live(x) }] }), true);
  const undoScore = () =>
    update((x) => {
      const i = [...x.events].reverse().findIndex((e) => e.t === 'goal' || e.t === 'against');
      if (i < 0) return x;
      const idx = x.events.length - 1 - i;
      const e = x.events[idx];
      return {
        ...x,
        score: { us: x.score.us - (e.t === 'goal' ? 1 : 0), them: x.score.them - (e.t === 'against' ? 1 : 0) },
        events: x.events.filter((_, j) => j !== idx),
      };
    }, true);

  const reset = async () => {
    if (!(await confirm({ title: 'Recommencer la feuille de match ?', text: 'Chrono, temps de jeu, buts et changements seront remis à zéro.', confirm: 'Recommencer', danger: true }))) return;
    const fresh = initial(d);
    setM(fresh);
    persist(fresh, true);
  };

  /* ---- rendu */

  if (m.finished) return <MatchSheet d={d} m={m} summary={summary} team={team?.category ?? ''} onBack={() => nav(`/matchs/${d.eventId}/${d.date}`)} />;

  const Token = ({ pid, idx }: { pid: string | null; idx: number }) => {
    const p = pid ? players[pid] : null;
    const on = pick?.where === 'field' && pick.idx === idx;
    const target = !!pick && !on;
    const sec = pid ? secOf(pid) : 0;
    return (
      <button
        className={`mtoken${on ? ' on' : ''}${target ? ' target' : ''}${!p ? ' empty' : ''}${slots[idx]?.gk ? ' gk' : ''}`}
        style={{ left: `${slots[idx].x}%`, top: `${slots[idx].y}%` }}
        onClick={() => tap({ where: 'field', idx })}
      >
        <span className="disc" style={{ background: slots[idx]?.gk ? '#f59f00' : team?.color }}>{p ? p.number ?? p.firstName.slice(0, 2) : '+'}</span>
        {p && <b>{p.firstName}</b>}
        {p && m.started && <small>{Math.floor(sec / 60)}′</small>}
      </button>
    );
  };

  return (
    <div className="match-screen">
      <header className="match-top">
        <button className="btn icon ghost" onClick={() => nav(`/matchs/${d.eventId}/${d.date}`)} aria-label="Retour">
          <ArrowLeft />
        </button>
        <div className="scoreboard">
          <span className="sb-team">{team?.category ?? 'Nous'}</span>
          <span className="sb-score">
            {m.score.us}
            <i>–</i>
            {m.score.them}
          </span>
          <span className="sb-team">{d.opponent || 'Adv.'}</span>
        </div>
        <div className={`sb-clock${m.running ? ' run' : ''}${overtime ? ' over' : ''}`}>
          <b>{fmt(elapsed)}</b>
          <small>{periodLabel}</small>
        </div>
      </header>

      <div className="match-body">
        <section className="match-main">
          {alerts[0] && (
            <button className="equity-alert" onClick={() => setPick({ where: 'bench', pid: alerts[0].p.id })}>
              <AlertTriangle />
              <span className="grow">
                <b>{alerts[0].p.firstName}</b> : {Math.floor(secOf(alerts[0].p.id) / 60)} min jouées, il reste {Math.ceil(remaining / 60)} min. À faire entrer {alerts[0].slack < 0 ? 'maintenant' : 'bientôt'} pour qu’il joue autant que les autres.
              </span>
              <span className="btn sm">Faire entrer</span>
            </button>
          )}
          <div className="mpitch">
            <div className="mp-lines">
              <i className="mid" />
              <i className="circle" />
              <i className="box top" />
              <i className="box bottom" />
            </div>
            {slots.map((_, i) => (
              <Token key={i} pid={m.field[i] ?? null} idx={i} />
            ))}
          </div>
          {pickedPid && (
            <div className="pick-bar">
              <ArrowLeftRight size={16} />
              <span className="grow">
                <b>{players[pickedPid]?.firstName}</b> : touchez {pick?.where === 'bench' ? 'le joueur qui sort' : 'un remplaçant ou un autre poste'}
              </span>
              {pick?.where === 'bench' && (
                <button className="btn sm ghost" onClick={() => markAbsent(pickedPid)}>
                  <UserX /> Absent
                </button>
              )}
              <button className="btn icon sm ghost" onClick={() => setPick(null)} aria-label="Annuler">
                <X />
              </button>
            </div>
          )}
          <div className="match-controls">
            <button className="btn lg" onClick={addAgainst} disabled={!m.started}>
              But adverse
            </button>
            <button className={`btn round big ${m.running ? '' : 'primary'}`} onClick={startStop} aria-label={m.running ? 'Pause' : 'Démarrer'}>
              {m.running ? <Pause /> : <Play fill="currentColor" />}
            </button>
            <button className="btn lg primary" onClick={() => (s.stats ? setGoal(true) : addGoal())} disabled={!m.started}>
              ⚽ But
            </button>
          </div>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 6 }}>
            {m.started && (
              <button className="btn sm" onClick={endPeriod}>
                <Flag /> {m.period >= s.periods ? 'Fin du match' : `Fin de la ${periodLabel.toLowerCase()}`}
              </button>
            )}
            {m.events.some((e) => e.t === 'goal' || e.t === 'against') && (
              <button className="btn sm ghost" onClick={undoScore}>
                <RotateCcw /> Annuler le dernier but
              </button>
            )}
            {!m.started && (
              <select className="select" style={{ width: 'auto', minHeight: 32, height: 32, fontSize: 13 }} value={m.formation} onChange={(e) => setFormation(e.target.value)}>
                {(FORMATIONS[s.onField] ?? [m.formation]).map((f) => (
                  <option key={f} value={f}>
                    Formation {s.onField >= 5 ? `G-${f}` : f}
                  </option>
                ))}
              </select>
            )}
            {m.started && (
              <button className="btn sm ghost" onClick={reset}>
                Recommencer
              </button>
            )}
          </div>
        </section>

        <aside className="match-side">
          <h3>Remplaçants</h3>
          <div className="bench">
            {bench.map((p) => (
              <button key={p.id} className={`bench-chip${pick?.where === 'bench' && pick.pid === p.id ? ' on' : ''}${alerts.some((a) => a.p.id === p.id) ? ' warn' : ''}`} onClick={() => tap({ where: 'bench', pid: p.id })}>
                <span className="disc sm" style={{ background: team?.color }}>{p.number ?? p.firstName.slice(0, 2)}</span>
                <b>{p.firstName}</b>
                <small>{Math.floor(secOf(p.id) / 60)}′</small>
              </button>
            ))}
            {!bench.length && <p className="small muted">Tout le monde est sur le terrain.</p>}
          </div>
          {absent.length > 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Absents : {absent.map((p) => (
                <button key={p.id} className="link-btn" onClick={() => markAbsent(p.id)} title="Annuler l’absence">
                  {p.firstName}
                </button>
              ))}
            </p>
          )}

          <h3 style={{ marginTop: 20 }}>Temps de jeu</h3>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Objectif équitable : {Math.round(target / 60)} min chacun
          </p>
          <div className="minutes">
            {[...present].sort((a, b) => secOf(a.id) - secOf(b.id)).map((p) => {
              const sec = secOf(p.id);
              const ratio = target ? Math.min(1.3, sec / target) : 0;
              return (
                <div key={p.id} className="min-row">
                  <span className="ellipsis">{p.firstName}</span>
                  <span className="min-bar">
                    <i className={ratio < 0.5 && m.started ? 'low' : ratio > 1.15 ? 'high' : ''} style={{ width: `${(ratio / 1.3) * 100}%` }} />
                    <u style={{ left: `${(1 / 1.3) * 100}%` }} />
                  </span>
                  <b>{Math.floor(sec / 60)}′</b>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {goal && (
        <GoalSheet
          field={m.field.filter(Boolean).map((pid) => players[pid!]).filter(Boolean) as ConvPlayer[]}
          onClose={() => setGoal(false)}
          onGoal={addGoal}
        />
      )}
      {finish && (
        <FinishSheet
          d={d}
          m={m}
          onClose={() => setFinish(false)}
          onDone={async (text, publish, awards) => {
            const next = { ...commit(m), running: false, since: null, finished: true };
            try {
              const r = await api.post<{ sent: number }>(`/convocations/${d.eventId}/${d.date}/finish`, { match: next, text, publish, awards });
              localStorage.removeItem(storeKey(d.eventId, d.date));
              setSummary(text);
              setM(next);
              setFinish(false);
              toast(publish ? `Résumé et cartes envoyés à ${r.sent} parent${r.sent > 1 ? 's' : ''}` : 'Match terminé');
              nav(`/matchs/${d.eventId}/${d.date}/cartes`);
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        />
      )}
    </div>
  );
}

function GoalSheet({ field, onClose, onGoal }: { field: ConvPlayer[]; onClose: () => void; onGoal: (pid?: string, assist?: string) => void }) {
  const [scorer, setScorer] = useState<string | null>(null);
  return (
    <Sheet title={scorer ? 'Passe décisive ?' : 'Qui a marqué ?'} onClose={onClose}>
      <div className="scorer-grid">
        {field
          .filter((p) => p.id !== scorer)
          .map((p) => (
            <button key={p.id} className="scorer-pick" onClick={() => (scorer ? onGoal(scorer, p.id) : setScorer(p.id))}>
              {p.number !== undefined && <small>{p.number}</small>}
              <b>{p.firstName}</b>
            </button>
          ))}
      </div>
      <button className="btn block" style={{ marginTop: 12 }} onClick={() => onGoal(scorer ?? undefined)}>
        {scorer ? 'Sans passe décisive' : 'But sans buteur précis'}
      </button>
    </Sheet>
  );
}

/** Choix d'une récompense par enfant (pré-remplie d'après le match). */
function AwardsPicker({ players, value, onChange }: { players: ConvPlayer[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="award-list">
      {players.map((p) => {
        const a = AWARDS[value[p.id]];
        return (
          <div key={p.id} className="award-row">
            <button className="award-cur" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="award-emo">{a?.emoji ?? '🏅'}</span>
              <span className="grow">
                <b>{p.firstName}</b>
                <small>{a?.label ?? 'Choisir une récompense'}</small>
              </span>
              <span className="small muted">Changer</span>
            </button>
            {open === p.id && (
              <div className="award-choices">
                {Object.entries(AWARDS).map(([k, x]) => (
                  <button key={k} className={`chip${value[p.id] === k ? ' on' : ''}`} onClick={() => (onChange({ ...value, [p.id]: k }), setOpen(null))}>
                    {x.emoji} {x.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FinishSheet({ d, m, onClose, onDone }: { d: ConvDetail; m: MatchState; onClose: () => void; onDone: (text: string, publish: boolean, awards: Record<string, string>) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const present = d.players.filter((p) => d.selection.includes(p.id) && !m.absent.includes(p.id));
  const [awards, setAwards] = useState<Record<string, string>>(() => autoAwards(commit(m), present.map((p) => p.id)));
  const go = async (publish: boolean) => {
    setBusy(true);
    await onDone(text, publish, awards);
    setBusy(false);
  };
  return (
    <Sheet
      title={step === 1 ? 'Fin du match' : 'Les récompenses'}
      onClose={onClose}
      footer={
        step === 1 ? (
          <button className="btn primary" onClick={() => setStep(2)}>
            Choisir les récompenses →
          </button>
        ) : (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => go(false)}>
              Terminer sans envoyer
            </button>
            <button className="btn primary" disabled={busy} onClick={() => go(true)}>
              <Send /> Envoyer les cartes aux parents
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="stack">
          <div className="final-score">
            {m.score.us} – {m.score.them}
            <small>contre {d.opponent || 'l’adversaire'}</small>
          </div>
          <Field label="Le mot du coach" hint="envoyé avec le score et le temps de jeu de chaque enfant">
            <textarea className="textarea" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Bravo à tous pour l’état d’esprit, on a vu de super passes !" />
          </Field>
          <p className="small muted">Chaque famille reçoit un message personnalisé et découvre la carte de son enfant, avec sa récompense.</p>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">Chaque enfant repart avec une récompense. Elles sont proposées d’après le match (buts, passes, poste, temps de jeu) : changez-les d’un geste.</p>
          <AwardsPicker players={present} value={awards} onChange={setAwards} />
        </div>
      )}
    </Sheet>
  );
}

/** Feuille de match après le coup de sifflet final. */
function MatchSheet({ d, m, team, summary, onBack }: { d: ConvDetail; m: MatchState; team: string; summary: string; onBack: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const byId = Object.fromEntries(d.players.map((p) => [p.id, p]));
  const present = d.players.filter((p) => d.selection.includes(p.id) && !m.absent.includes(p.id));
  const [awards, setAwards] = useState<Record<string, string>>(() => ({ ...autoAwards(m, present.map((p) => p.id)), ...(d.awards ?? {}) }));
  const [editAwards, setEditAwards] = useState(false);
  const share = async () => {
    try {
      const r = await api.get<{ shareToken: string }>(`/convocations/${d.eventId}/${d.date}/reveal`);
      const url = `${location.origin}/m/${r.shareToken}`;
      if (navigator.share) await navigator.share({ title: `Les cartes du match · ${team}`, text: 'Retournez les cartes des joueurs 🃏', url }).catch(() => undefined);
      else {
        await navigator.clipboard.writeText(url);
        toast('Lien des cartes copié');
      }
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const squad = d.players.filter((p) => d.selection.includes(p.id));
  const goals = m.events.filter((e) => e.t === 'goal');
  return (
    <div className="page narrow">
      <button className="back" onClick={onBack} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
        <ArrowLeft size={15} /> Convocation
      </button>
      <div className="cv-score" style={{ marginTop: 8 }}>
        <b>{team}</b>
        <span>
          {m.score.us} – {m.score.them}
        </span>
        <b>{d.opponent || 'Adversaire'}</b>
        {summary && <p>« {summary} »</p>}
      </div>
      <div className="reveal-cta">
        <button className="btn lime" onClick={() => nav(`/matchs/${d.eventId}/${d.date}/cartes`)}>
          🃏 Voir les cartes des joueurs
        </button>
        <button className="btn" onClick={share}>
          <Share2 /> Partager le lien
        </button>
      </div>
      <div className="card pad" style={{ marginTop: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3>Récompenses</h3>
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
      {goals.length > 0 && d.settings.stats && (
        <div className="card pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>
            <Trophy size={16} style={{ verticalAlign: -2 }} /> Buts
          </h3>
          {goals.map((g) => (
            <p key={g.id} className="small">
              ⚽ {g.pid ? byId[g.pid]?.firstName : 'But'}
              {g.assist ? ` (passe de ${byId[g.assist]?.firstName})` : ''} · {Math.floor(g.sec / 60) + 1}′
            </p>
          ))}
        </div>
      )}
      <div className="card pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>Temps de jeu</h3>
        <div className="minutes">
          {squad
            .sort((a, b) => (m.seconds[b.id] ?? 0) - (m.seconds[a.id] ?? 0))
            .map((p) => (
              <div key={p.id} className="min-row">
                <span className="ellipsis">
                  {p.firstName}
                  {m.starters.includes(p.id) ? ' ·' : ''}
                </span>
                <span className="min-bar">
                  <i style={{ width: `${Math.min(100, ((m.seconds[p.id] ?? 0) / (d.settings.periods * d.settings.periodMinutes * 60)) * 100)}%` }} />
                </span>
                <b>{m.absent.includes(p.id) ? 'abs.' : `${Math.round((m.seconds[p.id] ?? 0) / 60)}′`}</b>
              </div>
            ))}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>· titulaire</p>
      </div>
    </div>
  );
}
