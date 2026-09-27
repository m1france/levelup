/** Notifications : centre de notifications dans l'app, temps réel sur les onglets ouverts et Web Push. */
import { run } from './db.js';
import { newId } from './auth.js';
import { toUsers } from './live.js';
import { pushTo } from './push.js';

/**
 * n = { kind, title, body, url, tag?, actions?, answerToken? }
 * Un même utilisateur ne reçoit la notification qu'une fois.
 */
export function notify(userIds, n) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const at = Date.now();
  for (const uid of ids) {
    const id = newId();
    run('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', id, uid, n.kind, n.title, n.body || '', n.url || '', at);
    pushTo(uid, { id, title: n.title, body: n.body || '', url: n.url || '/', tag: n.tag, actions: n.actions, answerToken: n.answerToken });
  }
  toUsers(ids, { t: 'notif' });
  return ids.length;
}
