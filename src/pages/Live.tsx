import {
  Check, ChevronLeft, ChevronRight, Eye, Megaphone, MessageSquarePlus, Pause, Play, Plus, Shuffle, SkipForward, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Presenter } from '../components/Pitch';
import { Empty, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { unlockAudio, whistle } from '../lib/sound';
import { playerName, useApp } from '../lib/store';
import type { Block, Exercise, Group, NoteKind, Player, Training, TrainingPayload } from '../lib/types';
import { useWakeLock } from '../lib/wakelock';
import { COLORS } from '../pitch/geometry';
import { NOTE_KINDS } from './PlayerPage';
import { BLOCK_LABELS, blockMinutes } from './Trainings';

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'orange', 'purple'];
const GROUP_NAMES: Record<string, string> = { blue: 'Bleus', red: 'Rouges', yellow: 'Jaunes', green: 'Verts', orange: 'Orange', purple: 'Violets' };

type Mode = 'level' | 'year' | 'random';

function shuffle<T>(a: T[]) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Groupes équilibrés : tirage « serpent » par niveau, ou par année de naissance, ou au hasard. */
export function makeGroups(players: Player[], n: number, mode: Mode): Group[] {
  const groups: Group[] = GROUP_COLORS.slice(0, n).map((c) => ({ id: uid(8), name: GROUP_NAMES[c], color: c, playerIds: [] }));
  let order: Player[];
  if (mode === 'random') order = shuffle(players);
  else if (mode === 'year') {
    order = shuffle(players).sort((a, b) => (b.birthYear ?? 0) - (a.birthYear ?? 0));
    const per = Math.ceil(order.length / n);
    order.forEach((p, i) => groups[Math.min(n - 1, Math.floor(i / per))].playerIds.push(p.id));
    return groups;
  } else order = shuffle(players).sort((a, b) => (b.level ?? 2) - (a.level ?? 2));
  order.forEach((p, i) => {
    const round = Math.floor(i / n);
    const idx = round % 2 === 0 ? i % n : n - 1 - (i % n);
    groups[idx].playerIds.push(p.id);
  });
  return groups;
}

interface LiveState {
  phase: 'appel' | 'groupes' | 'seance' | 'fin';
  block: number;
  round: number;
  stage: 'play' | 'transition' | 'done';
  running: boolean;
  endsAt: number;
  remaining: number;
}

const stateKey = (id: string) => `atelier.live.${id}`;

export function Live() {
  const { id } = useParams();
  const { team } = useApp();
  const q = useAsync(async () => {
    const payload = await api.get<TrainingPayload>(`/trainings/${id}`);
    const players = await api.get<Player[]>(`/teams/${payload.training.teamId}/players`);
    return { ...payload, players };
  }, [id]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data) return <div className="page"><Empty title="Séance introuvable" text={q.error ?? undefined} /></div>;
  return <LiveSession key={q.data.training.id} training={q.data.training} exercises={q.data.exercises} players={q.data.players} teamName={team?.name} />;
}

function LiveSession({ training, exercises, players }: { training: Training; exercises: Record<string, Exercise>; players: Player[]; teamName?: string }) {
  const nav = useNavigate();
  const toast = useToast();
  useWakeLock(true);

  const [t, setT] = useState(training);
  const tRef = useRef(t);
  const persist = useCallback(
    (patch: Partial<Training>) => {
      const next = { ...tRef.current, ...patch };
      tRef.current = next;
      setT(next);
      api.put(`/trainings/${next.id}`, next).catch((e) => toast(e.message, true));
    },
    [toast],
  );

  const [s, setS] = useState<LiveState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(stateKey(training.id)) || 'null');
      if (saved) return saved;
    } catch {
      /* rien */
    }
    return {
      phase: training.attendance?.length && training.groups?.length ? 'seance' : 'appel',
      block: 0, round: 0, stage: 'play', running: false, endsAt: 0, remaining: (training.blocks[0] ? durationOf(training.blocks[0], 0) : 0),
    };
  });
  useEffect(() => {
    try {
      localStorage.setItem(stateKey(training.id), JSON.stringify(s));
    } catch {
      /* rien */
    }
  }, [s, training.id]);

  const [present, setPresent] = useState<Set<string>>(() => new Set(training.attendance ?? []));
  const [groups, setGroups] = useState<Group[]>(training.groups ?? []);
  const [note, setNote] = useState<{ playerId?: string } | null>(null);
  const [show, setShow] = useState<Exercise | null>(null);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const rotationSize = Math.max(0, ...t.blocks.filter((b) => b.kind === 'rotation').map((b) => b.stations?.length ?? 0));

  const phases = ['appel', 'groupes', 'seance'] as const;
  const phaseIdx = phases.indexOf(s.phase as (typeof phases)[number]);

  const exit = () => nav(`/seances/${t.id}`);

  return (
    <div className="live">
      <div className="live-top">
        <button className="btn icon ghost" onClick={exit} aria-label="Quitter">
          <X />
        </button>
        <h2 className="ellipsis">{t.title}</h2>
        <button className="btn sm" onClick={() => setNote({})}>
          <MessageSquarePlus /> <span className="hide-mobile">Remarque</span>
        </button>
        <button className="btn icon" onClick={() => (unlockAudio(), whistle(1))} aria-label="Coup de sifflet" title="Sifflet">
          <Megaphone />
        </button>
      </div>
      {s.phase !== 'fin' && (
        <div className="steps" style={{ padding: '10px 16px 0', maxWidth: 880, margin: '0 auto', width: '100%' }}>
          {phases.map((p, i) => (
            <span key={p} className={i <= phaseIdx ? 'on' : ''} />
          ))}
        </div>
      )}
      <div className="live-body">
        <div className="live-inner">
          {s.phase === 'appel' && (
            <Roll
              players={players}
              present={present}
              setPresent={setPresent}
              onNext={() => {
                persist({ attendance: [...present] });
                if (!groups.length || groups.some((g) => g.playerIds.some((id) => !present.has(id))) || [...present].some((id) => !groups.some((g) => g.playerIds.includes(id)))) {
                  setGroups(makeGroups(players.filter((p) => present.has(p.id)), Math.max(2, rotationSize || 2), 'level'));
                }
                setS((x) => ({ ...x, phase: 'groupes' }));
              }}
            />
          )}
          {s.phase === 'groupes' && (
            <Groups
              players={players.filter((p) => present.has(p.id))}
              byId={byId}
              groups={groups}
              setGroups={setGroups}
              defaultCount={Math.max(2, rotationSize || 2)}
              onBack={() => setS((x) => ({ ...x, phase: 'appel' }))}
              onNote={(playerId) => setNote({ playerId })}
              onNext={() => {
                unlockAudio();
                persist({ attendance: [...present], groups });
                setS((x) => ({ ...x, phase: 'seance' }));
              }}
            />
          )}
          {s.phase === 'seance' && (
            <Run
              t={t}
              exercises={exercises}
              groups={groups}
              state={s}
              setState={setS}
              onShow={setShow}
              onEditGroups={() => setS((x) => ({ ...x, phase: 'groupes', running: false, remaining: x.running ? Math.max(0, x.endsAt - Date.now()) : x.remaining }))}
              onFinish={() => setS((x) => ({ ...x, phase: 'fin', running: false }))}
            />
          )}
          {s.phase === 'fin' && (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 40 }}>
              <div style={{ fontSize: 48 }}>👏</div>
              <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>Séance terminée</h2>
              <p className="muted">
                {present.size} présents · {t.blocks.length} blocs
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => setNote({})}>
                  <MessageSquarePlus /> Ajouter des remarques
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    try {
                      localStorage.removeItem(stateKey(t.id));
                    } catch {
                      /* rien */
                    }
                    exit();
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {note && (
        <QuickNote
          players={players.filter((p) => present.size === 0 || present.has(p.id))}
          initial={note.playerId}
          trainingId={t.id}
          onClose={() => setNote(null)}
        />
      )}
      {show && <Presenter ex={show} onClose={() => setShow(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ appel */

function Roll({ players, present, setPresent, onNext }: { players: Player[]; present: Set<string>; setPresent: (s: Set<string>) => void; onNext: () => void }) {
  const toggle = (id: string) => {
    const n = new Set(present);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPresent(n);
  };
  if (!players.length)
    return <Empty title="Aucun joueur dans l’effectif" text="Ajoutez vos joueurs dans l’onglet Joueurs pour faire l’appel et les groupes." />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between wrap">
        <div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>Appel</h2>
          <p className="muted">
            {present.size} présent{present.size > 1 ? 's' : ''} sur {players.length}
          </p>
        </div>
        <button className="btn" onClick={() => setPresent(present.size === players.length ? new Set() : new Set(players.map((p) => p.id)))}>
          {present.size === players.length ? 'Tout décocher' : 'Tous présents'}
        </button>
      </div>
      <div className="roll">
        {players.map((p) => (
          <button key={p.id} className={present.has(p.id) ? 'on' : ''} onClick={() => toggle(p.id)}>
            <span className="grow">
              <b style={{ display: 'block', fontWeight: 600 }}>{p.firstName}</b>
              {p.lastName && <small className="muted">{p.lastName}</small>}
            </span>
            <span className="tick">{present.has(p.id) && <Check />}</span>
          </button>
        ))}
      </div>
      <button className="btn primary lg full" disabled={!present.size} onClick={onNext}>
        Faire les groupes <ChevronRight />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ groupes */

function Groups({
  players, byId, groups, setGroups, defaultCount, onBack, onNext, onNote,
}: {
  players: Player[];
  byId: Map<string, Player>;
  groups: Group[];
  setGroups: (g: Group[]) => void;
  defaultCount: number;
  onBack: () => void;
  onNext: () => void;
  onNote: (playerId: string) => void;
}) {
  const [count, setCount] = useState(groups.length || defaultCount);
  const [mode, setMode] = useState<Mode>('level');
  const [picked, setPicked] = useState<string | null>(null);
  const regen = (n = count, m = mode) => setGroups(makeGroups(players, n, m));

  const moveTo = (gid: string) => {
    if (!picked) return;
    setGroups(groups.map((g) => ({ ...g, playerIds: g.id === gid ? [...g.playerIds.filter((x) => x !== picked), picked] : g.playerIds.filter((x) => x !== picked) })));
    setPicked(null);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between wrap">
        <div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>Groupes</h2>
          <p className="muted">Touchez un joueur puis un groupe pour le déplacer.</p>
        </div>
        <button className="btn" onClick={() => regen()}>
          <Shuffle /> Mélanger
        </button>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={count} onChange={(n) => (setCount(n), regen(n))} options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} groupes` }))} />
        <Seg
          value={mode}
          onChange={(m) => (setMode(m), regen(count, m))}
          options={[
            { value: 'level', label: 'Équilibrés' },
            { value: 'year', label: 'Par année' },
            { value: 'random', label: 'Hasard' },
          ]}
        />
      </div>
      <div className="groups">
        {groups.map((g) => (
          <div key={g.id} className="group-card" style={{ borderColor: picked ? COLORS[g.color].hex : undefined }} onClick={() => picked && moveTo(g.id)}>
            <header>
              <i style={{ background: COLORS[g.color].hex }} />
              {g.name}
              <span className="muted small" style={{ marginLeft: 'auto', fontWeight: 500 }}>
                {g.playerIds.length}
              </span>
            </header>
            <div className="members">
              {g.playerIds.map((pid) => {
                const p = byId.get(pid);
                if (!p) return null;
                return (
                  <span
                    key={pid}
                    className={`pchip${picked === pid ? ' picked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPicked(picked === pid ? null : pid);
                    }}
                  >
                    {p.firstName}
                    <span className="lvl">{'•'.repeat(p.level ?? 2)}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {picked && (
        <div className="card pad row between" style={{ padding: 12 }}>
          <span className="small">
            <b>{byId.get(picked)?.firstName}</b> sélectionné · touchez un groupe
          </span>
          <button className="btn sm" onClick={() => onNote(picked)}>
            <MessageSquarePlus /> Remarque
          </button>
        </div>
      )}
      <div className="row">
        <button className="btn lg" onClick={onBack}>
          <ChevronLeft /> Appel
        </button>
        <button className="btn primary lg grow" onClick={onNext}>
          Démarrer la séance <Play />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ déroulé */

function durationOf(b: Block, _round: number) {
  return (b.kind === 'rotation' ? (b.roundMinutes ?? 8) : b.duration) * 60_000;
}

const fmt = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function Run({
  t, exercises, groups, state: s, setState, onShow, onEditGroups, onFinish,
}: {
  t: Training;
  exercises: Record<string, Exercise>;
  groups: Group[];
  state: LiveState;
  setState: React.Dispatch<React.SetStateAction<LiveState>>;
  onShow: (ex: Exercise) => void;
  onEditGroups: () => void;
  onFinish: () => void;
}) {
  const [, tick] = useState(0);
  const block = t.blocks[s.block];
  const stations = block?.stations ?? [];
  const isRotation = block?.kind === 'rotation' && stations.length > 0;
  const remaining = s.running ? s.endsAt - Date.now() : s.remaining;
  const total = s.stage === 'transition' ? (block?.transition ?? 30) * 1000 : block ? durationOf(block, s.round) : 1;

  useEffect(() => {
    if (!s.running) return;
    const i = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(i);
  }, [s.running]);

  const goBlock = useCallback(
    (i: number, autoStart = false) => {
      const b = t.blocks[i];
      if (!b) return onFinish();
      const d = durationOf(b, 0);
      setState((x) => ({ ...x, block: i, round: 0, stage: 'play', running: autoStart, remaining: d, endsAt: Date.now() + d }));
    },
    [t.blocks, setState, onFinish],
  );

  // Fin du chrono : sifflet, rotation automatique des ateliers.
  const fired = useRef('');
  useEffect(() => {
    if (!s.running || remaining > 0 || !block) return;
    const key = `${s.block}-${s.round}-${s.stage}`;
    if (fired.current === key) return;
    fired.current = key;
    if (isRotation && s.stage === 'play' && s.round < stations.length - 1) {
      whistle(2);
      const tr = (block.transition ?? 30) * 1000;
      if (tr > 0) setState((x) => ({ ...x, stage: 'transition', endsAt: Date.now() + tr, remaining: tr }));
      else setState((x) => ({ ...x, round: x.round + 1, stage: 'play', endsAt: Date.now() + durationOf(block, x.round + 1), remaining: durationOf(block, x.round + 1) }));
    } else if (isRotation && s.stage === 'transition') {
      whistle(1);
      const d = durationOf(block, s.round + 1);
      setState((x) => ({ ...x, round: x.round + 1, stage: 'play', endsAt: Date.now() + d, remaining: d }));
    } else {
      whistle(1, true);
      setState((x) => ({ ...x, running: false, stage: 'done', remaining: 0 }));
    }
  });

  const toggle = () => {
    unlockAudio();
    setState((x) =>
      x.running
        ? { ...x, running: false, remaining: Math.max(0, x.endsAt - Date.now()) }
        : x.stage === 'done'
          ? x
          : { ...x, running: true, endsAt: Date.now() + x.remaining },
    );
  };
  const addMinute = () =>
    setState((x) => (x.running ? { ...x, endsAt: x.endsAt + 60_000 } : { ...x, remaining: x.remaining + 60_000, stage: x.stage === 'done' ? 'play' : x.stage }));
  const skipRound = () => {
    if (!isRotation) return;
    if (s.round >= stations.length - 1) return goBlock(s.block + 1);
    const d = durationOf(block, s.round + 1);
    setState((x) => ({ ...x, round: x.round + 1, stage: 'play', remaining: d, endsAt: Date.now() + d }));
  };

  if (!block) return <Empty title="Séance vide" text="Ajoutez des blocs à la séance pour l’animer." />;

  const progress = Math.max(0, Math.min(1, 1 - remaining / total));
  const R = 88;
  const C = 2 * Math.PI * R;
  const ex = block.exerciseId ? exercises[block.exerciseId] : undefined;
  const nextBlock = t.blocks[s.block + 1];
  const roundShown = s.stage === 'transition' ? s.round + 1 : s.round;
  const ringColor = s.stage === 'transition' ? 'var(--warn)' : s.stage === 'done' ? 'var(--ink-3)' : 'var(--accent)';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="plan-mini">
        {t.blocks.map((b, i) => (
          <button key={b.id} className={i === s.block ? 'on' : i < s.block ? 'done' : ''} onClick={() => goBlock(i)}>
            {b.title}
          </button>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div className="small muted">
          {BLOCK_LABELS[block.kind]}
          {isRotation && ` · rotation ${Math.min(roundShown, stations.length - 1) + 1}/${stations.length}`}
        </div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, marginTop: 2 }}>
          {s.stage === 'transition' ? 'Changement d’atelier !' : block.title}
        </h2>
      </div>

      <div className="timer-wrap">
        <div className="timer">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle
              cx="100" cy="100" r={R} fill="none" stroke={ringColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * progress} style={{ transition: 'stroke-dashoffset .25s linear' }}
            />
          </svg>
          <div className="readout">
            <div>
              <b>{s.stage === 'done' ? '0:00' : fmt(remaining)}</b>
              <small>{s.stage === 'done' ? 'Terminé' : s.running ? (s.stage === 'transition' ? 'les groupes tournent' : 'en cours') : 'en pause'}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="live-controls">
        <button className="btn round" onClick={() => goBlock(Math.max(0, s.block - 1))} aria-label="Bloc précédent">
          <ChevronLeft />
        </button>
        <button className="btn round" onClick={addMinute} aria-label="Ajouter une minute" title="+1 min">
          <Plus />
        </button>
        {s.stage === 'done' ? (
          <button className="btn round big primary" onClick={() => goBlock(s.block + 1, true)} aria-label="Bloc suivant">
            <SkipForward />
          </button>
        ) : (
          <button className="btn round big primary" onClick={toggle} aria-label={s.running ? 'Pause' : 'Démarrer'}>
            {s.running ? <Pause /> : <Play />}
          </button>
        )}
        <button className="btn round" onClick={isRotation ? skipRound : () => goBlock(s.block + 1)} aria-label="Passer" title={isRotation ? 'Rotation suivante' : 'Bloc suivant'}>
          <SkipForward />
        </button>
        <button className="btn round" onClick={() => (unlockAudio(), whistle(1))} aria-label="Sifflet">
          <Megaphone />
        </button>
      </div>

      {isRotation ? (
        <div className="rota">
          {groups.map((g, gi) => {
            const st = stations[(gi + roundShown) % stations.length];
            const sx = st?.exerciseId ? exercises[st.exerciseId] : undefined;
            return (
              <div key={g.id} className="rota-row">
                <i style={{ background: COLORS[g.color].hex }} />
                <b style={{ minWidth: 70 }}>{g.name}</b>
                <span className="arrow">→</span>
                <span className="grow ellipsis">
                  <b>Atelier {((gi + roundShown) % stations.length) + 1}</b> · {st?.title}
                </span>
                {sx && (
                  <button className="btn sm" onClick={() => onShow(sx)}>
                    <Eye /> <span className="hide-mobile">Montrer</span>
                  </button>
                )}
              </div>
            );
          })}
          {!groups.length && <p className="muted small">Faites les groupes pour afficher la rotation.</p>}
        </div>
      ) : (
        ex && (
          <button className="btn lg full" onClick={() => onShow(ex)}>
            <Eye /> Montrer l’exercice aux enfants
          </button>
        )
      )}

      {block.notes && <div className="card pad small">{block.notes}</div>}
      {s.block === 0 && t.coachNotes && (
        <div className="card pad small" style={{ background: 'var(--warn-soft)', border: 0 }}>
          <b>Notes : </b>
          {t.coachNotes}
        </div>
      )}

      <div className="row between small muted" style={{ marginTop: 8 }}>
        <button className="btn ghost sm" onClick={onEditGroups}>
          Modifier les groupes
        </button>
        {nextBlock ? (
          <span>
            Ensuite : {nextBlock.title} · {blockMinutes(nextBlock)} min
          </span>
        ) : (
          <button className="btn sm" onClick={onFinish}>
            Terminer la séance
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ remarque rapide */

export function QuickNote({ players, initial, trainingId, onClose }: { players: Player[]; initial?: string; trainingId?: string; onClose: () => void }) {
  const toast = useToast();
  const [pid, setPid] = useState<string | undefined>(initial);
  const [kind, setKind] = useState<NoteKind>('remarque');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pid || !text.trim()) return;
    setBusy(true);
    try {
      await api.put(`/notes/${uid()}`, { playerId: pid, kind, text, visibility: 'staff', trainingId });
      toast('Remarque ajoutée');
      setText('');
      setPid(undefined);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Remarque rapide"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!pid || !text.trim() || busy} onClick={save}>
          Enregistrer
        </button>
      }
    >
      <div className="stack">
        <div className="chips" style={{ maxHeight: 160, overflowY: 'auto' }}>
          {players.map((p) => (
            <button key={p.id} className={`chip${pid === p.id ? ' on' : ''}`} onClick={() => setPid(p.id)}>
              {playerName(p)}
            </button>
          ))}
        </div>
        <div className="chips">
          {NOTE_KINDS.map((k) => (
            <button key={k.value} className={`chip${kind === k.value ? ' on' : ''}`} onClick={() => setKind(k.value)}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <textarea className="textarea" autoFocus placeholder="Ce que vous avez observé…" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </Sheet>
  );
}
