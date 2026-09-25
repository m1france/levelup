import { useParams } from 'react-router-dom';
import { Empty, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import type { TrainingPayload } from '../lib/types';
import { TrainingView } from './TrainingPage';

/** Lien public (sans compte) : la séance du jour, animée, pour les parents. */
export function PublicTraining() {
  const { token } = useParams();
  const q = useAsync(() => api.get<TrainingPayload>(`/public/trainings/${token}`), [token]);
  if (q.loading) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="public-wrap">
        <Empty title="Lien inactif" text={q.error ?? 'Ce lien n’est plus disponible.'} />
      </div>
    );
  return <TrainingView data={q.data} publicView />;
}
