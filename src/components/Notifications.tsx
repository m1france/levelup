import { Bell, BellOff, BellRing, CheckCheck, Share, SquarePlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { relative } from '../lib/store';
import type { AppNotification } from '../lib/types';
import { Sheet, useToast } from './ui';

interface Feed { unread: number; push: number; items: AppNotification[] }

function useFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const load = useCallback(() => {
    api.get<Feed>('/notifications').then(setFeed).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);
  useLive((m) => m.t === 'notif' && load());
  return { feed, load };
}

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

/** Cloche flottante et centre de notifications. */
export function NotificationBell() {
  const { feed, load } = useFeed();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const unread = feed?.unread ?? 0;
  const { state, setState } = usePushState();

  const markAll = async () => {
    await api.post('/notifications/read', {});
    load();
  };

  return (
    <>
      <button className={`bell-float${unread ? ' has' : ''}`} onClick={() => setOpen(true)} aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}>
        <Bell />
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Sheet
          title="Notifications"
          onClose={() => setOpen(false)}
          footer={
            <>
              {state === 'on' && (
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    await disablePush();
                    setState('off');
                  }}
                >
                  <BellOff /> Couper sur cet appareil
                </button>
              )}
              <span className="grow" />
              {unread > 0 && (
                <button className="btn sm" onClick={markAll}>
                  <CheckCheck /> Tout marquer comme lu
                </button>
              )}
            </>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <PushCard />
            {feed?.items.length ? (
              <div className="notif-list">
                {feed.items.map((n) => (
                  <button
                    key={n.id}
                    className={`notif${n.read ? '' : ' unread'}`}
                    onClick={async () => {
                      if (!n.read) await api.post('/notifications/read', { ids: [n.id] }).catch(() => undefined);
                      setOpen(false);
                      load();
                      if (n.url) nav(n.url);
                    }}
                  >
                    <i />
                    <span className="grow">
                      <b>{n.title}</b>
                      {n.body && <small>{n.body}</small>}
                    </span>
                    <time>{relative(n.createdAt)}</time>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
                Rien de nouveau pour l’instant.
              </p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
