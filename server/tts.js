/**
 * Synthèse vocale Fish Audio via OpenRouter : un simple POST /api/v1/audio/speech qui renvoie un MP3.
 * - Clé : OPENROUTER_API_KEY (fichier .env, jamais versionné). Modèle : PRESS_TTS_MODEL.
 * - Voix : un identifiant de voix Fish Audio, ou le clonage d'un échantillon enregistré par le présentateur.
 * - Chaque phrase n'est générée qu'une fois : les MP3 sont gardés dans data/uploads/tts/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOADS } from './db.js';

const API = 'https://openrouter.ai/api/v1/audio/speech';
const MODEL = process.env.PRESS_TTS_MODEL || 'fish-audio/s2.1-pro-free:free';
const DIR = join(UPLOADS, 'tts');
mkdirSync(DIR, { recursive: true });

export const ttsReady = () => !!process.env.OPENROUTER_API_KEY;

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
    .update(JSON.stringify([MODEL, text, reference ? `ref:${reference.v}:${reference.transcript || ''}` : voice]))
    .digest('hex');
  const file = join(DIR, `${key}.mp3`);
  if (existsSync(file)) return Promise.resolve(file);
  if (!inflight.has(key)) {
    const job = synthesize(text, voice, reference)
      .then((buf) => (writeFileSync(file, buf), file))
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return inflight.get(key);
}

/** Appel OpenRouter ; réessaie quelques fois si le modèle gratuit est saturé (429) ou en panne (5xx). */
async function synthesize(text, voice, reference) {
  const body = { model: MODEL, input: text, response_format: 'mp3' };
  if (reference && existsSync(reference.file)) {
    const b64 = readFileSync(reference.file).toString('base64');
    body.input_references = [
      { type: 'input_audio', input_audio: { data: `data:${reference.type || 'audio/webm'};base64,${b64}` } },
      ...(reference.transcript ? [{ type: 'text', text: reference.transcript }] : []),
    ];
  } else if (voice) body.voice = voice;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message, headers: new Headers() }));

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 400) throw new TtsError(502, 'Synthèse vocale : réponse vide');
      return buf;
    }
    if ((res.status === 0 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 3000 * (attempt + 1));
      continue;
    }
    const msg = (await res.text().catch(() => '')).slice(0, 300);
    console.warn(`Synthèse vocale : ${res.status} ${msg}`);
    throw new TtsError(res.status === 401 || res.status === 402 ? res.status : 502, `Synthèse vocale indisponible (${res.status || 'réseau'})`);
  }
}
