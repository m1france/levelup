/** Calcul d'un maillage sculpté (utilisé par le worker, ou directement sur la page sans worker). */
import { bodyMesh, handMesh } from './body';
import { headMesh } from './head';
import type { MeshJob } from './meshes';

export function runJob(job: MeshJob) {
  if (job.kind === 'head') return headMesh(job.p);
  if (job.kind === 'hand') return handMesh(job.skin);
  return bodyMesh(job.name);
}
