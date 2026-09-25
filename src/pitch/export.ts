import type { ExerciseData } from '../lib/types';
import { buildTimeline, evaluate } from './anim';
import { computeView } from './geometry';
import { drawScene } from './render';

function pickMime() {
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export const canExportVideo = () => typeof MediaRecorder !== 'undefined' && !!pickMime() && 'captureStream' in HTMLCanvasElement.prototype;

/**
 * Enregistre l'animation (2 passages) dans une vidéo partageable (WhatsApp, SportEasy…).
 * Rendu hors écran en 1280 px de large, titre incrusté.
 */
export async function exportVideo(ex: ExerciseData, onProgress?: (p: number) => void): Promise<File> {
  const mime = pickMime();
  if (!mime) throw new Error("L'export vidéo n'est pas pris en charge par ce navigateur");
  const tl = buildTimeline(ex);
  const landscape = ex.field.w >= ex.field.h;
  const W = landscape ? 1280 : 900;
  const fieldH = Math.round(W * ((ex.field.h + 3) / (ex.field.w + 3)));
  const top = 72;
  const H = Math.min(1600, fieldH + top) & ~1;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const view = computeView(ex.field, W, H - top, false);
  view.oy += top;
  view.height = H;

  const draw = (t: number) => {
    const { pos } = evaluate(ex, tl, t);
    drawScene(ctx, ex, { view, dpr: 1, pos, bg: '#37714c' });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, W, top);
    ctx.fillStyle = '#1b1c1a';
    ctx.font = '600 30px ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(ex.title || 'Exercice', 28, top / 2);
    ctx.fillStyle = '#8a8a82';
    ctx.font = '500 20px ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Atelier', W - 28, top / 2);
    ctx.textAlign = 'left';
  };

  const hold = 800;
  const loops = tl.total > 0 ? 2 : 1;
  const duration = Math.max(2000, (tl.total + hold) * loops + hold);
  draw(0);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(250);

  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const el = performance.now() - t0;
      const cycle = tl.total + hold;
      const local = el - hold;
      draw(local <= 0 ? 0 : Math.min(tl.total, local % cycle));
      onProgress?.(Math.min(1, el / duration));
      if (el >= duration) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const name = `${(ex.title || 'exercice').toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, '-').replace(/^-|-$/g, '')}.${ext}`;
  return new File(chunks, name, { type: mime.split(';')[0] });
}

/** Partage natif (mobile) ou téléchargement. */
export async function shareOrDownload(file: File, title: string) {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
