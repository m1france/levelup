/** Jetons signés (liens partageables sans compte) : charge utile lisible + signature HMAC. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './auth.js';
import { secret } from './convocations.js';

export function sign(kind, ...parts) {
  const payload = Buffer.from([kind, ...parts].join('|')).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 22);
  return `${payload}.${sig}`;
}

export function verify(kind, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) throw new HttpError(404, 'Lien invalide');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 22);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new HttpError(404, 'Lien invalide');
  const [k, ...parts] = Buffer.from(payload, 'base64url').toString().split('|');
  if (k !== kind) throw new HttpError(404, 'Lien invalide');
  return parts;
}
