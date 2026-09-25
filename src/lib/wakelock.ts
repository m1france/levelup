import { useEffect } from 'react';

/** Garde l'écran allumé (séance en cours, mode tableau). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (!alive) void lock.release();
      } catch {
        /* refusé (batterie faible, onglet masqué…) */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void request();
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
