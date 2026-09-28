/**
 * Maillages sculptés, calculés en parallèle dans des workers (repli sur le fil principal sans worker),
 * et gardés en mémoire : l'aperçu des réglages et « Revoir » ne recalculent rien.
 */
import type * as THREE from 'three';
import type { BodyPart } from './body';
import type { HeadMeshParams } from './head';
import { toGeometry, type MeshData } from './sdf';

export type MeshJob = { kind: 'head'; p: HeadMeshParams } | { kind: 'hand'; skin: string } | { kind: 'body'; name: BodyPart };

const cache = new Map<string, Promise<THREE.BufferGeometry>>();
const pending = new Map<number, { job: MeshJob; ok: (d: MeshData) => void; ko: (e: unknown) => void }>();
let pool: Worker[] | null = null;
let turn = 0;
let nextId = 1;

/** Calcul sur le fil principal (navigateur sans worker de module, ou worker en échec). */
async function local(job: MeshJob) {
  const { runJob } = await import('./meshJobs');
  return runJob(job);
}

function workers(): Worker[] {
  if (pool) return pool;
  pool = [];
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; d: MeshData }>) => {
        pending.get(e.data.id)?.ok(e.data.d);
        pending.delete(e.data.id);
      };
      // Worker indisponible : les calculs en attente repassent sur le fil principal.
      w.onerror = () => {
        pool = [];
        for (const [id, p] of pending) {
          pending.delete(id);
          local(p.job).then(p.ok, p.ko);
        }
      };
      pool.push(w);
    }
  } catch {
    pool = [];
  }
  return pool;
}

function compute(job: MeshJob): Promise<MeshData> {
  const ws = workers();
  if (!ws.length) return local(job);
  return new Promise((ok, ko) => {
    const id = nextId++;
    pending.set(id, { job, ok, ko });
    ws[turn++ % ws.length].postMessage({ id, job });
  });
}

export function mesh(job: MeshJob): Promise<THREE.BufferGeometry> {
  const key = JSON.stringify(job);
  let p = cache.get(key);
  if (!p) {
    p = compute(job).then(toGeometry);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
