import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { preparePortrait } from '../lib/images';
import { playerName } from '../lib/store';
import type { Player } from '../lib/types';
import { Avatar, useToast } from './ui';

export const photoUrl = (p: Pick<Player, 'id' | 'photo'>) => (p.photo ? `/api/players/${p.id}/photo?v=${p.photo}` : null);

/** Photo du joueur (ou ses initiales). Touchez pour changer la photo quand c'est permis. */
export function PlayerAvatar({ player, size = 76, editable, onChange }: { player: Player; size?: number; editable?: boolean; onChange?: (p: Player) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = photoUrl(player);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const out = await api.post<Player>(`/players/${player.id}/photo`, { image: await preparePortrait(file) });
      onChange?.(out);
      toast('Photo mise à jour');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={`p-avatar${editable ? ' edit' : ''}${busy ? ' busy' : ''}${player.photoAlpha ? ' cutout' : ''}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt={player.firstName} /> : <Avatar name={playerName(player)} size="lg" />}
      {editable && (
        <>
          <button type="button" className="p-avatar-btn" onClick={() => input.current?.click()} aria-label="Changer la photo">
            <Camera size={14} />
          </button>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
        </>
      )}
    </span>
  );
}
