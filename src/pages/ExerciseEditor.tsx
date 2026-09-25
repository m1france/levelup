import {
  ArrowLeft, BadgeCheck, Check, ChevronRight, Copy, Download, Magnet, Maximize2, Minus, MoreHorizontal, MousePointer2,
  NotebookPen, PanelRight, Pause, PenLine, Play, Plus, Proportions, Redo2, RotateCcw, RotateCw, Trash2, Undo2, Users, X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ItemIcon, type IconKind } from '../components/ItemIcon';
import { ExercisePlayer, Presenter } from '../components/Pitch';
import { Empty, Field, Menu, Seg, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { useApp } from '../lib/store';
import type { Exercise, ExerciseData, FieldPreset, Item, ItemKind, KitPattern, PathKind } from '../lib/types';
import { buildTimeline, evaluate, type Positions } from '../pitch/anim';
import {
  COLORABLE, attachTarget, circlePoints, clampToField, deleteIds, distribute, duplicateIds, finishPath, gridPoints, idsInRect, itemAt,
  measureBetween, newItem, ownerAt, pathAt, rectCorners, round, setOwner, setPos, shortId, slalomPoints, snapV,
} from '../pitch/editing';
import { canExportVideo, exportVideo, shareOrDownload } from '../pitch/export';
import {
  COLORS, ITEM_LABELS, PLAYER_COLORS, PRESETS, computeView, dist, equipmentOf, itemUnit, pluralize, type Vec, type View,
} from '../pitch/geometry';
import { PATH_STYLE, drawScene } from '../pitch/render';
import { fitCanvas, usePlayback, useSize } from '../pitch/usePitch';

export function ExerciseEditor() {
  const { id } = useParams();
  const { me } = useApp();
  const q = useAsync(() => api.get<Exercise>(`/exercises/${id}`), [id]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Exercice introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/exercices">Retour à la bibliothèque</Link>} />
      </div>
    );
  const mine = q.data.ownerId === me.user.id || me.user.role === 'admin';
  return mine ? <Editor key={q.data.id} initial={q.data} /> : <ExerciseView ex={q.data} onChange={q.setData} />;
}

/* ================================================================== lecture seule */

function ExerciseView({ ex, onChange }: { ex: Exercise; onChange: (e: Exercise) => void }) {
  const { can } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const duplicate = async () => {
    const copy = await duplicateExercise(ex);
    toast('Ajouté à vos exercices');
    nav(`/exercices/${copy.id}`);
  };
  const validate = async (v: boolean) => {
    onChange(await api.post<Exercise>(`/exercises/${ex.id}/validate`, { validated: v }));
    toast(v ? 'Exercice validé pour le club' : 'Validation retirée');
  };
  return (
    <div className="page">
      <Link to="/exercices" className="back">
        <ArrowLeft size={15} /> Bibliothèque
      </Link>
      <div className="page-head">
        <div>
          <h1>{ex.title}</h1>
          <div className="sub">Par {ex.ownerName} · {ex.duration} min · {ex.players} joueurs</div>
        </div>
        <div className="actions">
          {can('library.validate') && ex.visibility === 'club' && (
            <button className="btn" onClick={() => validate(!ex.validated)}>
              <BadgeCheck /> {ex.validated ? 'Retirer la validation' : 'Valider'}
            </button>
          )}
          {can('exercises.create') && (
            <button className="btn primary" onClick={duplicate}>
              <Copy /> Dupliquer dans mes exercices
            </button>
          )}
        </div>
      </div>
      <div className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <ExercisePlayer ex={ex} autoplay />
        <ExerciseSheet ex={ex} />
      </div>
    </div>
  );
}

export function ExerciseSheet({ ex }: { ex: ExerciseData & { validated?: boolean } }) {
  const eq = equipmentOf(ex);
  return (
    <div className="card pad stack" style={{ gap: 16 }}>
      <div className="chips">
        {ex.validated && (
          <span className="badge green">
            <BadgeCheck /> Validé club
          </span>
        )}
        {ex.themes.map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
      </div>
      {ex.objective && (
        <div>
          <div className="section-title">Objectif</div>
          <p>{ex.objective}</p>
        </div>
      )}
      {ex.instructions && (
        <div>
          <div className="section-title">Consignes</div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{ex.instructions}</p>
        </div>
      )}
      {(ex.easier || ex.harder) && (
        <div className="grid cols-2" style={{ gap: 10 }}>
          {ex.easier && (
            <div className="card pad" style={{ background: 'var(--accent-soft)', border: 0, padding: 12 }}>
              <b className="small">Plus facile</b>
              <p className="small">{ex.easier}</p>
            </div>
          )}
          {ex.harder && (
            <div className="card pad" style={{ background: 'var(--warn-soft)', border: 0, padding: 12 }}>
              <b className="small">Plus difficile</b>
              <p className="small">{ex.harder}</p>
            </div>
          )}
        </div>
      )}
      <Equipment ex={ex} eq={eq} />
    </div>
  );
}

function Equipment({ eq }: { ex: ExerciseData; eq: ReturnType<typeof equipmentOf> }) {
  if (!eq.list.length && !eq.bibs.length) return null;
  return (
    <div>
      <div className="section-title">Matériel</div>
      <div className="chips">
        {eq.list.map((e) => (
          <span key={e.kind} className="chip" style={{ cursor: 'default' }}>
            <ItemIcon kind={e.kind} /> {pluralize(e.count, e.label)}
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
    </div>
  );
}

export async function duplicateExercise(ex: Exercise): Promise<Exercise> {
  const { id: _id, ownerId: _o, ownerName: _n, validated: _v, updatedAt: _u, ...data } = ex;
  const copy = { ...structuredClone(data), title: ex.title.endsWith('(copie)') ? ex.title : `${ex.title} (copie)`, visibility: 'private' as const };
  return api.put<Exercise>(`/exercises/${uid()}`, copy);
}

/* ================================================================== éditeur */

/** Outils qui tracent une forme au glisser (du point de départ au point d'arrivée). */
type ShapeTool = 'line' | 'square' | 'zone' | 'circle' | 'slalom' | 'grid' | 'measure';

type Tool = { t: 'select' } | { t: 'add'; kind: ItemKind } | { t: 'draw' } | { t: ShapeTool };

type Drag =
  | {
      kind: 'items'; ids: string[]; start: Vec; orig: Map<string, Vec>; moved: boolean; base: boolean; created?: boolean;
      /** Tracés entraînés avec les éléments (sélection multiple). */
      paths: Map<string, [number, number][]>;
    }
  | { kind: 'marquee'; start: Vec; cur: Vec; additive: boolean }
  | { kind: 'draw'; pts: Vec[] }
  | { kind: ShapeTool; start: Vec; cur: Vec };

type PanelKey = 'fiche' | 'terrain';

const PANELS: { key: PanelKey; label: string; icon: React.ReactNode }[] = [
  { key: 'fiche', label: 'Fiche', icon: <NotebookPen /> },
  { key: 'terrain', label: 'Terrain', icon: <Proportions /> },
];

const EQUIPMENT: ItemKind[] = [
  'cone', 'marker', 'pole', 'flag', 'hoop', 'hurdle', 'ladder', 'minigoal', 'goal', 'rebounder', 'dummy', 'wall', 'ballbag',
];
const SHAPES: { key: ShapeTool | 'text'; label: string }[] = [
  { key: 'zone', label: 'Zone' },
  { key: 'line', label: 'Ligne' },
  { key: 'square', label: 'Carré' },
  { key: 'circle', label: 'Cercle' },
  { key: 'slalom', label: 'Slalom' },
  { key: 'grid', label: 'Grille' },
  { key: 'measure', label: 'Mesure' },
  { key: 'text', label: 'Texte' },
];
const GEAR_COLORS = ['orange', 'yellow', 'red', 'blue', 'green', 'white'];
const INK_COLORS = ['white', 'yellow', 'red', 'blue', 'black'];
const KITS: { value: KitPattern; label: string }[] = [
  { value: 'plain', label: 'Uni' },
  { value: 'stripes', label: 'Rayé' },
  { value: 'hoops', label: 'Cerclé' },
  { value: 'halves', label: 'Moitié' },
];
/** Palette de couleurs proposée pour un élément. */
const colorsFor = (kind: ItemKind) =>
  kind === 'player' || kind === 'coach' ? PLAYER_COLORS : kind === 'text' || kind === 'measure' || kind === 'zone' ? INK_COLORS : GEAR_COLORS;
/** Couleur par défaut de l'outil : on garde celle choisie, sauf si elle n'existe pas pour ce matériel. */
const defaultColor = (kind: ItemKind, gear: string) => {
  if (!COLORABLE.has(kind)) return undefined;
  if (kind === 'text' || kind === 'measure' || kind === 'zone') return gear === 'orange' ? 'white' : gear;
  if (kind === 'pole' || kind === 'hoop' || kind === 'ladder' || kind === 'dummy' || kind === 'wall') return gear === 'orange' ? 'yellow' : gear;
  if (kind === 'flag') return gear === 'orange' ? 'red' : gear;
  if (kind === 'rebounder') return gear === 'orange' ? 'blue' : gear;
  if (kind === 'minigoal' || kind === 'coach') return undefined;
  return gear;
};

function Editor({ initial }: { initial: Exercise }) {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useApp();

  const [ex, setEx] = useState<Exercise>(initial);
  const exRef = useRef(ex);
  const past = useRef<Exercise[]>([]);
  const future = useRef<Exercise[]>([]);
  const [, bump] = useState(0);

  const [k, setK] = useState(0);
  const [tool, setTool] = useState<Tool>({ t: 'select' });
  const [color, setColor] = useState('blue');
  const [gearColor, setGearColor] = useState('orange');
  const [drawKind, setDrawKind] = useState<PathKind | 'auto'>('auto');
  const [lineKind, setLineKind] = useState<'cone' | 'marker' | 'pole'>('cone');
  const [lineCount, setLineCount] = useState(5);
  const [circleCount, setCircleCount] = useState(8);
  const [slalomCount, setSlalomCount] = useState(6);
  const [gridStep, setGridStep] = useState(5);
  const [snap, setSnap] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<{ path?: ExerciseData['paths'][number]; items?: ExerciseData['items']; rect?: [Vec, Vec] } | null>(null);
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [present, setPresent] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline' | 'error'>('saved');
  const [exporting, setExporting] = useState<number | null>(null);

  const tl = useMemo(() => buildTimeline(ex), [ex]);
  const pb = usePlayback(ex, { loop: false });
  const u = itemUnit(ex.field);
  const lastFrame = ex.frames.length - 1;
  const frame = Math.min(k, lastFrame);

  /* ---------------------------------------------------------------- historique */

  const apply = useCallback((next: Exercise, history: boolean | Exercise) => {
    if (history) {
      past.current.push(history === true ? exRef.current : history);
      if (past.current.length > 120) past.current.shift();
      future.current = [];
    }
    exRef.current = next;
    setEx(next);
    bump((n) => n + 1);
  }, []);

  const mutate = useCallback(
    (fn: (d: Exercise) => void, history: boolean | Exercise = true) => {
      const d = structuredClone(exRef.current);
      fn(d);
      apply(d, history);
    },
    [apply],
  );

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(exRef.current);
    apply(prev, false);
    setSelection(new Set());
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(exRef.current);
    apply(next, false);
  };

  /* ---------------------------------------------------------------- sauvegarde auto */

  const lastSaved = useRef(JSON.stringify(initial));
  const saveTimer = useRef<number | undefined>(undefined);
  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    setSaveState('saving');
    try {
      const json = JSON.stringify(exRef.current);
      await api.put(`/exercises/${exRef.current.id}`, exRef.current);
      lastSaved.current = json;
      setSaveState(navigator.onLine ? 'saved' : 'offline');
    } catch (e) {
      setSaveState('error');
      toast((e as Error).message, true);
    }
  }, [toast]);

  useEffect(() => {
    if (JSON.stringify(ex) === lastSaved.current) return;
    setSaveState('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 700);
  }, [ex, save]);

  useEffect(
    () => () => {
      if (saveTimer.current) void api.put(`/exercises/${exRef.current.id}`, exRef.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- canvas */

  const [stageRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const drags = useRef(new Map<number, Drag>());
  const snapshot = useRef<Exercise | null>(null);

  const displayPos = useMemo(
    (): Positions => (pb.playing ? evaluate(ex, tl, Math.min(pb.time, tl.total)).pos : tl.rest[frame]),
    [ex, tl, frame, pb.playing, pb.time],
  );

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.width) return;
    const dpr = fitCanvas(c, size.width, size.height);
    const view = computeView(ex.field, size.width, size.height, true);
    viewRef.current = view;
    drawScene(c.getContext('2d')!, ex, {
      view,
      dpr,
      pos: displayPos,
      showPaths: !pb.playing,
      selected: pb.playing ? undefined : selection,
      ghost: !pb.playing && frame > 0 ? tl.rest[frame - 1] : undefined,
      draft: draft ?? undefined,
    });
  }, [ex, tl, size, displayPos, selection, draft, frame, pb.playing]);

  const toWorldPt = (e: RPointerEvent | React.DragEvent): Vec => {
    const r = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current!;
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return v.rot ? [(sy - v.oy) / v.s, v.fh - (sx - v.ox) / v.s] : [(sx - v.ox) / v.s, (sy - v.oy) / v.s];
  };

  const snapP = (p: Vec) => snapV(clampToField(exRef.current, p), snap);

  /* ---------------------------------------------------------------- gestes */

  /** Éléments (et contour) d'une forme tracée au glisser, pour l'aperçu comme pour la création. */
  const shapeOf = (kind: ShapeTool, a: Vec, b: Vec): { items: Item[]; rect?: [Vec, Vec] } => {
    const cur = exRef.current;
    const put = (k: ItemKind, pts: Vec[]) => pts.map((p) => newItem(cur, k, p, defaultColor(k, gearColor)));
    switch (kind) {
      case 'line': return { items: put(lineKind, distribute(a, b, lineCount)) };
      case 'square': return { items: put('cone', rectCorners(a, b)), rect: [a, b] };
      case 'circle': return { items: put('cone', circlePoints(a, b, circleCount)) };
      case 'slalom': return { items: put('pole', slalomPoints(a, b, slalomCount, Math.min(1, dist(a, b) / (slalomCount * 2)))) };
      case 'grid': return { items: put('cone', gridPoints(a, b, gridStep)), rect: [a, b] };
      case 'measure': return { items: dist(a, b) > 0.4 ? [measureBetween(cur, a, b, defaultColor('measure', gearColor))] : [] };
      case 'zone': return { items: [], rect: [a, b] };
    }
  };

  const startGroupDrag = (pointerId: number, w: Vec, itemIds: string[], pathIds: string[], extra?: Partial<Extract<Drag, { kind: 'items' }>>) => {
    const cur = exRef.current;
    if (!drags.current.size) snapshot.current = cur;
    drags.current.set(pointerId, {
      kind: 'items',
      ids: itemIds,
      start: w,
      orig: new Map(itemIds.map((id) => [id, displayPos.get(id)!])),
      paths: new Map(cur.paths.filter((q) => pathIds.includes(q.id)).map((q) => [q.id, q.pts.map((pt) => [...pt] as [number, number])])),
      moved: false,
      base: false,
      ...extra,
    });
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 2 || !viewRef.current) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    if (pb.playing) pb.pause();
    const w = toWorldPt(e);
    const cur = exRef.current;
    const s = viewRef.current.s;

    if (tool.t === 'select') {
      const hit = itemAt(cur, displayPos, w, s) ?? pathAt(cur, w, s);
      if (hit) {
        if (e.shiftKey || e.metaKey) {
          setSelection((sel) => {
            const n = new Set(sel);
            if (n.has(hit.id)) n.delete(hit.id);
            else n.add(hit.id);
            return n;
          });
          return;
        }
        const isItem = cur.items.some((i) => i.id === hit.id);
        if (drags.current.size) startGroupDrag(e.pointerId, w, isItem ? [hit.id] : [], isItem ? [] : [hit.id]);
        else if (selection.has(hit.id))
          startGroupDrag(
            e.pointerId, w,
            cur.items.filter((i) => selection.has(i.id)).map((i) => i.id),
            cur.paths.filter((q) => selection.has(q.id)).map((q) => q.id),
          );
        else {
          setSelection(new Set([hit.id]));
          startGroupDrag(e.pointerId, w, isItem ? [hit.id] : [], isItem ? [] : [hit.id]);
        }
        return;
      }
      drags.current.set(e.pointerId, { kind: 'marquee', start: w, cur: w, additive: e.shiftKey || e.metaKey });
      return;
    }

    if (tool.t === 'add') {
      const p = snapP(w);
      const it = newItem(cur, tool.kind, p, tool.kind === 'player' ? color : defaultColor(tool.kind, gearColor));
      snapshot.current = cur;
      mutate((d) => d.items.push(it), false);
      setSelection(new Set([it.id]));
      drags.current.set(e.pointerId, {
        kind: 'items', ids: [it.id], start: w, orig: new Map([[it.id, [it.x, it.y]]]), paths: new Map(), moved: false, base: true, created: true,
      });
      if (tool.kind === 'text') setTool({ t: 'select' });
      return;
    }
    if (tool.t === 'draw') {
      drags.current.set(e.pointerId, { kind: 'draw', pts: [w] });
      return;
    }
    const p = snapP(w);
    drags.current.set(e.pointerId, { kind: tool.t, start: p, cur: p });
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId);
    if (!d || !viewRef.current) return;
    const w = toWorldPt(e);
    const s = viewRef.current.s;
    switch (d.kind) {
      case 'items': {
        const delta: Vec = [w[0] - d.start[0], w[1] - d.start[1]];
        if (!d.moved && Math.hypot(delta[0], delta[1]) * s < 3) return;
        d.moved = true;
        const kk = d.base ? 0 : frame;
        // Un groupe se déplace d'un bloc : on aimante le décalage, pas chaque élément.
        const step = snapV(delta, snap && (d.ids.length + d.paths.size > 1 || d.ids.length === 0));
        mutate((draft) => {
          for (const id of d.ids) {
            const o = d.orig.get(id)!;
            const p = d.ids.length + d.paths.size > 1 ? clampToField(draft, [o[0] + step[0], o[1] + step[1]]) : snapP([o[0] + delta[0], o[1] + delta[1]]);
            const it = draft.items.find((i) => i.id === id);
            if (it?.kind === 'ball' && ownerAt(draft, kk, id) !== null) setOwner(draft, kk, id, null);
            setPos(draft, kk, id, [round(p[0]), round(p[1])]);
          }
          for (const [id, orig] of d.paths) {
            const q = draft.paths.find((x) => x.id === id);
            if (q) q.pts = orig.map(([x, y]) => [round(x + step[0]), round(y + step[1])]);
          }
        }, false);
        return;
      }
      case 'marquee':
        d.cur = w;
        setDraft({ rect: [d.start, w] });
        return;
      case 'draw': {
        const last = d.pts[d.pts.length - 1];
        if (dist(last, w) < Math.max(0.12 * u, 3 / s)) return;
        d.pts.push(clampToField(exRef.current, w));
        const k2: PathKind = drawKind === 'auto' ? 'run' : drawKind;
        setDraft({ path: { id: 'draft', kind: k2, pts: d.pts.map((p) => [p[0], p[1]]) } });
        return;
      }
      default:
        d.cur = snapP(w);
        setDraft(shapeOf(d.kind, d.start, d.cur));
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId);
    drags.current.delete(e.pointerId);
    if (!d) return;
    const s = viewRef.current?.s ?? 10;
    switch (d.kind) {
      case 'items': {
        const kk = d.base ? 0 : frame;
        if (d.moved || d.created) {
          // Ballon lâché sur un joueur → il devient son porteur (passe si on est sur une étape).
          const cur = exRef.current;
          const balls = d.ids.filter((id) => cur.items.find((i) => i.id === id)?.kind === 'ball');
          if (balls.length) {
            const rest = buildTimeline(cur).rest[kk];
            mutate((draft) => {
              for (const b of balls) {
                const target = attachTarget(draft, rest, rest.get(b)!);
                if (target) setOwner(draft, kk, b, target);
              }
            }, false);
          }
        }
        if ((d.moved || d.created) && drags.current.size === 0 && snapshot.current) {
          past.current.push(snapshot.current);
          future.current = [];
          snapshot.current = null;
          bump((n) => n + 1);
        }
        return;
      }
      case 'marquee': {
        setDraft(null);
        if (dist(d.start, d.cur) * s < 5) {
          if (!d.additive) setSelection(new Set());
          return;
        }
        const inside = idsInRect(exRef.current, displayPos, d.start, d.cur);
        setSelection((sel) => new Set([...(d.additive ? sel : []), ...inside]));
        return;
      }
      case 'draw': {
        setDraft(null);
        const path = finishPath(d.pts, drawKind, u);
        if (path) mutate((draft) => draft.paths.push(path));
        return;
      }
      case 'zone': {
        setDraft(null);
        const w = Math.abs(d.cur[0] - d.start[0]);
        const h = Math.abs(d.cur[1] - d.start[1]);
        const center: Vec = w > 1.5 && h > 1.5 ? [(d.start[0] + d.cur[0]) / 2, (d.start[1] + d.cur[1]) / 2] : d.start;
        const it = newItem(exRef.current, 'zone', center, defaultColor('zone', gearColor));
        if (w > 1.5 && h > 1.5) {
          it.w = round(w);
          it.h = round(h);
        }
        mutate((draft) => draft.items.push(it));
        setSelection(new Set([it.id]));
        setTool({ t: 'select' });
        return;
      }
      default: {
        setDraft(null);
        if (dist(d.start, d.cur) < 0.8) return;
        const { items } = shapeOf(d.kind, d.start, d.cur);
        if (!items.length) return;
        mutate((draft) => void draft.items.push(...items));
        setSelection(new Set(items.map((i) => i.id)));
      }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('text/atelier-kind') as ItemKind;
    if (!kind || !viewRef.current) return;
    e.preventDefault();
    const p = snapP(toWorldPt(e));
    const it = newItem(exRef.current, kind, p, kind === 'player' ? color : defaultColor(kind, gearColor));
    mutate((d) => d.items.push(it));
    setSelection(new Set([it.id]));
  };

  /* ---------------------------------------------------------------- étapes */

  const addFrame = () => {
    pb.pause();
    mutate((d) => d.frames.splice(frame + 1, 0, { id: shortId('f'), dur: 1200, pos: {}, owner: {} }));
    setK(frame + 1);
    setTool({ t: 'select' });
  };
  const deleteFrame = () => {
    if (frame === 0) return;
    mutate((d) => d.frames.splice(frame, 1));
    setK(frame - 1);
  };
  const setFrameDur = (ms: number) =>
    mutate((d) => {
      d.frames[frame].dur = Math.max(300, Math.min(10000, Math.round(ms / 100) * 100));
    });

  /* ---------------------------------------------------------------- sélection */

  const selItems = ex.items.filter((i) => selection.has(i.id));
  const selPaths = ex.paths.filter((p) => selection.has(p.id));

  const removeSelection = () => {
    if (!selection.size) return;
    mutate((d) => deleteIds(d, selection));
    setSelection(new Set());
  };
  const duplicateSelection = () => {
    if (!selection.size) return;
    let created = new Set<string>();
    mutate((d) => {
      created = duplicateIds(d, selection, [1.5 * u, 1.5 * u]);
    });
    setSelection(created);
  };

  /* ---------------------------------------------------------------- clavier */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'a') {
        // Tout sélectionner sur le terrain, pas le texte de la page.
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        setTool({ t: 'select' });
        setSelection(new Set([...exRef.current.items.map((i) => i.id), ...exRef.current.paths.map((q) => q.id)]));
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        removeSelection();
      } else if (e.key === 'Escape') {
        setSelection(new Set());
        setTool({ t: 'select' });
      } else if (e.key === ' ') {
        e.preventDefault();
        pb.toggle();
      } else if (e.key === 'r' && selection.size) rotateSelection(e.shiftKey ? -15 : 15);
      else if (e.key === 'v') setTool({ t: 'select' });
      else if (e.key === 'p') setTool({ t: 'draw' });
      else if (e.key === 'j') setTool({ t: 'add', kind: 'player' });
      else if (e.key === 'b') setTool({ t: 'add', kind: 'ball' });
      else if (e.key === 'c') setTool({ t: 'add', kind: 'cone' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------------------------------------------------------- actions */

  const doExport = async () => {
    if (!canExportVideo()) return toast("L'export vidéo n'est pas disponible sur ce navigateur", true);
    setExporting(0);
    try {
      const file = await exportVideo(exRef.current, setExporting);
      const r = await shareOrDownload(file, exRef.current.title);
      if (r === 'downloaded') toast('Vidéo téléchargée');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setExporting(null);
    }
  };

  const doDuplicate = async () => {
    await save();
    const copy = await duplicateExercise(exRef.current);
    nav(`/exercices/${copy.id}`);
    toast('Copie créée');
  };

  const doDelete = async () => {
    if (!(await confirm({ title: 'Supprimer cet exercice ?', text: 'Il sera retiré des séances qui l’utilisent.', confirm: 'Supprimer', danger: true }))) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    await api.del(`/exercises/${ex.id}`);
    nav('/exercices', { replace: true });
  };

  const SHORT: Partial<Record<ItemKind, string>> = { coach: 'Éduc.', rebounder: 'Rebond', ballbag: 'Sac', minigoal: 'Mini-but' };
  const tools: { key: string; label: string; icon: React.ReactNode; tool: Tool; drag?: ItemKind }[] = [
    { key: 'select', label: 'Choisir', icon: <MousePointer2 />, tool: { t: 'select' } },
    { key: 'player', label: 'Joueur', icon: <ItemIcon kind="player" color={color} />, tool: { t: 'add', kind: 'player' }, drag: 'player' },
    { key: 'ball', label: 'Ballon', icon: <ItemIcon kind="ball" />, tool: { t: 'add', kind: 'ball' }, drag: 'ball' },
    { key: 'draw', label: 'Flèche', icon: <PenLine />, tool: { t: 'draw' } },
    ...(['coach', ...EQUIPMENT] as ItemKind[]).map((kind) => ({
      key: kind, label: SHORT[kind] ?? ITEM_LABELS[kind], icon: <ItemIcon kind={kind} />, tool: { t: 'add', kind } as Tool, drag: kind,
    })),
    ...SHAPES.map(({ key, label }) => ({
      key, label, icon: <ItemIcon kind={key as IconKind} />, tool: (key === 'text' ? { t: 'add', kind: 'text' } : { t: key }) as Tool, drag: key === 'text' ? ('text' as ItemKind) : undefined,
    })),
  ];
  const toolKey = tool.t === 'add' ? tool.kind : tool.t;

  const setItemProp = (patch: Partial<ExerciseData['items'][number]>, ids = selection) =>
    mutate((d) => {
      for (const it of d.items) if (ids.has(it.id)) Object.assign(it, patch);
    });

  const rotateSelection = (deg: number) =>
    mutate((d) => {
      for (const it of d.items) if (selection.has(it.id) && it.kind !== 'zone') it.rot = (((it.rot ?? 0) + deg) % 360 + 360) % 360;
    });

  const scaleSelection = (pct: number) =>
    mutate((d) => {
      for (const it of d.items) if (selection.has(it.id)) it.scale = pct === 100 ? undefined : pct / 100;
    });

  /* ---------------------------------------------------------------- barre contextuelle */

  let context: React.ReactNode = null;
  if (tool.t === 'add' && tool.kind === 'player') context = <Swatches colors={PLAYER_COLORS} value={color} onChange={setColor} />;
  else if (tool.t === 'add' && defaultColor(tool.kind, gearColor))
    context = <Swatches colors={colorsFor(tool.kind)} value={defaultColor(tool.kind, gearColor)!} onChange={setGearColor} />;
  else if (tool.t === 'draw')
    context = (
      <Seg
        value={drawKind}
        onChange={setDrawKind}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'pass', label: 'Passe' },
          { value: 'dribble', label: 'Conduite' },
          { value: 'run', label: 'Course' },
          { value: 'shot', label: 'Tir' },
        ]}
      />
    );
  else if (tool.t === 'line')
    context = (
      <>
        <Seg value={lineKind} onChange={setLineKind} options={[{ value: 'cone', label: 'Coupelles' }, { value: 'marker', label: 'Plots' }, { value: 'pole', label: 'Piquets' }]} />
        <span className="sep" />
        <Stepper value={lineCount} min={2} max={20} onChange={setLineCount} />
      </>
    );
  else if (tool.t === 'circle' || tool.t === 'slalom' || tool.t === 'grid')
    context = (
      <>
        <span className="float-label">{tool.t === 'circle' ? 'Coupelles' : tool.t === 'slalom' ? 'Piquets' : 'Écart'}</span>
        {tool.t === 'circle' && <Stepper value={circleCount} min={3} max={24} onChange={setCircleCount} />}
        {tool.t === 'slalom' && <Stepper value={slalomCount} min={3} max={16} onChange={setSlalomCount} />}
        {tool.t === 'grid' && <Stepper value={gridStep} min={2} max={15} suffix=" m" onChange={setGridStep} />}
        <span className="sep" />
        <Swatches colors={GEAR_COLORS} value={gearColor} onChange={setGearColor} />
      </>
    );
  else if (tool.t === 'measure' || tool.t === 'zone')
    context = <Swatches colors={INK_COLORS} value={defaultColor(tool.t, gearColor)!} onChange={setGearColor} />;
  else if (tool.t === 'select' && (selItems.length || selPaths.length)) {
    const one = selItems.length === 1 ? selItems[0] : null;
    const palettes = new Set(selItems.map((i) => (COLORABLE.has(i.kind) ? colorsFor(i.kind) : null)));
    const palette = palettes.size === 1 ? [...palettes][0] : null;
    const shapeable = selItems.filter((i) => i.kind !== 'zone' && i.kind !== 'measure');
    const turnable = selItems.filter((i) => i.kind !== 'zone' && i.kind !== 'ball');
    const players = selItems.filter((i) => i.kind === 'player');
    const allPlayers = players.length > 0 && players.length === selItems.length;
    context = (
      <>
        {palette && selItems.length > 0 && (
          <Swatches colors={palette} value={selItems[0].color ?? palette[0]} onChange={(c) => setItemProp({ color: c })} />
        )}
        {one && ['player', 'zone', 'coach', 'text'].includes(one.kind) && (
          <input
            className="input float-input"
            style={{ width: one.kind === 'player' ? 52 : one.kind === 'coach' ? 90 : 130 }}
            value={one.label ?? ''}
            maxLength={one.kind === 'player' ? 3 : one.kind === 'text' ? 40 : 18}
            placeholder={one.kind === 'player' ? 'N°' : one.kind === 'coach' ? 'Nom' : one.kind === 'text' ? 'Texte' : 'Nom'}
            onChange={(e) => setItemProp({ label: e.target.value })}
            aria-label="Libellé"
          />
        )}
        {allPlayers && (
          <>
            <span className="sep" />
            <Seg value={players[0].kit ?? 'plain'} onChange={(kit) => setItemProp({ kit: kit === 'plain' ? undefined : kit })} options={KITS} />
            <button
              className={`chip${players.every((p) => p.keeper) ? ' on' : ''}`}
              onClick={() => setItemProp({ keeper: players.every((p) => p.keeper) ? undefined : true })}
              title="Gardien de but : manches longues et gants"
            >
              Gardien
            </button>
          </>
        )}
        {one?.kind === 'zone' && (
          <>
            <Stepper value={one.w ?? 6} min={1} max={120} step={1} suffix=" m" onChange={(w) => setItemProp({ w })} />
            <span className="muted">×</span>
            <Stepper value={one.h ?? 6} min={1} max={120} step={1} suffix=" m" onChange={(h) => setItemProp({ h })} />
          </>
        )}
        {one?.kind === 'measure' && <Stepper value={one.w ?? 5} min={0.5} max={120} step={0.5} decimals={1} suffix=" m" onChange={(w) => setItemProp({ w })} />}
        {shapeable.length > 0 && (
          <>
            <span className="sep" />
            <span className="float-label">Taille</span>
            <Stepper value={Math.round((shapeable[0].scale ?? 1) * 100)} min={50} max={250} step={10} suffix=" %" onChange={scaleSelection} />
          </>
        )}
        {turnable.length > 0 && (
          <>
            <span className="sep" />
            <button className="btn icon sm ghost" title="Pivoter à gauche (⇧R)" onClick={() => rotateSelection(-15)}>
              <RotateCcw />
            </button>
            <button className="float-value" title="Remettre droit" onClick={() => setItemProp({ rot: undefined }, new Set(turnable.map((i) => i.id)))}>
              {Math.round(turnable[0].rot ?? 0)}°
            </button>
            <button className="btn icon sm ghost" title="Pivoter à droite (R)" onClick={() => rotateSelection(15)}>
              <RotateCw />
            </button>
          </>
        )}
        {selPaths.length > 0 && !selItems.length && (
          <Seg
            value={selPaths[0].kind}
            onChange={(kind) => mutate((d) => d.paths.forEach((p) => selection.has(p.id) && (p.kind = kind)))}
            options={(['pass', 'dribble', 'run', 'shot'] as PathKind[]).map((v) => ({ value: v, label: PATH_STYLE[v].label }))}
          />
        )}
        <span className="sep" />
        {selection.size > 1 && <span className="float-label">{selection.size}</span>}
        <button className="btn icon sm ghost" title="Dupliquer (⌘D)" onClick={duplicateSelection}>
          <Copy />
        </button>
        <button className="btn icon sm ghost danger" title="Supprimer" onClick={removeSelection}>
          <Trash2 />
        </button>
      </>
    );
  }

  const hint =
    frame > 0 && tool.t === 'select' && !selection.size ? 'Déplacez les joueurs · glissez le ballon sur un joueur pour une passe' : null;

  return (
    <div className="editor">
      {/* --------------------------------------------------------- barre du haut */}
      <div className="editor-top">
        <button className="btn icon ghost" onClick={() => nav(-1)} aria-label="Retour">
          <ArrowLeft />
        </button>
        <input
          className="title-input"
          value={ex.title}
          placeholder="Nom de l’exercice"
          onChange={(e) => mutate((d) => void (d.title = e.target.value), false)}
          onBlur={() => bump((n) => n + 1)}
        />
        <span className="small muted hide-mobile" style={{ whiteSpace: 'nowrap' }}>
          {saveState === 'saving' ? 'Enregistrement…' : saveState === 'offline' ? 'Hors ligne · en attente' : saveState === 'error' ? 'Erreur' : 'Enregistré'}
        </span>
        <button className="btn icon ghost" onClick={undo} disabled={!past.current.length} aria-label="Annuler">
          <Undo2 />
        </button>
        <button className="btn icon ghost hide-mobile" onClick={redo} disabled={!future.current.length} aria-label="Rétablir">
          <Redo2 />
        </button>
        <button className={`btn icon ${snap ? '' : 'ghost'} hide-mobile`} onClick={() => setSnap((s) => !s)} title="Aimanter à la grille (0,5 m)">
          <Magnet />
        </button>
        <button className="btn hide-mobile" onClick={() => setPresent(true)}>
          <Maximize2 /> Présenter
        </button>
        <button className={`btn icon only-mobile ${panel ? 'primary' : ''}`} onClick={() => setPanel((p) => (p ? null : 'fiche'))} aria-label="Fiche de l’exercice">
          <PanelRight />
        </button>
        <Menu
          trigger={(open) => (
            <button className="btn icon ghost" onClick={open} aria-label="Plus d’actions">
              <MoreHorizontal />
            </button>
          )}
        >
          {(close) => (
            <>
              <button className="only-mobile" onClick={() => (close(), setPresent(true))}>
                <Maximize2 /> Présenter aux enfants
              </button>
              {can('library.share') && (
                <button
                  onClick={() => (close(), mutate((d) => void (d.visibility = d.visibility === 'club' ? 'private' : 'club')))}
                  title={ex.validated ? 'Validé par le club — une modification retirera la validation.' : 'Visible par tous les éducateurs, qui pourront le dupliquer.'}
                >
                  {ex.validated ? <BadgeCheck /> : <Users />} Partager avec le club
                  {ex.visibility === 'club' && <Check className="menu-check" />}
                </button>
              )}
              <button onClick={() => (close(), void doDuplicate())}>
                <Copy /> Dupliquer
              </button>
              <button onClick={() => (close(), setSnap((s) => !s))} className="only-mobile">
                <Magnet /> Aimanter : {snap ? 'oui' : 'non'}
              </button>
              <button onClick={() => (close(), void doDelete())} style={{ color: 'var(--danger)' }}>
                <Trash2 /> Supprimer
              </button>
            </>
          )}
        </Menu>
      </div>

      {/* --------------------------------------------------------- corps */}
      <div className="editor-body">
        <div className="palette" role="toolbar" aria-label="Outils">
          {tools.map((t, i) => (
            <FragmentWithSep key={t.key} sep={i === 4 || i === 5 + EQUIPMENT.length}>
              <button
                className={`tool${toolKey === t.key ? ' on' : ''}`}
                onClick={() => {
                  setTool(t.tool);
                  if (t.tool.t !== 'select') setSelection(new Set());
                }}
                draggable={!!t.drag}
                onDragStart={(e) => t.drag && e.dataTransfer.setData('text/atelier-kind', t.drag)}
                title={t.label}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            </FragmentWithSep>
          ))}
        </div>

        <div
          ref={stageRef}
          className="stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: tool.t === 'select' ? 'default' : 'crosshair' }}
        >
          <canvas ref={canvasRef} />
          {(context || hint) && (
            <div className="stage-float top" onPointerDown={(e) => e.stopPropagation()}>
              {context ?? <span className="small" style={{ padding: '4px 8px', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{hint}</span>}
            </div>
          )}
        </div>

        {!panel && (
          <div className="side-rail dock-group" role="toolbar" aria-label="Réglages">
            {PANELS.map((pn) => (
              <button key={pn.key} className="dock-btn" onClick={() => setPanel(pn.key)} data-tip={pn.label} aria-label={pn.label}>
                {pn.icon}
              </button>
            ))}
          </div>
        )}

        {panel && (
          <aside className="side-panel">
            <button className="side-panel-close hide-mobile" onClick={() => setPanel(null)} aria-label="Fermer le panneau" title="Fermer">
              <ChevronRight />
            </button>
            <div className="side-panel-scroll">
            <div className="panel-tabs row between">
              <Seg value={panel} onChange={setPanel} options={PANELS.map((pn) => ({ value: pn.key, label: pn.label }))} />
              <button className="btn icon sm ghost only-mobile" onClick={() => setPanel(null)} aria-label="Fermer">
                <X />
              </button>
            </div>
            <div className="panel-body">
              {panel === 'fiche' && (
                <>
                  <Field label="Durée (min)">
                    <NumberField value={ex.duration} min={1} max={120} onCommit={(v) => mutate((d) => void (d.duration = v))} />
                  </Field>
                  <TextField label="Consignes" value={ex.instructions} rows={6} onChange={(v) => mutate((d) => void (d.instructions = v), false)} placeholder="Des phrases courtes, à dire aux enfants" />
                </>
              )}
              {panel === 'terrain' && (
                <>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(Object.keys(PRESETS) as FieldPreset[]).map((p) => (
                      <button
                        key={p}
                        className={`card${ex.field.preset === p ? ' on' : ''}`}
                        style={{
                          padding: 12, textAlign: 'left', cursor: 'pointer',
                          borderColor: ex.field.preset === p ? 'var(--accent)' : undefined,
                          boxShadow: ex.field.preset === p ? '0 0 0 3px var(--accent-soft)' : undefined,
                        }}
                        onClick={() => mutate((d) => void (d.field = { preset: p, w: PRESETS[p].w, h: PRESETS[p].h }))}
                      >
                        <b style={{ display: 'block', fontSize: 14 }}>{PRESETS[p].label}</b>
                        <small className="muted">{PRESETS[p].hint}</small>
                      </button>
                    ))}
                  </div>
                  {(ex.field.preset === 'free' || ex.field.preset === 'square') && (
                    <div className="row">
                      <Field label="Longueur (m)">
                        <NumberField value={ex.field.w} min={10} max={120} onCommit={(w) => mutate((d) => void (d.field.w = w))} />
                      </Field>
                      <Field label="Largeur (m)">
                        <NumberField value={ex.field.h} min={10} max={90} onCommit={(h) => mutate((d) => void (d.field.h = h))} />
                      </Field>
                    </div>
                  )}
                  <p className="small muted">
                    Astuce : sur téléphone tenu verticalement, le terrain pivote automatiquement pour occuper tout l’écran.
                  </p>
                </>
              )}
            </div>
            </div>
          </aside>
        )}
      </div>

      {/* --------------------------------------------------------- étapes */}
      <div className="timeline">
        <button className={`btn icon ${pb.playing ? '' : 'primary'}`} onClick={pb.toggle} disabled={lastFrame === 0} aria-label="Lecture">
          {pb.playing ? <Pause /> : <Play />}
        </button>
        <div className="frames">
          {ex.frames.map((f, i) => (
            <button
              key={f.id}
              className={`frame-chip${(pb.playing ? pb.frameIndex : frame) === i ? ' on' : ''}`}
              onClick={() => {
                pb.pause();
                pb.stepTo(i);
                setK(i);
              }}
              title={i === 0 ? 'Étape 1 · position de départ' : `Étape ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
          <button className="frame-chip add" onClick={addFrame} title="Ajouter une étape">
            <Plus size={15} style={{ verticalAlign: -3 }} />
          </button>
        </div>
        {frame > 0 && !pb.playing && (
          <div className="row" style={{ gap: 4 }}>
            <Stepper value={ex.frames[frame].dur / 1000} min={0.3} max={10} step={0.3} suffix=" s" decimals={1} onChange={(v) => setFrameDur(v * 1000)} />
            <button className="btn icon sm ghost" onClick={deleteFrame} title="Supprimer l’étape">
              <Trash2 />
            </button>
          </div>
        )}
        <span className="grow" />
        <button className="plain-toggle" onClick={() => void doExport()} disabled={exporting !== null}>
          <Download size={16} /> <span className="hide-mobile">Exporter en vidéo</span>
        </button>
      </div>

      {present && <Presenter ex={ex} onClose={() => setPresent(false)} />}
      {exporting !== null && (
        <div className="overlay">
          <div className="sheet" style={{ maxWidth: 360, padding: 24, textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }} />
            <b>Création de la vidéo…</b>
            <p className="muted small">{Math.round(exporting * 100)} %</p>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentWithSep({ sep, children }: { sep?: boolean; children: React.ReactNode }) {
  return (
    <>
      {sep && <span className="tool-sep" />}
      {children}
    </>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ gap: 6, padding: '0 4px' }}>
      {colors.map((c) => (
        <button key={c} className={`swatch${value === c ? ' on' : ''}`} style={{ background: COLORS[c].hex }} onClick={() => onChange(c)} aria-label={COLORS[c].label} title={COLORS[c].label} />
      ))}
    </div>
  );
}

function Stepper({
  value, min, max, step = 1, suffix = '', decimals = 0, onChange,
}: { value: number; min: number; max: number; step?: number; suffix?: string; decimals?: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 10 ** decimals) / 10 ** decimals));
  return (
    <div className="row" style={{ gap: 2 }}>
      <button className="btn icon sm ghost" onClick={() => onChange(clamp(value - step))} aria-label="Moins">
        <Minus />
      </button>
      <span style={{ minWidth: 44, textAlign: 'center', fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(decimals).replace('.', ',')}
        {suffix}
      </span>
      <button className="btn icon sm ghost" onClick={() => onChange(clamp(value + step))} aria-label="Plus">
        <Plus />
      </button>
    </div>
  );
}

/**
 * Champ numérique tolérant la saisie intermédiaire (vide, « 1 » en tapant « 15 »…) :
 * seule une valeur dans [min, max] est appliquée ; sinon, à la sortie du champ, la dernière valeur valide revient.
 */
function NumberField({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
      }}
    />
  );
}

/** Champ texte qui ne réécrit l'historique qu'à la perte du focus. */
function TextField({ label, value, rows, placeholder, onChange }: { label: string; value: string; rows: number; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <textarea className="textarea" rows={rows} style={{ minHeight: rows * 24 + 20 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
