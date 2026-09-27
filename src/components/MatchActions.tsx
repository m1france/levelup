import { Pencil, Trash2 } from 'lucide-react';
import { createContext, useContext } from 'react';
import { useContextMenu } from './ui';

/** Un match (occurrence d'un événement). */
export interface MatchRef {
  eventId: string;
  date: string;
}

/** Actions de l'éducateur sur un match, fournies par la page Matchs. */
export const MatchActions = createContext<{ edit: (m: MatchRef) => void; remove: (m: MatchRef) => void } | null>(null);

/**
 * Clic droit (ou appui long) sur un match : « Modifier » et « Supprimer ».
 * Sans actions disponibles (parents, autre page), rien n'est branché.
 */
export function useMatchMenu(m: MatchRef) {
  const actions = useContext(MatchActions);
  const { bind, menu } = useContextMenu();
  if (!actions) return { bind: {}, menu: null };
  return {
    bind,
    menu: menu((close) => (
      <>
        <button onClick={() => (close(), actions.edit(m))}>
          <Pencil /> Modifier
        </button>
        <button onClick={() => (close(), actions.remove(m))} style={{ color: 'var(--danger)' }}>
          <Trash2 /> Supprimer
        </button>
      </>
    )),
  };
}
