import { AlertTriangle, ArrowLeft, ArrowLeftRight, Flag, Pause, Play, RotateCcw, Send, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { useApp } from '../lib/store';
import type { ConvDetail, ConvPlayer, MatchEvent, MatchState } from '../lib/types';
import { GamesResults } from '../components/Plateau';
import { PortraitCard } from '../components/FutCard';
import { cardPhotoUrl } from '../components/PlayerAvatar';
import { useWakeLock } from '../lib/wakelock';
import { beep, whistle, unlockAudio } from '../lib/sound';
import { AWARDS, autoAwards, slotPosition } from '../lib/awards';

/* ------------------------------------------------------------------ formations */

/** Formations proposées selon le nombre de joueurs sur le terrain (la première est celle par défaut). Gardien en plus dès 5. */
export const FORMATIONS: Record<number, string[]> = {
  1: ['1'],
  2: ['1-1'],
  3: ['2-1'],
  4: ['1-2-1'],
  5: ['1-2-1'],
  6: ['2-2-1'],
  7: ['2-3-1'],
  8: ['3-3-1'],
  9: ['3-3-2'],
  10: ['4-3-2'],
  11: ['4-4-2'],
};

interface Slot { x: number; y: number; gk: boolean }

/** Postes d'une formation sur un terrain vertical (notre but en bas). Gardien dès 5 joueurs. */
export function slotsFor(formation: string, onField: number): Slot[] {
  const gk = onField >= 5;
  const outfield = onField - (gk ? 1 : 0);
  let rows = formation.split('-').map(Number).filter((n) => n > 0);
  if (rows.reduce((a, b) => a + b, 0) !== outfield) rows = (FORMATIONS[onField]?.[0] ?? String(outfield)).split('-').map(Number);
  const slots: Slot[] = [];
  // Marges : le nom et le temps de jeu sous chaque pastille restent dans le terrain.
  if (gk) slots.push({ x: 50, y: 87, gk: true });
  rows.forEach((k, i) => {
    const y = rows.length === 1 ? 45 : 64 - (i * 51) / (rows.length - 1);
    for (let j = 0; j < k; j++) slots.push({ x: 12 + ((j + 1) / (k + 1)) * 76, y, gk: false });
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
  // Sans convocation publiée (test avant l'heure), tous les joueurs disponibles sont dans le groupe.
  const d = q.data.selection.length ? q.data : { ...q.data, selection: q.data.players.filter((p) => p.availability?.status !== 'no').map((p) => p.id) };
  return <MatchBoard d={d} />;
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
      if (local && (!d.match || (local.events.length >= d.match.events.length && local.elapsed >= d.match.elapsed))) return { ...local, formation: FORMATIONS[s.onField]?.[0] ?? String(s.onField) };
    } catch {
      /* rien */
    }
    return d.match ? { ...d.match, formation: FORMATIONS[s.onField]?.[0] ?? String(s.onField) } : initial(d);
  });
  const [pick, setPick] = useState<Pick>(null);
  const [, setTick] = useState(0);
  const [goal, setGoal] = useState(false);
  const [finish, setFinish] = useState(false);
  const [halfAlert, setHalfAlert] = useState(false);
  const notified = useRef(new Set<number>());
  const [dragging, setDragging] = useState<number | null>(null);
  const drag = useRef<{ from: number; ready: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
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
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      const saved = localStorage.getItem(storeKey(d.eventId, d.date));
      if (saved) void api.put(`/convocations/${d.eventId}/${d.date}/match`, JSON.parse(saved)).catch(() => undefined);
    }
  }, [d.eventId, d.date]);
  const update = (fn: (m: MatchState) => MatchState, now = false) =>
    setM((cur) => {
      const next = fn(cur);
      persist(next, now);
      return next;
    });

  const live = (x: MatchState) => (x.running && x.since ? (Date.now() - x.since) / 1000 : 0);
  // Plateau : chaque « période » est un petit match contre un adversaire, avec sa propre durée.
  const games = d.games?.length ? [...d.games].sort((a, b) => {
    const rank = (id: string) => m.gameOrder?.includes(id) ? m.gameOrder.indexOf(id) : (m.gameOrder?.length ?? 0) + d.games!.findIndex((g) => g.id === id);
    return rank(a.id) - rank(b.id);
  }) : null;
  const periods = games ? games.length : s.periods;
  const lengthOf = (p: number) => (games ? (games[p - 1]?.minutes ?? s.periodMinutes) : s.periodMinutes) * 60;
  const periodSec = lengthOf(m.period);
  const elapsed = m.elapsed + live(m);
  const totalSec = Array.from({ length: periods }, (_, i) => lengthOf(i + 1)).reduce((a, b) => a + b, 0);
  const game = games?.[m.period - 1] ?? null;
  const results = m.results ?? [];
  const secOf = (pid: string) => (m.seconds[pid] ?? 0) + (m.running && m.field.includes(pid) ? live(m) : 0);
  const present = squad.filter((p) => !m.absent.includes(p.id));
  const target = present.length ? (totalSec * Math.min(s.onField, present.length)) / present.length : 0;
  const periodLabel = games ? `Match ${m.period}/${periods}` : s.periods === 2 ? (m.period === 1 ? '1re mi-temps' : '2e mi-temps') : `Période ${m.period}/${s.periods}`;
  const overtime = elapsed > periodSec;

  // Une alerte par rencontre, conservée avec le chrono lors des pauses et rechargements.
  const midpoint = games ? periodSec / 2 : totalSec / 2;
  const matchElapsed = games ? elapsed : (m.period - 1) * periodSec + elapsed;
  const alertKey = games ? m.period : 1;
  useEffect(() => {
    if (!m.running || matchElapsed < midpoint || m.halftimeNotified?.includes(alertKey) || notified.current.has(alertKey)) return;
    notified.current.add(alertKey);
    beep();
    navigator.vibrate?.([180, 80, 180]);
    setHalfAlert(true);
    update((x) => ({ ...x, halftimeNotified: [...(x.halftimeNotified ?? []), alertKey] }), true);
  }, [m.running, matchElapsed, midpoint, alertKey, m.halftimeNotified]);
  useEffect(() => { setHalfAlert(false); }, [m.period]);
  useEffect(() => () => { if (drag.current) clearTimeout(drag.current.timer); }, []);

  // Les rencontres terminées et celle déjà démarrée gardent leur place et leur score.
  const firstMovable = (m.period - 1) + (elapsed > 0 || m.running || results[m.period - 1] ? 1 : 0);
  const reorder = (from: number, to: number) => {
    if (!games || from < firstMovable || to < firstMovable || from === to || to >= games.length) return;
    const order = games.map((g) => g.id);
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id);
    update((x) => ({ ...x, gameOrder: order }), true);
  };
  const gameList = <section className="match-fixtures">
    <div className="match-section-heading"><span>Les rencontres</span><small>{games?.length ?? 1}</small></div>
    <div className="plateau-strip" aria-label="Ordre des matchs">
      {(games ?? [{ id: d.eventId, opponent: d.opponent || 'Adversaire' }]).map((g, i) => {
        const r = results[i];
        const current = i === m.period - 1;
        const movable = !!games && i >= firstMovable;
        return <div key={g.id}
          data-game-index={i} tabIndex={movable ? 0 : undefined}
          className={`ps-game${current ? ' current' : ''}${r ? ' completed' : ''}${dragging === i ? ' dragging' : ''}`}
          aria-label={`${g.opponent}${movable ? ', maintenir pour déplacer, ou Alt et flèches au clavier' : ''}`}
          onKeyDown={(e) => { if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); reorder(i, i + (e.key === 'ArrowUp' ? -1 : 1)); } }}
          onPointerDown={(e) => {
            if (!movable || e.button !== 0) return;
            const element = e.currentTarget;
            const pointerId = e.pointerId;
            const mouse = e.pointerType === 'mouse';
            if (mouse) element.setPointerCapture(pointerId);
            drag.current = { from: i, ready: mouse, timer: setTimeout(() => {
              if (!drag.current) return;
              drag.current.ready = true;
              element.setPointerCapture(pointerId);
              setDragging(i);
            }, mouse ? 0 : 180) };
          }}
          onPointerMove={(e) => {
            if (!drag.current?.ready) return;
            e.preventDefault();
            const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-game-index]');
            if (target) target.dataset.drop = 'true';
            document.querySelectorAll<HTMLElement>('[data-drop]').forEach((el) => { if (el !== target) delete el.dataset.drop; });
          }}
          onPointerUp={(e) => {
            const state = drag.current;
            if (!state) return;
            clearTimeout(state.timer);
            if (state.ready) {
              const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-game-index]');
              if (target) reorder(state.from, Number(target.dataset.gameIndex));
            }
            drag.current = null; setDragging(null);
            document.querySelectorAll<HTMLElement>('[data-drop]').forEach((el) => delete el.dataset.drop);
          }}
          onPointerCancel={() => { if (drag.current) clearTimeout(drag.current.timer); drag.current = null; setDragging(null); }}>
          <small>{String(i + 1).padStart(2, '0')}</small><b>{g.opponent}</b>
          <em>{r ? `${r.us}-${r.them}` : current ? `${m.score.us}-${m.score.them}` : '–'}</em>
        </div>;
      })}
    </div>
  </section>;

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
    const last = m.period >= periods;
    update((x) => {
      const c = commit(x);
      const ev: MatchEvent = { id: uid(8), t: 'period', period: x.period, sec: c.elapsed };
      const base = { ...c, running: false, since: null, events: [...c.events, ev] };
      if (games) {
        // Le score du match qui se termine est rangé ; le suivant repart de 0 – 0.
        const res = [...(c.results ?? [])];
        res[x.period - 1] = { ...c.score };
        return last ? { ...base, results: res } : { ...base, results: res, period: x.period + 1, elapsed: 0, score: { us: 0, them: 0 } };
      }
      return last ? base : { ...base, period: x.period + 1, elapsed: 0 };
    }, true);
    if (last) setFinish(true);
    else if (games) toast(`Coup de sifflet · prochain match contre ${games[m.period]?.opponent ?? 'l’adversaire suivant'}`);
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
      // Plateau : seulement dans le match en cours (les scores des matchs terminés sont rangés).
      const i = [...x.events].reverse().findIndex((e) => (e.t === 'goal' || e.t === 'against') && (!games || e.period === x.period));
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
    if (!(await confirm({ title: 'Recommencer le match ?', text: 'Chrono, temps de jeu, buts et changements seront remis à zéro.', confirm: 'Recommencer', danger: true }))) return;
    const fresh = initial(d);
    setHalfAlert(false);
    notified.current.clear();
    setM(fresh);
    persist(fresh, true);
  };

  /* ---- rendu */

  // Match terminé : le bilan (scores, temps de jeu, récompenses) est sur la page du match.
  if (m.finished) return <Navigate to={`/matchs/${d.eventId}/${d.date}`} replace />;
  const canUndo = m.events.some((e) => (e.t === 'goal' || e.t === 'against') && (!games || e.period === m.period));

  const renderToken = (pid: string | null, idx: number) => {
    const p = pid ? players[pid] : null;
    const on = pick?.where === 'field' && pick.idx === idx;
    const target = !!pick && !on;

    return (
      <button
        key={idx}
        className={`mtoken${on ? ' on' : ''}${target ? ' target' : ''}${!p ? ' empty' : ''}${slots[idx]?.gk ? ' gk' : ''}`}
        style={{ left: `${slots[idx].x}%`, top: `${slots[idx].y}%` }}
        title={p?.firstName ?? 'Poste libre'}
        aria-label={p ? `${p.firstName}, ${slots[idx]?.gk ? 'gardien' : 'sur le terrain'}, sélectionner pour remplacer` : 'Poste libre'}
        onClick={() => tap({ where: 'field', idx })}
      >
        <PortraitCard photo={p ? cardPhotoUrl(p) : null} name={p?.firstName ?? 'Poste libre'} tier={slots[idx]?.gk ? 'green' : slots[idx]?.y > 60 ? 'silver' : 'gold'} />
        {!p && <span className="empty-slot">+</span>}
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
          <span className="sb-team">{d.group ?? team?.category ?? 'Nous'}</span>
          <span className="sb-score">
            {m.score.us}
            <i>–</i>
            {m.score.them}
          </span>
          <span className="sb-team">{game ? game.opponent : d.opponent || 'Adv.'}</span>
        </div>
        <div className={`sb-clock${m.running ? ' run' : ''}${overtime ? ' over' : ''}`}>
          <b>{fmt(elapsed)}</b>
          <small>{periodLabel}</small>
        </div>
      </header>

      <div className="match-body">
        <section className="match-main">
          {halfAlert && <div className="equity-alert" role="status"><AlertTriangle /><span className="grow"><b>La moitié du match est jouée.</b> Pensez aux remplacements.</span><button className="btn icon sm ghost" aria-label="Fermer le rappel" onClick={() => setHalfAlert(false)}><X /></button></div>}
          <div className="mpitch">
            <div className="mp-lines">
              <i className="mid" />
              <i className="circle" />
              <i className="box top" />
              <i className="box bottom" />
            </div>
            {slots.map((_, i) => (
              renderToken(m.field[i] ?? null, i)
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
            {m.started && (m.running || elapsed > 0 || !games) && (
              <button className="btn sm" onClick={endPeriod}>
                <Flag />{' '}
                {games
                  ? m.period >= periods
                    ? 'Fin du plateau'
                    : `Fin du match contre ${game?.opponent ?? ''}`
                  : m.period >= s.periods
                    ? 'Fin du match'
                    : `Fin de la ${periodLabel.toLowerCase()}`}
              </button>
            )}
            {canUndo && (
              <button className="btn sm ghost" onClick={undoScore}>
                <RotateCcw /> Annuler le dernier but
              </button>
            )}
            {m.started && (
              <button className="btn sm ghost" onClick={reset}>
                Recommencer
              </button>
            )}
          </div>
        </section>

        <aside className="match-side">
          {gameList}
          <section className="match-bench-panel">
          <h3>Remplaçants</h3>
          <div className="bench">
            {bench.map((p) => (
              <button key={p.id} className={`bench-chip${pick?.where === 'bench' && pick.pid === p.id ? ' on' : ''}`} onClick={() => tap({ where: 'bench', pid: p.id })}>
                <PortraitCard photo={cardPhotoUrl(p)} name={p.firstName} tier={p.positions.includes('GB') ? 'green' : 'gold'} />
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

          </section>
          <section className="match-minutes-panel"><h3>Temps de jeu</h3>
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
          </section>
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
          d={{ ...d, games }}
          m={m}
          onClose={() => setFinish(false)}
          onDone={async (text, publish, awards) => {
            const c = commit(m);
            // Plateau : le score global est la somme des buts de tous les matchs.
            const total = c.results?.length ? c.results.reduce((a, r) => ({ us: a.us + r.us, them: a.them + r.them }), { us: 0, them: 0 }) : c.score;
            const next = { ...c, score: total, running: false, since: null, finished: true };
            try {
              if (saveTimer.current) clearTimeout(saveTimer.current);
              const r = await api.post<{ sent: number }>(`/convocations/${d.eventId}/${d.date}/finish`, { match: next, text, publish, awards });
              localStorage.removeItem(storeKey(d.eventId, d.date));
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

/** Durée totale de jeu : toutes les périodes, ou tous les matchs d'un plateau. */
export const matchSeconds = (d: ConvDetail) =>
  Math.max(1, d.games?.length ? d.games.reduce((a, g) => a + g.minutes * 60, 0) : d.settings.periods * d.settings.periodMinutes * 60);

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
export function AwardsPicker({ players, value, onChange }: { players: ConvPlayer[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
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
          {d.games?.length ? (
            <GamesResults cards games={d.games} results={m.results ?? []} />
          ) : (
            <div className="final-score">
              {m.score.us} – {m.score.them}
              <small>contre {d.opponent || 'l’adversaire'}</small>
            </div>
          )}
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
