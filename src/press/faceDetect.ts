/**
 * Détection du visage sur la photo d'un présentateur (MediaPipe Face Landmarker, dans le navigateur) :
 * 478 points 3D qui servent à sculpter sa tête. Chargé seulement quand on envoie une photo.
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

const VERSION = '1.0.1';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Points du visage : [x, y, z] (x, y en fraction de l'image ; z, profondeur à l'échelle de la largeur). */
export type Landmarks = [number, number, number][];

let landmarker: Promise<FaceLandmarker> | null = null;

function load() {
  landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`);
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
    });
  })().catch((e) => {
    landmarker = null;
    throw e;
  });
  return landmarker;
}

/** Points du visage le plus grand de la photo, ou null si aucun visage n'est trouvé. */
export async function detectFace(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Promise<Landmarks | null> {
  const lm = await load();
  const res = lm.detect(img);
  const face = res.faceLandmarks?.[0];
  if (!face || face.length < 468) return null;
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return face.map((p) => [r(p.x), r(p.y), r(p.z)]);
}
