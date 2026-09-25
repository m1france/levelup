import {
  ArrowLeft, ArrowRight, CalendarDays, Clock, Coffee, Copy, Flame, Globe, LayoutGrid, Link2, Maximize2, MoreHorizontal, Pencil,
  Play, Plus, Printer, RefreshCw, Repeat, Snowflake, Swords, Target, Trash2, X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ItemIcon } from '../components/ItemIcon';
import { ExercisePlayer, LivePitch, Presenter, SceneThumb } from '../components/Pitch';
import { Empty, Menu, Seg, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { formatDate, useApp } from '../lib/store';
import type { Block, Exercise, ItemKind, Training, TrainingPayload } from '../lib/types';
import { COLORS, ITEM_LABELS, equipmentOf, pluralize } from '../pitch/geometry';
import { ExerciseSheet } from './ExerciseEditor';
import { ExerciseCard, createExercise, useExerciseSearch } from './Library';
import { BLOCK_LABELS, blockMinutes, totalMinutes } from './Trainings';

export const BLOCK_ICONS: Record<Block['kind'], React.ReactNode> = {
  warmup: <Flame />,
  exercise: <Target />,
  rotation: <Repeat />,
  game: <Swords />,
  break: <Coffee />,
  cooldown: <Snowflake />,
};
export const BLOCK_COLORS: Record<Block['kind'], string> = {
  warmup: '#e8903a', exercise: '#5873d8', rotation: '#3f8f63', game: '#8b5cf6', break: '#c9c6bc', cooldown: '#2aa3bf',
};

/** Matériel de la séance : les ateliers tournants s'additionnent, les blocs successifs réutilisent le matériel. */
export function trainingEquipment(t: Training, exercises: Record<string, Exercise>) {
  const need = new Map<string, number>();
  const bibs = new Map<string, number>();
  const merge = (list: ReturnType<typeof equipmentOf>[]) => {
    const sum = new Map<string, number>();
    const sumB = new Map<string, number>();
    for (const eq of list) {
      for (const e of eq.list) sum.set(e.kind, (sum.get(e.kind) ?? 0) + e.count);
      for (const b of eq.bibs) sumB.set(b.color, (sumB.get(b.color) ?? 0) + b.count);
    }
    for (const [k, n] of sum) need.set(k, Math.max(need.get(k) ?? 0, n));
    for (const [k, n] of sumB) bibs.set(k, Math.max(bibs.get(k) ?? 0, n));
  };
  for (const b of t.blocks) {
    const ids = b.kind === 'rotation' ? (b.stations ?? []).map((s) => s.exerciseId) : [b.exerciseId];
    merge(ids.filter((id): id is string => !!id && !!exercises[id]).map((id) => equipmentOf(exercises[id])));
  }
  return { list: [...need].map(([kind, count]) => ({ kind: kind as ItemKind, count })), bibs: [...bibs].map(([color, count]) => ({ color, count })) };
}

export function TrainingPage() {
  const { id } = useParams();
  const { isStaff, can } = useApp();
  const q = useAsync(() => api.get<TrainingPayload>(`/trainings/${id}`), [id]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Séance introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/">Retour à l’accueil</Link>} />
      </div>
    );
  return isStaff && can('trainings.manage') ? <Planner key={q.data.training.id} data={q.data} /> : <TrainingView data={q.data} />;
}

/* ================================================================== lecture (parents, dirigeants) */

export function TrainingView({ data, publicView }: { data: TrainingPayload; publicView?: boolean }) {
  const { training: t, exercises } = data;
  const eq = trainingEquipment(t, exercises);
  return (
    <div className={publicView ? 'public-wrap' : 'page'}>
      {!publicView && (
        <Link to="/" className="back">
          <ArrowLeft size={15} /> Séances
        </Link>
      )}
      <div className="page-head">
        <div>
          {publicView && t.club && <div className="muted small" style={{ marginBottom: 6 }}>{t.club} · {t.team?.category}</div>}
          <h1>{t.title}</h1>
          <div className="sub">
            {formatDate(t.date)} · {totalMinutes(t)} min{t.theme ? ` · ${t.theme}` : ''}
          </div>
        </div>
      </div>
      {t.notes && (
        <div className="card pad" style={{ marginBottom: 20, background: 'var(--accent-soft)', border: 0 }}>
          <b className="small" style={{ color: 'var(--accent)' }}>Message des éducateurs</b>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.notes}</p>
        </div>
      )}
      <div className="stack" style={{ gap: 24 }}>
        {t.blocks.map((b) => {
          const exs = (b.kind === 'rotation' ? (b.stations ?? []).map((s) => ({ ex: s.exerciseId ? exercises[s.exerciseId] : undefined, title: s.title })) : [{ ex: b.exerciseId ? exercises[b.exerciseId] : undefined, title: b.title }]);
          return (
            <section key={b.id}>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className={`kind kind-${b.kind}`} style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center' }}>
                  {BLOCK_ICONS[b.kind]}
                </span>
                <div className="grow">
                  <b>{b.title}</b>
                  <div className="small muted">
                    {BLOCK_LABELS[b.kind]} · {blockMinutes(b)} min
                  </div>
                </div>
              </div>
              {b.notes && <p className="muted" style={{ marginBottom: 10 }}>{b.notes}</p>}
              <div className="stack">
                {exs.map(({ ex, title }, i) =>
                  ex ? (
                    <div key={i} className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
                      <ExercisePlayer ex={ex} />
                      <ExerciseSheet ex={ex} />
                    </div>
                  ) : b.kind === 'rotation' ? (
                    <div key={i} className="station">
                      <span className="n">{i + 1}</span> {title}
                    </div>
                  ) : null,
                )}
              </div>
            </section>
          );
        })}
      </div>
      {!publicView && (eq.list.length > 0 || eq.bibs.length > 0) && <EquipmentCard eq={eq} />}
    </div>
  );
}

function EquipmentCard({ eq }: { eq: ReturnType<typeof trainingEquipment> }) {
  return (
    <div className="card pad" style={{ marginTop: 20 }}>
      <div className="section-title">Matériel à prévoir</div>
      <div className="chips">
        {eq.list.map((e) => (
          <span key={e.kind} className="chip" style={{ cursor: 'default' }}>
            <ItemIcon kind={e.kind} /> {pluralize(e.count, ITEM_LABELS[e.kind])}
          </span>
        ))}
        {eq.bibs.map((b) => (
          <span key={b.color} className="chip" style={{ cursor: 'default' }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: COLORS[b.color]?.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />
            {b.count} chasuble{b.count > 1 ? 's' : ''} {COLORS[b.color]?.label.toLowerCase()}
            {b.count > 1 ? 's' : ''}
          </span>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Calculé depuis les schémas : les ateliers tournants sont additionnés.
      </p>
    </div>
  );
}

/* ================================================================== planification */

type Slot = { block: string; station?: string };

function Planner({ data }: { data: TrainingPayload }) {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useApp();
  const [t, setT] = useState<Training>(data.training);
  const [exercises, setExercises] = useState<Record<string, Exercise>>(data.exercises);
  const [picker, setPicker] = useState<Slot | 'new' | null>(null);
  const [present, setPresent] = useState<Exercise | null>(null);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'error'>('saved');
  const [creating, setCreating] = useState(false);
  const tRef = useRef(t);
  const timer = useRef<number | undefined>(undefined);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setSaving('saving');
    try {
      await api.put(`/trainings/${tRef.current.id}`, tRef.current);
      setSaving('saved');
    } catch (e) {
      setSaving('error');
      toast((e as Error).message, true);
    }
  }, [toast]);

  const update = (fn: (d: Training) => void) => {
    const d = structuredClone(tRef.current);
    fn(d);
    for (const b of d.blocks) if (b.kind === 'rotation') b.duration = blockMinutes(b);
    tRef.current = d;
    setT(d);
    setSaving('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 600);
  };
  useEffect(() => () => void (timer.current && api.put(`/trainings/${tRef.current.id}`, tRef.current)), []);

  const updateBlock = (id: string, fn: (b: Block) => void) => update((d) => fn(d.blocks.find((b) => b.id === id)!));

  /** Rattache un exercice à un emplacement (bloc, atelier) ou l'ajoute à la fin de la séance. */
  const attach = (ex: Exercise, slot: Slot | 'new') => {
    setExercises((m) => ({ ...m, [ex.id]: ex }));
    update((d) => {
      if (slot === 'new') {
        d.blocks.push({ id: uid(8), kind: 'exercise', title: ex.title, duration: ex.duration || 10, exerciseId: ex.id });
        return;
      }
      const b = d.blocks.find((x) => x.id === slot.block);
      if (!b) return;
      if (slot.station) {
        const s = b.stations?.find((x) => x.id === slot.station);
        if (s) Object.assign(s, { exerciseId: ex.id, title: ex.title });
      } else Object.assign(b, { exerciseId: ex.id, title: ex.title });
    });
  };

  /** Crée un exercice vierge, l'ajoute à la séance et ouvre l'éditeur visuel. */
  const createAndEdit = async (slot: Slot | 'new' = 'new') => {
    if (creating) return;
    setCreating(true);
    try {
      const ex = await createExercise();
      attach(ex, slot);
      await save();
      nav(`/exercices/${ex.id}`);
    } catch (e) {
      toast((e as Error).message, true);
      setCreating(false);
    }
  };

  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.blocks.length) return;
      [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
    });

  const addRotation = () =>
    update((d) =>
      d.blocks.push({ id: uid(8), kind: 'rotation', title: 'Ateliers tournants', duration: 0, roundMinutes: 8, transition: 30, stations: [] }),
    );

  const togglePublish = async () => {
    update((d) => void (d.published = !d.published));
    await save();
    toast(tRef.current.published ? 'Séance visible par les parents' : 'Séance retirée de l’espace parents');
  };

  const share = async (enabled: boolean) => {
    await save();
    const r = await api.post<{ shareToken: string | null }>(`/trainings/${t.id}/share`, { enabled });
    const next = { ...tRef.current, shareToken: r.shareToken };
    tRef.current = next;
    setT(next);
    if (r.shareToken) {
      await navigator.clipboard?.writeText(`${location.origin}/s/${r.shareToken}`).catch(() => {});
      toast('Lien copié');
    } else toast('Lien public désactivé');
  };

  const duplicate = async () => {
    await save();
    const { id: _id, attendance: _a, groups: _g, shareToken: _s, updatedAt: _u, cover: _c, ...rest } = tRef.current;
    const r = await api.put<{ training: Training }>(`/trainings/${uid()}`, { ...rest, title: `${rest.title} (copie)`, published: false });
    nav(`/seances/${r.training.id}`);
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer la séance ?', confirm: 'Supprimer', danger: true }))) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    await api.del(`/trainings/${t.id}`);
    nav('/', { replace: true });
  };

  const total = totalMinutes(t);
  const empty = !t.blocks.length;

  return (
    <div className="page planner">
      <div className="row between no-print" style={{ marginBottom: 6 }}>
        <Link to="/" className="back" style={{ margin: 0 }}>
          <ArrowLeft size={15} /> Séances
        </Link>
        <span className={`save-dot ${saving}`} title={saving === 'saving' ? 'Enregistrement…' : saving === 'error' ? 'Erreur d’enregistrement' : 'Enregistré'} />
      </div>

      <div className="plan-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <input className="plan-title" value={t.title} onChange={(e) => update((d) => void (d.title = e.target.value))} placeholder="Nom de la séance" aria-label="Nom de la séance" />
          <div className="plan-meta">
            <label className="meta-pill">
              <CalendarDays />
              <input
                type="datetime-local"
                value={t.date.length === 10 ? `${t.date}T18:00` : t.date}
                onChange={(e) => e.target.value && update((d) => void (d.date = e.target.value))}
                aria-label="Date"
              />
            </label>
            {total > 0 && (
              <span className="meta-pill">
                <Clock /> {total} min
              </span>
            )}
            {t.published && (
              <span className="meta-pill on" title="Visible par les parents">
                <Globe />
              </span>
            )}
          </div>
        </div>
        <div className="row no-print" style={{ gap: 8 }}>
          {!empty && (
            <button className="btn primary lg" onClick={async () => (await save(), nav(`/seances/${t.id}/live`))}>
              <Play fill="currentColor" /> <span className="hide-mobile">Lancer</span>
            </button>
          )}
          <Menu
            trigger={(open) => (
              <button className="btn icon lg" onClick={open} aria-label="Plus d’actions">
                <MoreHorizontal />
              </button>
            )}
          >
            {(close) => (
              <>
                <button onClick={() => (close(), setPicker('new'))}>
                  <LayoutGrid /> Ajouter depuis la bibliothèque
                </button>
                <button onClick={() => (close(), addRotation())}>
                  <Repeat /> Ajouter des ateliers tournants
                </button>
                {can('trainings.publish') && (
                  <>
                    <button onClick={() => (close(), void togglePublish())}>
                      <Globe /> {t.published ? 'Retirer de l’espace parents' : 'Publier aux parents'}
                    </button>
                    <button onClick={() => (close(), void share(true))}>
                      <Link2 /> {t.shareToken ? 'Copier le lien public' : 'Créer un lien public'}
                    </button>
                    {t.shareToken && (
                      <button onClick={() => (close(), void share(false))}>
                        <X /> Désactiver le lien public
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => (close(), window.print())}>
                  <Printer /> Imprimer
                </button>
                <button onClick={() => (close(), void duplicate())}>
                  <Copy /> Dupliquer
                </button>
                <button onClick={() => (close(), void remove())} style={{ color: 'var(--danger)' }}>
                  <Trash2 /> Supprimer
                </button>
              </>
            )}
          </Menu>
        </div>
      </div>

      {empty ? (
        <div className="plan-empty">
          <button className="btn primary lg" onClick={() => createAndEdit()} disabled={creating}>
            <Plus /> Créer un exercice
          </button>
        </div>
      ) : (
        <div className="plan-grid">
          {t.blocks.map((b, i) =>
            b.kind === 'rotation' ? (
              <RotationGroup
                key={b.id}
                block={b}
                exercises={exercises}
                first={i === 0}
                last={i === t.blocks.length - 1}
                onMove={(dir) => move(i, dir)}
                onChange={(fn) => updateBlock(b.id, fn)}
                onRemove={() => update((d) => void (d.blocks = d.blocks.filter((x) => x.id !== b.id)))}
                onOpen={(ex) => nav(`/exercices/${ex.id}`)}
                onPresent={setPresent}
                onCreate={(station) => createAndEdit({ block: b.id, station })}
                onPick={(station) => setPicker({ block: b.id, station })}
              />
            ) : (
              <ExerciseTile
                key={b.id}
                ex={b.exerciseId ? exercises[b.exerciseId] : undefined}
                title={b.title}
                minutes={b.duration}
                onMinutes={(m) => updateBlock(b.id, (x) => void (x.duration = m))}
                onOpen={(ex) => nav(`/exercices/${ex.id}`)}
                onPresent={setPresent}
                onCreate={() => createAndEdit({ block: b.id })}
                onPick={() => setPicker({ block: b.id })}
                onMove={(dir) => move(i, dir)}
                first={i === 0}
                last={i === t.blocks.length - 1}
                onRemove={() => update((d) => void (d.blocks = d.blocks.filter((x) => x.id !== b.id)))}
              />
            ),
          )}
          <button className="tile-add" onClick={() => createAndEdit()} disabled={creating} aria-label="Nouvel exercice">
            <Plus />
          </button>
        </div>
      )}

      {picker && (
        <ExercisePicker
          onPick={(ex) => {
            attach(ex, picker);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {present && <Presenter ex={present} onClose={() => setPresent(null)} />}
    </div>
  );
}

/** Carte d'exercice : grand visuel (animé au survol), titre, durée et actions discrètes. */
function ExerciseTile({
  ex, title, minutes, onMinutes, onOpen, onPresent, onCreate, onPick, onMove, onRemove, first, last, compact,
}: {
  ex?: Exercise;
  title: string;
  minutes?: number;
  onMinutes?: (m: number) => void;
  onOpen: (ex: Exercise) => void;
  onPresent: (ex: Exercise) => void;
  onCreate: () => void;
  onPick: () => void;
  onMove?: (dir: -1 | 1) => void;
  onRemove: () => void;
  first?: boolean;
  last?: boolean;
  compact?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div className={`x-tile${compact ? ' compact' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="x-cover" onClick={() => (ex ? onOpen(ex) : onCreate())}>
        {ex ? (
          hover && ex.frames.length > 1 ? <LivePitch ex={ex} /> : <SceneThumb ex={ex} />
        ) : (
          <span className="x-empty">
            <Plus />
          </span>
        )}
        {ex && (
          <button
            className="x-play"
            onClick={(e) => {
              e.stopPropagation();
              onPresent(ex);
            }}
            aria-label="Montrer en plein écran"
          >
            <Maximize2 />
          </button>
        )}
      </div>
      <div className="x-foot">
        <b className="ellipsis" title={ex?.title ?? title}>
          {ex?.title ?? title}
        </b>
        {minutes !== undefined && onMinutes && (
          <label className="x-min" title="Durée (minutes)">
            <input
              type="number"
              min={1}
              max={120}
              value={minutes}
              onChange={(e) => onMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              aria-label="Durée en minutes"
            />
            min
          </label>
        )}
        <Menu
          trigger={(open) => (
            <button className="btn icon sm ghost" onClick={open} aria-label="Actions">
              <MoreHorizontal />
            </button>
          )}
        >
          {(close) => (
            <>
              {ex && (
                <button onClick={() => (close(), onOpen(ex))}>
                  <Pencil /> Modifier le schéma
                </button>
              )}
              <button onClick={() => (close(), onPick())}>
                <RefreshCw /> {ex ? 'Remplacer' : 'Choisir dans la bibliothèque'}
              </button>
              {onMove && !first && (
                <button onClick={() => (close(), onMove(-1))}>
                  <ArrowLeft /> Avancer
                </button>
              )}
              {onMove && !last && (
                <button onClick={() => (close(), onMove(1))}>
                  <ArrowRight /> Reculer
                </button>
              )}
              <button onClick={() => (close(), onRemove())} style={{ color: 'var(--danger)' }}>
                <Trash2 /> Retirer
              </button>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

/** Ateliers tournants : un groupe d'ateliers joués en parallèle. */
function RotationGroup({
  block: b, exercises, first, last, onMove, onChange, onRemove, onOpen, onPresent, onCreate, onPick,
}: {
  block: Block;
  exercises: Record<string, Exercise>;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onChange: (fn: (b: Block) => void) => void;
  onRemove: () => void;
  onOpen: (ex: Exercise) => void;
  onPresent: (ex: Exercise) => void;
  onCreate: (station: string) => void;
  onPick: (station: string) => void;
}) {
  const addStation = () => {
    const id = uid(8);
    onChange((x) => void (x.stations = [...(x.stations ?? []), { id, title: `Atelier ${(x.stations?.length ?? 0) + 1}` }]));
    return id;
  };
  return (
    <div className="rot-group">
      <div className="rot-head">
        <Repeat size={16} />
        <label className="x-min">
          <input
            type="number"
            min={1}
            max={30}
            value={b.roundMinutes ?? 8}
            onChange={(e) => onChange((x) => void (x.roundMinutes = Math.max(1, Math.min(30, Number(e.target.value) || 1))))}
            aria-label="Minutes par atelier"
          />
          min / atelier
        </label>
        <span className="grow" />
        <Menu
          trigger={(open) => (
            <button className="btn icon sm ghost" onClick={open} aria-label="Actions">
              <MoreHorizontal />
            </button>
          )}
        >
          {(close) => (
            <>
              {!first && (
                <button onClick={() => (close(), onMove(-1))}>
                  <ArrowLeft /> Avancer
                </button>
              )}
              {!last && (
                <button onClick={() => (close(), onMove(1))}>
                  <ArrowRight /> Reculer
                </button>
              )}
              <button onClick={() => (close(), onRemove())} style={{ color: 'var(--danger)' }}>
                <Trash2 /> Retirer les ateliers
              </button>
            </>
          )}
        </Menu>
      </div>
      <div className="rot-stations">
        {(b.stations ?? []).map((s) => (
          <ExerciseTile
            key={s.id}
            compact
            ex={s.exerciseId ? exercises[s.exerciseId] : undefined}
            title={s.title}
            onOpen={onOpen}
            onPresent={onPresent}
            onCreate={() => onCreate(s.id)}
            onPick={() => onPick(s.id)}
            onRemove={() => onChange((x) => void (x.stations = x.stations!.filter((y) => y.id !== s.id)))}
          />
        ))}
        <button className="tile-add compact" onClick={() => onCreate(addStation())} aria-label="Nouvel atelier">
          <Plus />
        </button>
      </div>
    </div>
  );
}

export function ExercisePicker({ onPick, onClose }: { onPick: (ex: Exercise) => void; onClose: () => void }) {
  const [scope, setScope] = useState<'mine' | 'club'>('mine');
  const { can } = useApp();
  const nav = useNavigate();
  const q = useAsync(() => api.get<Exercise[]>(`/exercises?scope=${scope}`), [scope]);
  const { filtered, controls } = useExerciseSearch(q.data);
  return (
    <Sheet title="Choisir un exercice" onClose={onClose} wide>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <Seg value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mes exercices' }, { value: 'club', label: 'Club' }]} />
        {can('exercises.create') && (
          <button className="btn sm" onClick={async () => nav(`/exercices/${(await createExercise()).id}`)}>
            <Plus /> Créer un exercice
          </button>
        )}
      </div>
      {controls}
      {q.loading && !q.data ? (
        <Spinner />
      ) : filtered.length ? (
        <div className="grid auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {filtered.map((ex) => (
            <ExerciseCard key={ex.id} ex={ex} onClick={() => onPick(ex)} />
          ))}
        </div>
      ) : (
        <Empty title="Aucun exercice" text={scope === 'mine' ? 'Regardez dans la bibliothèque du club.' : undefined} />
      )}
    </Sheet>
  );
}
