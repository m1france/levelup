export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Pending { method: Method; path: string; body?: unknown; at: number }

const OUTBOX_KEY = 'atelier.outbox';
const listeners = new Set<(n: number) => void>();

function readOutbox(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeOutbox(list: Pending[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch {
    /* stockage indisponible : on garde en mémoire seulement */
  }
  listeners.forEach((l) => l(list.length));
}

/** Les écritures idempotentes (PUT/DELETE sur un id) sont mises en file quand le réseau manque. */
function enqueue(p: Pending) {
  const list = readOutbox().filter((q) => !(q.path === p.path && q.method === p.method));
  list.push(p);
  writeOutbox(list);
}

export function onOutboxChange(fn: (n: number) => void) {
  listeners.add(fn);
  fn(readOutbox().length);
  return () => listeners.delete(fn);
}

let flushing = false;
export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    for (const p of readOutbox()) {
      try {
        await raw(p.method, p.path, p.body);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // toujours hors-ligne
      }
      writeOutbox(readOutbox().filter((q) => !(q.path === p.path && q.method === p.method && q.at === p.at)));
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushOutbox());
  setInterval(() => navigator.onLine && readOutbox().length && void flushOutbox(), 30_000);
}

async function raw<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Pas de connexion internet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Une erreur est survenue');
  return data as T;
}

async function send<T>(method: Method, path: string, body?: unknown, queueable = false): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (queueable && e instanceof ApiError && e.status === 0) {
      enqueue({ method, path, body, at: Date.now() });
      return body as T;
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string) => raw<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => send<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => send<T>('PATCH', path, body),
  /** PUT = upsert sur un id généré côté client : peut être rejoué hors-ligne. */
  put: <T>(path: string, body: unknown) => send<T>('PUT', path, body, true),
  del: <T = { ok: true }>(path: string) => send<T>('DELETE', path, undefined, true),
};

export function uid(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return Array.from(bytes, (b) => abc[b & 63]).join('');
}
