import { Bell, BellRing, Share, SquarePlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { enablePush, pushState, type PushState } from '../lib/push';
import { useToast } from './ui';

export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => void pushState().then(setState).catch(() => setState('unsupported')), []);
  useEffect(refresh, [refresh]);
  return { state, setState, refresh };
}

/** Carte d'activation des notifications, avec le pas-à-pas iPhone (écran d'accueil). */
export function PushCard({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const { state, setState } = usePushState();
  const [busy, setBusy] = useState(false);
  if (!state || state === 'on' || (compact && state === 'unsupported')) return null;
  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'on') {
        await api.post('/push/test');
        toast('Notifications activées');
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="push-card">
      <span className="push-ic">
        <BellRing />
      </span>
      <div className="grow">
        <b>Recevez les convocations dès leur publication</b>
        {state === 'ios-install' ? (
          <ol className="push-steps">
            <li>
              Touchez <Share size={14} /> <b>Partager</b> en bas de Safari
            </li>
            <li>
              Choisissez <SquarePlus size={14} /> <b>Sur l’écran d’accueil</b>
            </li>
            <li>Ouvrez LevelUp depuis l’icône et revenez ici</li>
          </ol>
        ) : state === 'denied' ? (
          <p>Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur.</p>
        ) : state === 'unsupported' ? (
          <p>Ce navigateur ne gère pas les notifications. Ouvrez LevelUp dans Chrome ou Safari (iOS 16.4+).</p>
        ) : (
          <p>Disponibilités, convocation, rappel la veille : un seul geste pour répondre.</p>
        )}
      </div>
      {state === 'off' && (
        <button className="btn primary" disabled={busy} onClick={turnOn}>
          <Bell /> Activer
        </button>
      )}
    </div>
  );
}
