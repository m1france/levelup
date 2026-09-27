/**
 * Notifications Web Push sans dépendance : clés VAPID (ES256) et chiffrement aes128gcm (RFC 8291).
 * Les clés sont générées au premier lancement et gardées dans la base.
 */
import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, createCipheriv } from 'node:crypto';
import { all, get, kvGet, kvSet, run } from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function vapidKeys() {
  let raw = kvGet('vapid');
  if (!raw) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    raw = JSON.stringify(privateKey.export({ format: 'jwk' }));
    kvSet('vapid', raw);
  }
  const jwk = JSON.parse(raw);
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { key: createPrivateKey({ key: jwk, format: 'jwk' }), publicKey: b64u(pub) };
}

let keys = null;
export function publicKey() {
  keys ??= vapidKeys();
  return keys.publicKey;
}

function vapidHeader(endpoint) {
  keys ??= vapidKeys();
  const aud = new URL(endpoint).origin;
  const admin = get(`SELECT email FROM users WHERE role = 'admin' LIMIT 1`)?.email || 'contact@levelup.app';
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${admin}` }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: keys.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

export function encrypt(sub, payload) {
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

async function sendOne(sub, payload) {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body: encrypt(sub, payload),
    });
    // Abonnement expiré ou révoqué : on l'oublie.
    if (res.status === 404 || res.status === 410) run('DELETE FROM push_subs WHERE endpoint = ?', sub.endpoint);
    else if (!res.ok) console.warn(`Push refusé (${res.status}) : ${await res.text().catch(() => '')}`);
  } catch (e) {
    console.warn('Push impossible :', e.message);
  }
}

/** Envoie une notification à tous les appareils de l'utilisateur (sans attendre). */
export function pushTo(userId, message) {
  const subs = all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  const payload = JSON.stringify(message).slice(0, 3000);
  for (const s of subs) void sendOne(s, payload);
  return subs.length;
}

export function saveSubscription(userId, sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return false;
  run(
    `INSERT INTO push_subs VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    endpoint, userId, p256dh, auth, Date.now(),
  );
  return true;
}
