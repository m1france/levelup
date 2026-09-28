/** Worker : sculpte les maillages (tête, veste, mains, public) hors du fil principal. */
import { runJob } from './meshJobs';
import type { MeshJob } from './meshes';
import { transferables } from './sdf';

self.onmessage = (e: MessageEvent<{ id: number; job: MeshJob }>) => {
  const d = runJob(e.data.job);
  (self as unknown as Worker).postMessage({ id: e.data.id, d }, transferables(d));
};
