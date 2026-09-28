/**
 * Synthèse vocale Fish Audio via OpenRouter (POST /api/v1/audio/speech).
 * - Clé : OPENROUTER_API_KEY (fichier .env, jamais versionné). Modèle : PRESS_TTS_MODEL.
 * - Voix : un identifiant de voix Fish Audio, ou le clonage d'un échantillon enregistré par le présentateur.
 * - Chaque phrase n'est générée qu'une fois : les MP3 sont gardés dans data/uploads/tts/.
 * - Les appels passent un par un (le modèle gratuit limite le nombre de requêtes par minute).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOADS } from './db.js';

const API = 'https://openrouter.ai/api/v1/audio/speech';
// Le modèle demandé, puis la même voix sans le suffixe « :free » si OpenRouter ne le reconnaît pas.
const MODELS = [...new Set([process.env.PRESS_TTS_MODEL || 'fish-audio/s2.1-pro-free:free', 'fish-audio/s2.1-pro-free'])];
const DIR = join(UPLOADS, 'tts');
mkdirSync(DIR, { recursive: true });

export const ttsReady = () => !!process.env.OPENROUTER_API_KEY;

let model = MODELS[0];
let chain = Promise.resolve();
const inflight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TtsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * MP3 d'une phrase (chemin du fichier). `reference` : { file, type, transcript, v } pour cloner une voix.
 * Plusieurs demandes de la même phrase attendent la même génération.
 */
export function speech({ text, voice = '', reference = null }) {
  if (!ttsReady()) return Promise.reject(new TtsError(503, 'Synthèse vocale non configurée (OPENROUTER_API_KEY)'));
  const key = createHash('sha1')
    .update(JSON.stringify([MODELS[0], text, reference ? `ref:${reference.v}:${reference.transcript || ''}` : voice]))
    .digest('hex');
  const file = join(DIR, `${key}.mp3`);
  if (existsSync(file)) return Promise.resolve(file);
  if (inflight.has(key)) return inflight.get(key);
  const job = chain.then(() => (existsSync(file) ? file : generate(text, voice, reference, file)));
  chain = job.catch(() => undefined);
  const p = job.finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function generate(text, voice, reference, file, attempt = 0) {
  const body = { model, input: text, response_format: 'mp3' };
  if (reference && existsSync(reference.file)) {
    const b64 = readFileSync(reference.file).toString('base64');
    body.input_references = [
      { type: 'input_audio', input_audio: { data: `data:${reference.type || 'audio/webm'};base64,${b64}` } },
      ...(reference.transcript ? [{ type: 'text', text: reference.transcript }] : []),
    ];
  } else if (voice) body.voice = voice;
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Atelier',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    if (attempt < 2) return sleep(1500 * (attempt + 1)).then(() => generate(text, voice, reference, file, attempt + 1));
    throw new TtsError(502, `Synthèse vocale injoignable : ${e.message}`);
  }
  if (res.status === 429 || res.status >= 500) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 4000 * (attempt + 1);
    if (attempt < 4) return sleep(Math.min(30_000, wait)).then(() => generate(text, voice, reference, file, attempt + 1));
  }
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 300);
    // Identifiant de modèle inconnu : on essaie le suivant.
    const next = MODELS[MODELS.indexOf(model) + 1];
    if ((res.status === 400 || res.status === 404) && /model/i.test(msg) && next) {
      model = next;
      return generate(text, voice, reference, file, attempt);
    }
    console.warn(`Synthèse vocale : ${res.status} ${msg}`);
    throw new TtsError(res.status === 402 || res.status === 401 ? res.status : 502, `Synthèse vocale indisponible (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 400) throw new TtsError(502, 'Synthèse vocale : réponse vide');
  writeFileSync(file, buf);
  return file;
}
