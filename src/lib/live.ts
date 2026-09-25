import { useEffect, useRef } from 'react';
import { CLIENT_ID } from './api';
import type { ExerciseData } from './types';

export interface PresenceUser { clientId: string; userId: string; name: string; editor: boolean }

export type LiveMsg =
  | { t: 'hello' }
  | { t: 'reconnect' }
  | { t: 'exercise'; id: string; teamId: string | null; deleted: boolean; by?: string; updatedAt: number }
  | { t: 'training'; id: string; teamId: string; deleted?: boolean; by?: string }
  | { t: 'presence'; exId: string; users: PresenceUser[] }
  | { t: 'state'; exId: string; from: string; userId: string; name: string; data: ExerciseData }
  | { t: 'cursor'; exId: string; from: string; userId: string; name: string; cursor: [number, number] | null; frame: number };

const subs = new Set<(m: LiveMsg) => void>();
let es: EventSource | null = null;
let watching: string | null = null;

function connect() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource(`/api/live?clientId=${CLIENT_ID}`);
  es.onmessage = (e) => {
    let msg: LiveMsg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    // À chaque (re)connexion, le serveur a oublié l'exercice ouvert : on le lui redit.
    if (msg.t === 'hello' && watching) void postWatch(watching);
    if (msg.t === 'reconnect') {
      es?.close();
      es = null;
      connect();
      return;
    }
    subs.forEach((fn) => fn(msg));
  };
}

/** Les changements d'exercice ouvert partent dans l'ordre (quitter A puis ouvrir B, jamais l'inverse). */
let watchChain: Promise<unknown> = Promise.resolve();
function postWatch(exerciseId: string | null) {
  watchChain = watchChain.then(() =>
    fetch('/api/live/watch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
      body: JSON.stringify({ exerciseId }),
      keepalive: !exerciseId,
    }).catch(() => undefined),
  );
  return watchChain;
}

/** Écoute les messages temps réel (la connexion est ouverte au premier abonné). */
export function useLive(handler: (m: LiveMsg) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    connect();
    const fn = (m: LiveMsg) => ref.current(m);
    subs.add(fn);
    return () => void subs.delete(fn);
  }, []);
}

/** Signale l'exercice ouvert dans cet onglet (présence, réception des modifications en direct). */
export function useWatchExercise(exerciseId: string | null) {
  useEffect(() => {
    if (!exerciseId) return;
    connect();
    watching = exerciseId;
    void postWatch(exerciseId);
    return () => {
      if (watching === exerciseId) watching = null;
      void postWatch(null);
    };
  }, [exerciseId]);
}

/** Envoi immédiat (non mis en file hors-ligne : seul l'instant présent compte). */
export function sendLive(exerciseId: string, body: { state?: ExerciseData; cursor?: [number, number] | null; frame?: number }) {
  void fetch(`/api/exercises/${exerciseId}/live`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Couleur stable par personne (curseurs, pastilles de présence). */
const PEER_COLORS = ['#e8590c', '#1c7ed6', '#9c36b5', '#2b8a3e', '#c2255c', '#0c8599', '#5f3dc4', '#e67700'];
export function peerColor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
