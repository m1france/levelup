import { BadgeCheck, Clock, LayoutGrid, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SceneThumb } from '../components/Pitch';
import { Empty, Seg, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { useApp } from '../lib/store';
import type { Exercise } from '../lib/types';
import { THEMES, emptyExercise } from '../pitch/geometry';

export async function createExercise(): Promise<Exercise> {
  return api.put<Exercise>(`/exercises/${uid()}`, { ...emptyExercise(), title: 'Nouvel exercice', visibility: 'private' });
}

export function ExerciseCard({ ex, onClick, action }: { ex: Exercise; onClick: () => void; action?: React.ReactNode }) {
  return (
    <div className="card ex-card" onClick={onClick}>
      <div className="thumb">
        <SceneThumb ex={ex} />
        <div className="badges">
          {ex.validated && (
            <span className="badge green" style={{ background: 'rgba(255,255,255,.92)' }}>
              <BadgeCheck /> Validé
            </span>
          )}
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
  const [theme, setTheme] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter(
      (e) =>
        (!theme || e.themes.includes(theme)) &&
        (!needle || `${e.title} ${e.objective} ${e.themes.join(' ')}`.toLowerCase().includes(needle)),
    );
  }, [list, q, theme]);
  const controls = (
    <div className="stack" style={{ gap: 10, marginBottom: 18 }}>
      <div style={{ position: 'relative' }}>
        <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }} />
        <input className="input" style={{ paddingLeft: 38 }} placeholder="Rechercher un exercice…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips scroll">
        <button className={`chip${!theme ? ' on' : ''}`} onClick={() => setTheme(null)}>
          Tous
        </button>
        {THEMES.map((t) => (
          <button key={t} className={`chip${theme === t ? ' on' : ''}`} onClick={() => setTheme(theme === t ? null : t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
  return { filtered, controls };
}

export function Library() {
  const { can } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'club' ? 'club' : 'mine';
  const q = useAsync(() => api.get<Exercise[]>(`/exercises?scope=${scope}`), [scope]);
  const { filtered, controls } = useExerciseSearch(q.data);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const ex = await createExercise();
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
        </div>
        <div className="actions">
          <Seg
            value={scope}
            onChange={(v) => setParams(v === 'club' ? { scope: 'club' } : {})}
            options={[
              { value: 'mine', label: 'Mes exercices' },
              { value: 'club', label: 'Bibliothèque du club' },
            ]}
          />
          {can('exercises.create') && (
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
        <div className="card">
          <Empty
            icon={<LayoutGrid />}
            title={scope === 'mine' ? 'Aucun exercice pour le moment' : 'La bibliothèque du club est vide'}
            text={
              scope === 'mine'
                ? 'Créez votre premier exercice ou dupliquez-en un depuis la bibliothèque du club.'
                : 'Partagez vos exercices avec le club depuis leur fiche.'
            }
            action={
              scope === 'mine' ? (
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn" onClick={() => setParams({ scope: 'club' })}>
                    Voir la bibliothèque du club
                  </button>
                  {can('exercises.create') && (
                    <button className="btn primary" onClick={create}>
                      <Plus /> Créer
                    </button>
                  )}
                </div>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
