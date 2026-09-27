import { Clock, Plus, Search, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SceneThumb } from '../components/Pitch';
import { Seg, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { useLive } from '../lib/live';
import { useApp } from '../lib/store';
import type { Exercise } from '../lib/types';
import { emptyExercise } from '../pitch/geometry';

/** Un nouvel exercice appartient à l'équipe : tous ses éducateurs le modifient, ses joueurs le consultent. */
export async function createExercise(teamId: string | null): Promise<Exercise> {
  return api.put<Exercise>(`/exercises/${uid()}`, { ...emptyExercise(), title: 'Nouvel exercice', visibility: 'private', teamId });
}

export type ExerciseScope = 'team' | 'mine';

export const exercisesUrl = (scope: ExerciseScope, teamId: string | undefined) =>
  scope === 'team' ? `/exercises?scope=team&teamId=${teamId ?? ''}` : `/exercises?scope=${scope}`;

/** Recharge une liste d'exercices dès qu'un éducateur en crée, modifie ou supprime un. */
export function useExercisesLive(reload: () => void) {
  const timer = useRef<number | undefined>(undefined);
  useLive((m) => {
    if (m.t !== 'exercise') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(reload, 400);
  });
}

export function ExerciseCard({ ex, onClick, action }: { ex: Exercise; onClick: () => void; action?: React.ReactNode }) {
  return (
    <div className="card ex-card" onClick={onClick}>
      <div className="thumb">
        <SceneThumb ex={ex} />
        <div className="badges">
          {ex.frames.length > 1 && (
            <span className="badge" style={{ background: 'rgba(0,0,0,.45)', color: '#fff' }}>
              Animé · {ex.frames.length - 1}
            </span>
          )}
        </div>
      </div>
      <div className="body">
        <b>{ex.title}</b>
        <div className="meta">
          <span>
            <Clock size={12} style={{ verticalAlign: -1 }} /> {ex.duration} min
          </span>
          <span>
            <Users size={12} style={{ verticalAlign: -1 }} /> {ex.players}
          </span>
          {ex.themes.slice(0, 2).map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        {action}
      </div>
    </div>
  );
}

export function useExerciseSearch(list: Exercise[] | null) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter((e) => !needle || `${e.title} ${e.objective} ${e.themes.join(' ')}`.toLowerCase().includes(needle));
  }, [list, q]);
  const controls = (
    <div style={{ position: 'relative', marginBottom: 18 }}>
      <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }} />
      <input className="input" style={{ paddingLeft: 38 }} placeholder="Rechercher un exercice…" value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  );
  return { filtered, controls };
}

export function Library() {
  const { can, team, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = params.get('scope');
  const scope: ExerciseScope = !isStaff || !asked ? (team ? 'team' : 'mine') : asked === 'mine' || !team ? 'mine' : 'team';
  const q = useAsync(() => api.get<Exercise[]>(exercisesUrl(scope, team?.id)), [scope, team?.id]);
  useExercisesLive(q.reload);
  const { filtered, controls } = useExerciseSearch(q.data);
  const [creating, setCreating] = useState(false);
  const canCreate = isStaff && can('exercises.create');

  const create = async () => {
    setCreating(true);
    try {
      const ex = await createExercise(team?.id ?? null);
      nav(`/exercices/${ex.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Exercices</h1>
          {scope === 'team' && team && (
            <div className="sub">
              {isStaff ? `Partagés entre les éducateurs et les joueurs ${team.category}, mis à jour en direct` : `Les exercices de l’équipe ${team.category}`}
            </div>
          )}
        </div>
        <div className="actions">
          {isStaff && (
            <Seg
              value={scope}
              onChange={(v) => setParams(v === 'team' ? {} : { scope: v })}
              options={[
                ...(team ? [{ value: 'team' as const, label: `Équipe ${team.category}` }] : []),
                { value: 'mine' as const, label: 'Personnels' },
              ]}
            />
          )}
          {canCreate && (
            <button className="btn primary" onClick={create} disabled={creating}>
              <Plus /> Nouvel exercice
            </button>
          )}
        </div>
      </div>
      {controls}
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : filtered.length ? (
        <div className="grid auto">
          {filtered.map((ex) => (
            <ExerciseCard key={ex.id} ex={ex} onClick={() => nav(`/exercices/${ex.id}`)} />
          ))}
        </div>
      ) : (
        <div className="card empty-actions">
          <span className="muted">Aucun exercice pour le moment</span>
          {canCreate && (
            <button className="btn primary" onClick={create} disabled={creating}>
              <Plus /> Créer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
