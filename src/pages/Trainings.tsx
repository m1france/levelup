import { ChevronRight, Globe } from 'lucide-react';
import { api, uid } from '../lib/api';
import { dateTile, formatDate, todayISO } from '../lib/store';
import type { Block, Training } from '../lib/types';

export const BLOCK_LABELS: Record<Block['kind'], string> = {
  warmup: 'Échauffement',
  exercise: 'Exercice',
  rotation: 'Ateliers tournants',
  game: 'Jeu / match',
  break: 'Pause',
  cooldown: 'Retour au calme',
};

export function blockMinutes(b: Block) {
  if (b.kind === 'rotation') {
    const n = b.stations?.length ?? 0;
    return Math.round(n * (b.roundMinutes ?? 8) + (Math.max(0, n - 1) * (b.transition ?? 30)) / 60);
  }
  return b.duration;
}

export const totalMinutes = (t: Pick<Training, 'blocks'>) => t.blocks.reduce((s, b) => s + blockMinutes(b), 0);

export async function createTraining(teamId: string, at?: string, title = 'Nouvelle séance'): Promise<Training> {
  const d = new Date();
  const date = at ?? `${todayISO()}T${String(Math.min(20, Math.max(d.getHours() + 1, 14))).padStart(2, '0')}:00`;
  const res = await api.put<{ training: Training }>(`/trainings/${uid()}`, {
    teamId,
    date,
    title,
    theme: '',
    published: false,
    blocks: [],
  });
  return res.training;
}

export function TrainingRow({ t, onClick }: { t: Training; onClick: () => void }) {
  const tile = dateTile(t.date);
  return (
    <div className="list-item" onClick={onClick}>
      <div className="date-tile">
        <small>{tile.weekday}</small>
        <b>{tile.day}</b>
        <small>{tile.month}</small>
      </div>
      <div className="t">
        <b>{t.title}</b>
        <small>
          {formatDate(t.date)} · {totalMinutes(t)} min
          {t.theme ? ` · ${t.theme}` : ''}
        </small>
      </div>
      {t.published && (
        <span className="badge green hide-mobile">
          <Globe /> Parents
        </span>
      )}
      {t.attendance && <span className="badge hide-mobile">{t.attendance.length} présents</span>}
      <ChevronRight />
    </div>
  );
}
