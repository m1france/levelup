/**
 * Vie d'équipe : covoiturage par match, messagerie (discussions d'équipe, messages privés,
 * cartes interactives : covoiturage, sondage, « qui apporte quoi », match, lieu) et annonces du club
 * avec accusé de lecture.
 */
import { Router } from 'express';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, tx, UPLOADS } from './db.js';
import { can, needTeam, isStaff, childIdsFor, teamIdsFor, permsFor, newId, HttpError } from './auth.js';

const asUser = (u) => ({ ...u, perms: new Set(permsFor(u.role)) });
import { occ, evTitle, teamPlayers, occPlayers, parentsOf, staffOf, convOf } from './convocations.js';
import { occurrences, todayYMD, ymdAdd, shortDay, hm } from './occurrences.js';
import { notify } from './notify.js';
import { toUsers } from './live.js';
import { pushTo } from './push.js';

export const socialApi = Router();

const now = () => Date.now();
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hhmm = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? v : '');
const userName = (id) => get('SELECT name FROM users WHERE id = ?', id)?.name ?? 'Membre';

/* ================================================================== covoiturage */

function carpoolOcc(user, eventId, date) {
  const o = occ(eventId, date);
  needTeam(user, o.e.teamId);
  return o;
}

/** Enfants que l'utilisateur peut inscrire : les siens (parent) ou toute la catégorie du match (éducateur). */
function bookableKids(user, o) {
  const players = occPlayers(o);
  if (isStaff(user)) return players;
  const kids = childIdsFor(user);
  return players.filter((p) => kids.includes(p.id));
}

export function carpoolView(o, user) {
  const rows = all(`SELECT * FROM carpool WHERE event_id = ? AND date = ? ORDER BY created_at`, o.e.id, o.date);
  const players = Object.fromEntries(teamPlayers(o.e.teamId).map((p) => [p.id, p]));
  const booked = new Set();
  const offers = rows
    .filter((r) => r.kind === 'offer')
    .map((r) => {
      const bookings = all('SELECT * FROM carpool_bookings WHERE offer_id = ? ORDER BY created_at', r.id).map((b) => {
        booked.add(b.player_id);
        return { playerId: b.player_id, firstName: players[b.player_id]?.firstName ?? '?', mine: b.user_id === user.id };
      });
      return {
        id: r.id, driver: { id: r.user_id, name: userName(r.user_id) }, mine: r.user_id === user.id, direction: r.direction,
        seats: r.seats, free: Math.max(0, r.seats - bookings.length), place: r.place, time: r.time, note: r.note, bookings,
      };
    });
  const requests = rows
    .filter((r) => r.kind === 'request')
    .map((r) => ({
      id: r.id, parent: { id: r.user_id, name: userName(r.user_id) }, mine: r.user_id === user.id, direction: r.direction, note: r.note,
      playerId: r.player_id, firstName: players[r.player_id]?.firstName ?? '', solved: booked.has(r.player_id),
    }));
  const free = offers.reduce((a, x) => a + x.free, 0);
  return {
    eventId: o.e.id, date: o.date, title: evTitle(o.e), meetTime: o.data.meetTime || o.e.meetTime || '', location: o.e.location,
    offers, requests, free, needs: requests.filter((r) => !r.solved).length,
    kids: bookableKids(user, o).map((p) => ({ id: p.id, firstName: p.firstName, booked: booked.has(p.id) })),
  };
}

socialApi.get('/carpool/:eventId/:date', (req, res) => {
  res.json(carpoolView(carpoolOcc(req.user, req.params.eventId, req.params.date), req.user));
});

/** Prochains matchs avec leur covoiturage (mis en avant sur l'accueil). */
socialApi.get('/carpool-upcoming', (req, res) => {
  const today = todayYMD();
  const out = [];
  for (const teamId of teamIdsFor(req.user)) {
    for (const r of all('SELECT * FROM events WHERE team_id = ?', teamId)) {
      const e = { ...JSON.parse(r.data), id: r.id, teamId };
      if (!convOf(e).enabled || (!isStaff(req.user) && e.parents === false)) continue;
      for (const date of occurrences(e, today, ymdAdd(today, 12))) {
        const v = carpoolView(occ(e.id, date), req.user);
        // Un parent ne voit que les matchs de la catégorie de son enfant (U8 ou U9).
        if (!isStaff(req.user) && !v.kids.length) continue;
        out.push({ ...v, teamId, kids: undefined, iDrive: v.offers.some((x) => x.mine), iNeed: v.requests.some((x) => x.mine && !x.solved) });
      }
    }
  }
  res.json(out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6));
});

socialApi.post('/carpool/:eventId/:date', (req, res) => {
  const o = carpoolOcc(req.user, req.params.eventId, req.params.date);
  const kind = req.body.kind === 'request' ? 'request' : 'offer';
  const direction = ['aller', 'retour', 'both'].includes(req.body.direction) ? req.body.direction : 'both';
  const id = newId();
  if (kind === 'offer') {
    const seats = Math.max(1, Math.min(8, Math.round(Number(req.body.seats) || 1)));
    run('INSERT INTO carpool VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)', id, o.e.id, o.date, req.user.id, kind, direction, seats, str(req.body.place, 120), hhmm(req.body.time), str(req.body.note, 200), now());
    // Les familles qui cherchent une place sont prévenues.
    const waiting = all(`SELECT DISTINCT user_id FROM carpool WHERE event_id = ? AND date = ? AND kind = 'request' AND user_id != ?`, o.e.id, o.date, req.user.id).map((r) => r.user_id);
    notify(waiting, {
      kind: 'carpool', title: `🚗 ${seats} place${seats > 1 ? 's' : ''} proposée${seats > 1 ? 's' : ''} pour ${shortDay(o.date)}`,
      body: `${req.user.name} part ${req.body.place ? `de ${str(req.body.place, 120)} ` : ''}${hhmm(req.body.time) ? `à ${hm(req.body.time)}` : ''} pour ${evTitle(o.e)}.`,
      url: `/matchs/${o.e.id}/${o.date}?covoiturage=1`,
    });
    if (req.body.share !== false) postToTeam(o.e.teamId, req.user, 'carpool', '', { offerId: id, eventId: o.e.id, date: o.date });
  } else {
    const kid = bookableKids(req.user, o).find((p) => p.id === req.body.playerId);
    if (!kid) throw new HttpError(400, 'Choisissez l’enfant');
    run('INSERT INTO carpool VALUES (?, ?, ?, ?, ?, ?, 0, ?, \'\', ?, ?, ?)', id, o.e.id, o.date, req.user.id, kind, direction, '', str(req.body.note, 200), kid.id, now());
    if (req.body.share !== false) postToTeam(o.e.teamId, req.user, 'carpool', '', { requestId: id, eventId: o.e.id, date: o.date });
  }
  toUsers(teamMemberIds(o.e.teamId), { t: 'carpool', eventId: o.e.id, date: o.date });
  res.json(carpoolView(o, req.user));
});

socialApi.post('/carpool/offer/:id/book', (req, res) => {
  const offer = get(`SELECT * FROM carpool WHERE id = ? AND kind = 'offer'`, req.params.id);
  if (!offer) throw new HttpError(404, 'Trajet introuvable');
  const o = carpoolOcc(req.user, offer.event_id, offer.date);
  const kid = bookableKids(req.user, o).find((p) => p.id === req.body.playerId);
  if (!kid) throw new HttpError(400, 'Choisissez l’enfant');
  tx(() => {
    const taken = get('SELECT COUNT(*) n FROM carpool_bookings WHERE offer_id = ?', offer.id).n;
    if (taken >= offer.seats) throw new HttpError(409, 'Plus de place dans cette voiture');
    run('INSERT OR IGNORE INTO carpool_bookings VALUES (?, ?, ?, ?)', offer.id, kid.id, req.user.id, now());
  });
  if (offer.user_id !== req.user.id) {
    notify([offer.user_id], {
      kind: 'carpool', title: `🚗 ${kid.firstName} monte avec vous ${shortDay(o.date)}`,
      body: `${req.user.name} a réservé une place pour ${evTitle(o.e)}.`, url: `/matchs/${o.e.id}/${o.date}?covoiturage=1`,
    });
  }
  toUsers(teamMemberIds(o.e.teamId), { t: 'carpool', eventId: o.e.id, date: o.date });
  res.json(carpoolView(o, req.user));
});

socialApi.delete('/carpool/offer/:id/book/:playerId', (req, res) => {
  const offer = get(`SELECT * FROM carpool WHERE id = ?`, req.params.id);
  if (!offer) throw new HttpError(404, 'Trajet introuvable');
  const o = carpoolOcc(req.user, offer.event_id, offer.date);
  const b = get('SELECT * FROM carpool_bookings WHERE offer_id = ? AND player_id = ?', offer.id, req.params.playerId);
  if (b && (b.user_id === req.user.id || offer.user_id === req.user.id || isStaff(req.user) || childIdsFor(req.user).includes(b.player_id))) {
    run('DELETE FROM carpool_bookings WHERE offer_id = ? AND player_id = ?', offer.id, b.player_id);
  }
  toUsers(teamMemberIds(o.e.teamId), { t: 'carpool', eventId: o.e.id, date: o.date });
  res.json(carpoolView(o, req.user));
});

socialApi.delete('/carpool/:id', (req, res) => {
  const r = get('SELECT * FROM carpool WHERE id = ?', req.params.id);
  if (!r) return res.json({ ok: true });
  const o = carpoolOcc(req.user, r.event_id, r.date);
  if (r.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Action non autorisée');
  if (r.kind === 'offer') {
    const riders = all('SELECT DISTINCT user_id FROM carpool_bookings WHERE offer_id = ? AND user_id != ?', r.id, req.user.id).map((b) => b.user_id);
    notify(riders, { kind: 'carpool', title: `🚗 Trajet annulé pour ${shortDay(o.date)}`, body: `${req.user.name} ne peut plus conduire. Pensez à trouver une autre place.`, url: `/matchs/${o.e.id}/${o.date}?covoiturage=1` });
  }
  run('DELETE FROM carpool WHERE id = ?', r.id);
  toUsers(teamMemberIds(o.e.teamId), { t: 'carpool', eventId: o.e.id, date: o.date });
  res.json(carpoolView(o, req.user));
});

/* ================================================================== messagerie */

/** Tous les membres d'une équipe : éducateurs, parents, et l'administrateur. */
function teamMemberIds(teamId) {
  const ids = new Set(staffOf(teamId));
  for (const p of teamPlayers(teamId)) for (const u of parentsOf(p.id)) ids.add(u.id);
  for (const u of all(`SELECT id, role FROM users WHERE role IN ('admin', 'dirigeant') AND status = 'active'`)) {
    if (u.role === 'admin' || teamIdsFor(asUser(u)).includes(teamId)) ids.add(u.id);
  }
  return [...ids];
}

const createThread = (kind, teamId, title, by = null, data = {}) => {
  const id = newId();
  run(
    'INSERT INTO chat_threads (id, kind, team_id, title, created_by, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, kind, teamId, title, by, now(), now(), JSON.stringify(data),
  );
  return get('SELECT * FROM chat_threads WHERE id = ?', id);
};

function ensureTeamThread(teamId) {
  return get(`SELECT * FROM chat_threads WHERE kind = 'team' AND team_id = ?`, teamId) ?? createThread('team', teamId, '');
}

function ensureStaffThread() {
  return get(`SELECT * FROM chat_threads WHERE kind = 'staff'`) ?? createThread('staff', null, 'Éducateurs du club');
}

/**
 * Salon « Annonces du club » : tout le club le lit, seuls ceux qui ont la permission « Publier dans le salon
 * Annonces » y écrivent. Les anciennes annonces (avec accusé de lecture) y sont reprises une fois.
 */
function ensureAnnounceThread() {
  let t = get(`SELECT * FROM chat_threads WHERE kind = 'announce'`);
  if (t) return t;
  t = createThread('announce', null, 'Annonces du club');
  tx(() => {
    const hasOld = get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'announcements'`);
    for (const a of hasOld ? all('SELECT * FROM announcements ORDER BY created_at') : []) {
      const d = JSON.parse(a.data || '{}');
      run('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, 0)', newId(), t.id, a.author_id, 'text', `${d.emoji || '📣'} ${a.title}\n\n${a.body}`, '{}', a.created_at);
    }
    // Les annonces reprises ne comptent pas comme non lues.
    for (const u of all(`SELECT id FROM users WHERE status = 'active'`)) markRead(t.id, u.id);
  });
  return t;
}

const tData = (t) => {
  try {
    return JSON.parse(t.data || '{}');
  } catch {
    return {};
  }
};

function memberIds(t) {
  if (t.kind === 'team') return teamMemberIds(t.team_id).filter((id) => canIn(userById(id), t, 'view'));
  if (t.kind === 'staff') return all(`SELECT id FROM users WHERE role != 'parent' AND status = 'active'`).map((u) => u.id).filter((id) => canIn(userById(id), t, 'view'));
  if (t.kind === 'announce') return all(`SELECT id FROM users WHERE status = 'active'`).map((u) => u.id).filter((id) => canIn(userById(id), t, 'view'));
  return all('SELECT user_id FROM chat_members WHERE thread_id = ?', t.id).map((r) => r.user_id);
}

function userById(id) {
  const u = get('SELECT id, name, role, status FROM users WHERE id = ?', id);
  return u ? asUser(u) : null;
}

/* ---------------------------------------------------------------- permissions des salons (façon Discord) */

/** Permissions d'un salon. Chaque rôle hérite des valeurs par défaut, que l'on peut autoriser ou refuser salon par salon. */
export const CHANNEL_PERMS = [
  { key: 'view', label: 'Voir le salon', hint: 'Sans cette permission, le salon n’apparaît pas.' },
  { key: 'send', label: 'Envoyer des messages' },
  { key: 'media', label: 'Joindre des photos et des cartes', hint: 'Photos, sondages, covoiturage, match, lieu…' },
  { key: 'react', label: 'Réagir aux messages' },
  { key: 'manage', label: 'Gérer les messages', hint: 'Supprimer les messages des autres.' },
];
const PERM_KEYS = CHANNEL_PERMS.map((p) => p.key);
const CHANNEL_ROLES = ['parent', 'coach', 'dirigeant'];

/** Valeur par défaut d'une permission pour un rôle, selon le type de salon. */
function defaultPerm(kind, role, perm, user) {
  const staff = role !== 'parent';
  switch (kind) {
    case 'team':
      return perm === 'manage' ? staff : true;
    case 'staff':
      return staff && (perm !== 'manage' || role === 'dirigeant');
    case 'announce':
      // Les parents lisent (et réagissent) ; seuls ceux qui ont le droit de publier écrivent.
      if (perm === 'view' || perm === 'react') return true;
      if (perm === 'manage') return role === 'dirigeant';
      return staff && (user ? can(user, 'announcements.send') : permsFor(role).includes('announcements.send'));
    default:
      return perm !== 'manage';
  }
}

/** Permission effective d'un utilisateur dans un salon. L'administrateur (et le créateur d'un groupe) peut tout. */
function canIn(user, t, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (t.kind === 'group' && t.created_by === user.id) return true;
  const over = tData(t).perms?.[user.role] ?? {};
  const val = (k) => (typeof over[k] === 'boolean' ? over[k] : defaultPerm(t.kind, user.role, k, user));
  if (perm !== 'view' && !val('view')) return false;
  return val(perm);
}
const myPerms = (user, t) => Object.fromEntries(PERM_KEYS.map((k) => [k, canIn(user, t, k)]));

function needIn(user, t, perm) {
  if (!canIn(user, t, perm)) throw new HttpError(403, perm === 'send' ? 'Ce salon est en lecture seule pour vous' : 'Action non autorisée dans ce salon');
}

/** Qui peut régler un salon : l'admin, les responsables des membres, le créateur d'un groupe, les éducateurs de l'équipe. */
function canConfigure(user, t) {
  if (user.role === 'admin' || can(user, 'members.manage')) return true;
  if (t.kind === 'group') return t.created_by === user.id;
  if (t.kind === 'team') return isStaff(user) && staffOf(t.team_id).includes(user.id);
  if (t.kind === 'announce' || t.kind === 'staff') return user.role === 'dirigeant';
  return false;
}

function threadAccess(user, id) {
  const t = get('SELECT * FROM chat_threads WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Discussion introuvable');
  const member = () => !!get('SELECT 1 FROM chat_members WHERE thread_id = ? AND user_id = ?', t.id, user.id);
  const ok =
    t.kind === 'team' ? teamIdsFor(user).includes(t.team_id)
    : t.kind === 'staff' ? isStaff(user)
    : t.kind === 'announce' ? true
    : member();
  if (!ok || !canIn(user, t, 'view')) throw new HttpError(404, 'Discussion introuvable');
  return t;
}

const lastRead = (threadId, userId) => get('SELECT last_read_at FROM chat_members WHERE thread_id = ? AND user_id = ?', threadId, userId)?.last_read_at ?? 0;

function markRead(threadId, userId, at = now()) {
  run(
    `INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
    threadId, userId, at,
  );
}

/** Discussion supprimée par ce membre : les messages d'avant restent cachés pour lui. */
const clearedAt = (threadId, userId) => get('SELECT cleared_at FROM chat_members WHERE thread_id = ? AND user_id = ?', threadId, userId)?.cleared_at ?? 0;

/** Un message supprimé disparaît pour tous ; l'administrateur le garde sous les yeux, marqué comme tel. */
const seesDeleted = (user) => user.role === 'admin';

function preview(m) {
  const d = JSON.parse(m.data || '{}');
  switch (m.kind) {
    case 'image': return '📷 Photo';
    case 'carpool': return d.requestId ? '🚗 Cherche une place en covoiturage' : '🚗 Propose un covoiturage';
    case 'poll': return `📊 ${d.question ?? 'Sondage'}`;
    case 'tasks': return `🧺 ${d.title ?? 'Qui apporte quoi ?'}`;
    case 'match': return '⚽ Match partagé';
    case 'location': return `📍 ${d.label ?? 'Lieu'}`;
    default: return m.body;
  }
}

function threadTitle(t, user) {
  if (t.kind === 'team') {
    const team = get('SELECT category, color FROM teams WHERE id = ?', t.team_id);
    return { title: `Équipe ${team?.category ?? ''}`.trim(), color: team?.color ?? null, category: team?.category ?? null };
  }
  if (t.kind === 'staff') return { title: t.title || 'Éducateurs du club', color: '#1f5b3f', category: null };
  if (t.kind === 'announce') return { title: 'Annonces du club', color: '#e8590c', category: null };
  if (t.kind === 'group') return { title: t.title || 'Groupe', color: tData(t).icon?.color ?? null, category: null };
  const other = all('SELECT u.id, u.name, u.role FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.user_id != ?', t.id, user.id)[0];
  return { title: other?.name ?? 'Discussion', color: null, category: null, otherId: other?.id ?? null, otherRole: other?.role ?? null };
}

function threadSummary(t, user) {
  const cleared = clearedAt(t.id, user.id);
  const last = get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.created_at > ? AND m.deleted = 0 ORDER BY m.created_at DESC LIMIT 1', t.id, cleared);
  const read = Math.max(lastRead(t.id, user.id), cleared);
  const unread = get('SELECT COUNT(*) n FROM chat_messages WHERE thread_id = ? AND created_at > ? AND (user_id IS NULL OR user_id != ?) AND deleted = 0', t.id, read, user.id).n;
  const icon = tData(t).icon ?? null;
  return {
    id: t.id, kind: t.kind, teamId: t.team_id, ...threadTitle(t, user), unread,
    icon: icon ? { emoji: icon.emoji ?? null, image: icon.image ? `/api/chat/threads/${t.id}/icon?v=${icon.image}` : null } : null,
    perms: myPerms(user, t),
    canConfigure: canConfigure(user, t),
    // Discussion privée ou groupe : chacun peut la supprimer de sa liste ; le créateur d'un groupe peut le supprimer pour tous.
    canDelete: t.kind === 'direct' || t.kind === 'group',
    owner: t.kind === 'group' && (t.created_by === user.id || user.role === 'admin'),
    last: last ? { preview: preview(last), author: last.author, mine: last.user_id === user.id, at: last.created_at } : null,
    updatedAt: last?.created_at ?? Math.max(t.created_at, cleared),
  };
}

function userThreads(user) {
  const list = [ensureAnnounceThread(), ...teamIdsFor(user).map(ensureTeamThread)];
  if (isStaff(user)) list.push(ensureStaffThread());
  list.push(
    ...all(`SELECT t.* FROM chat_threads t JOIN chat_members m ON m.thread_id = t.id WHERE t.kind IN ('direct', 'group') AND m.user_id = ? AND m.hidden = 0`, user.id),
  );
  return list.filter((t) => canIn(user, t, 'view'));
}

socialApi.get('/chat/threads', (req, res) => {
  res.json(userThreads(req.user).map((t) => threadSummary(t, req.user)).sort((a, b) => b.updatedAt - a.updatedAt));
});

socialApi.get('/chat/unread', (req, res) => {
  res.json({ unread: userThreads(req.user).reduce((a, t) => a + threadSummary(t, req.user).unread, 0) });
});

/** Personnes joignables en privé : les membres des mêmes équipes. */
socialApi.get('/chat/contacts', (req, res) => {
  const seen = new Map();
  for (const teamId of teamIdsFor(req.user)) {
    const team = get('SELECT category FROM teams WHERE id = ?', teamId)?.category ?? '';
    for (const id of staffOf(teamId)) if (id !== req.user.id) seen.set(id, { ...(seen.get(id) || { id, kids: [] }), team, coach: true });
    for (const p of teamPlayers(teamId)) {
      for (const u of parentsOf(p.id)) {
        if (u.id === req.user.id) continue;
        const c = seen.get(u.id) || { id: u.id, kids: [], team };
        c.kids.push(p.firstName);
        seen.set(u.id, c);
      }
    }
  }
  res.json([...seen.values()].map((c) => ({ ...c, name: userName(c.id) })).sort((a, b) => Number(!!b.coach) - Number(!!a.coach) || a.name.localeCompare(b.name, 'fr')));
});

socialApi.post('/chat/direct', (req, res) => {
  const other = String(req.body.userId || '');
  if (other === req.user.id) throw new HttpError(400, 'Destinataire invalide');
  const mine = new Set(teamIdsFor(req.user));
  const target = get(`SELECT id, role, status FROM users WHERE id = ?`, other);
  if (!target || target.status !== 'active') throw new HttpError(404, 'Membre introuvable');
  const theirs = teamIdsFor(asUser(target));
  if (req.user.role !== 'admin' && target.role !== 'admin' && !theirs.some((t) => mine.has(t))) throw new HttpError(403, 'Vous ne partagez pas d’équipe avec ce membre');
  const existing = get(
    `SELECT t.id FROM chat_threads t JOIN chat_members a ON a.thread_id = t.id AND a.user_id = ? JOIN chat_members b ON b.thread_id = t.id AND b.user_id = ? WHERE t.kind = 'direct'`,
    req.user.id, other,
  );
  if (existing) {
    run('UPDATE chat_members SET hidden = 0 WHERE thread_id = ? AND user_id = ?', existing.id, req.user.id);
    return res.json({ id: existing.id });
  }
  const id = tx(() => {
    const t = createThread('direct', null, '', req.user.id);
    run('INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, ?)', t.id, req.user.id, now());
    run('INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, 0)', t.id, other);
    return t.id;
  });
  res.json({ id });
});

/* ---------------------------------------------------------------- groupes */

/** Membres qu'on peut ajouter à un groupe : ceux qui partagent une équipe (tous pour l'admin). */
function reachable(user) {
  if (user.role === 'admin') return new Set(all(`SELECT id FROM users WHERE status = 'active'`).map((u) => u.id));
  const ids = new Set();
  for (const teamId of teamIdsFor(user)) teamMemberIds(teamId).forEach((id) => ids.add(id));
  return ids;
}

/** Icône d'un groupe : un emoji sur une couleur, ou une image (data URL). */
function saveIcon(t, body) {
  const d = tData(t);
  const icon = { ...(d.icon || {}) };
  if (typeof body.emoji === 'string') icon.emoji = str(body.emoji, 16) || null;
  if (typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)) icon.color = body.color;
  if (body.image === null) delete icon.image;
  else if (body.image) {
    writeFileSync(join(UPLOADS, `chat_icon_${t.id}.jpg`), decodeImage(body.image, 1_500_000));
    icon.image = now();
  }
  run('UPDATE chat_threads SET data = ? WHERE id = ?', JSON.stringify({ ...d, icon }), t.id);
}

socialApi.post('/chat/groups', (req, res) => {
  const title = str(req.body.title, 60);
  if (!title) throw new HttpError(400, 'Donnez un titre au groupe');
  const allowed = reachable(req.user);
  const members = [...new Set((Array.isArray(req.body.members) ? req.body.members : []).map(String))].filter((id) => id !== req.user.id && allowed.has(id));
  if (!members.length) throw new HttpError(400, 'Ajoutez au moins une personne');
  const t = tx(() => {
    const t = createThread('group', null, title, req.user.id);
    run('INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, ?)', t.id, req.user.id, now());
    for (const id of members.slice(0, 200)) run('INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, 0)', t.id, id);
    return t;
  });
  saveIcon(t, req.body);
  broadcast(t, { t: 'chat', threadId: t.id });
  res.json({ id: t.id });
});

socialApi.get('/chat/threads/:id/icon', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  const file = join(UPLOADS, `chat_icon_${t.id}.jpg`);
  if (!existsSync(file)) throw new HttpError(404, 'Icône introuvable');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('jpeg').sendFile(file);
});

/** Titre, icône et membres d'un groupe. */
socialApi.patch('/chat/threads/:id', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  if (t.kind !== 'group') throw new HttpError(400, 'Seuls les groupes se renomment');
  if (!canConfigure(req.user, t)) throw new HttpError(403, 'Seul le créateur du groupe peut le modifier');
  const title = str(req.body.title, 60);
  if (title) run('UPDATE chat_threads SET title = ? WHERE id = ?', title, t.id);
  saveIcon(t, req.body);
  if (Array.isArray(req.body.add) || Array.isArray(req.body.remove)) {
    const allowed = reachable(req.user);
    tx(() => {
      for (const id of (req.body.add || []).map(String)) {
        if (allowed.has(id)) run('INSERT INTO chat_members (thread_id, user_id, last_read_at) VALUES (?, ?, 0) ON CONFLICT(thread_id, user_id) DO UPDATE SET hidden = 0', t.id, id);
      }
      for (const id of (req.body.remove || []).map(String)) if (id !== t.created_by) run('DELETE FROM chat_members WHERE thread_id = ? AND user_id = ?', t.id, id);
    });
  }
  broadcast(get('SELECT * FROM chat_threads WHERE id = ?', t.id), { t: 'chat', threadId: t.id });
  res.json(threadSummary(get('SELECT * FROM chat_threads WHERE id = ?', t.id), req.user));
});

/**
 * Supprimer une discussion. Privée : elle disparaît de ma liste avec son historique (elle revient, vide, au prochain message).
 * Groupe : je le quitte ; son créateur (ou l'admin) peut le supprimer pour tout le monde (`?all=1`).
 */
socialApi.delete('/chat/threads/:id', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  if (t.kind !== 'direct' && t.kind !== 'group') throw new HttpError(400, 'Les salons du club ne peuvent pas être supprimés');
  if (t.kind === 'group' && req.query.all === '1') {
    if (t.created_by !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Seul le créateur peut supprimer le groupe');
    const members = memberIds(t);
    run('DELETE FROM chat_threads WHERE id = ?', t.id);
    toUsers(members, { t: 'chat', threadId: t.id });
    return res.json({ ok: true });
  }
  if (t.kind === 'group' && t.created_by !== req.user.id) {
    run('DELETE FROM chat_members WHERE thread_id = ? AND user_id = ?', t.id, req.user.id);
    broadcast(t, { t: 'chat', threadId: t.id });
    return res.json({ ok: true });
  }
  run('UPDATE chat_members SET cleared_at = ?, hidden = 1, last_read_at = MAX(last_read_at, ?) WHERE thread_id = ? AND user_id = ?', now(), now(), t.id, req.user.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- réglages d'un salon */

socialApi.get('/chat/threads/:id/settings', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  if (!canConfigure(req.user, t)) throw new HttpError(403, 'Action non autorisée');
  const overrides = tData(t).perms ?? {};
  res.json({
    kind: t.kind,
    catalog: CHANNEL_PERMS,
    roles: (t.kind === 'direct' ? [] : CHANNEL_ROLES).map((role) => ({
      role,
      defaults: Object.fromEntries(PERM_KEYS.map((k) => [k, defaultPerm(t.kind, role, k, null)])),
      overrides: overrides[role] ?? {},
    })),
    members: t.kind === 'group'
      ? all('SELECT m.user_id id, u.name, u.role FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? ORDER BY u.name', t.id).map((m) => ({ ...m, owner: m.id === t.created_by }))
      : null,
  });
});

socialApi.put('/chat/threads/:id/permissions', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  if (!canConfigure(req.user, t)) throw new HttpError(403, 'Action non autorisée');
  if (t.kind === 'direct') throw new HttpError(400, 'Pas de permissions dans une discussion privée');
  const perms = {};
  for (const role of CHANNEL_ROLES) {
    const src = req.body.perms?.[role] ?? {};
    const out = {};
    for (const k of PERM_KEYS) if (typeof src[k] === 'boolean') out[k] = src[k];
    if (Object.keys(out).length) perms[role] = out;
  }
  run('UPDATE chat_threads SET data = ? WHERE id = ?', JSON.stringify({ ...tData(t), perms }), t.id);
  // Tout le monde recharge sa liste : un salon peut apparaître ou disparaître.
  toUsers(all(`SELECT id FROM users WHERE status = 'active'`).map((u) => u.id), { t: 'chat', threadId: t.id });
  res.json({ ok: true });
});

/** Dernières annonces (accueil) : les messages récents du salon Annonces. */
socialApi.get('/chat/announce', (req, res) => {
  const t = ensureAnnounceThread();
  if (!canIn(req.user, t, 'view')) return res.json({ threadId: null, messages: [] });
  const read = lastRead(t.id, req.user.id);
  const rows = all(
    `SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.deleted = 0 AND m.created_at > ? ORDER BY m.created_at DESC LIMIT 5`,
    t.id, now() - 14 * 864e5,
  );
  res.json({
    threadId: t.id,
    messages: rows.map((m) => ({ id: m.id, author: m.author, preview: preview(m), at: m.created_at, unread: m.created_at > read && m.user_id !== req.user.id })),
  });
});

const REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓', '⚽', '👏'];

function enrich(m, user) {
  const d = JSON.parse(m.data || '{}');
  const base = {
    id: m.id, threadId: m.thread_id, userId: m.user_id, author: m.author ?? null, mine: m.user_id === user.id, kind: m.kind,
    body: m.body, at: m.created_at, ...(m.deleted ? { deleted: true } : {}),
    reactions: all('SELECT r.emoji, r.user_id, u.name FROM chat_reactions r JOIN users u ON u.id = r.user_id WHERE msg_id = ?', m.id).map((r) => ({ emoji: r.emoji, mine: r.user_id === user.id, name: r.name })),
  };
  try {
    if (m.kind === 'carpool') {
      const cp = carpoolView(occ(d.eventId, d.date), user);
      const offer = d.offerId ? cp.offers.find((x) => x.id === d.offerId) ?? null : null;
      const request = d.requestId ? cp.requests.find((x) => x.id === d.requestId) ?? null : null;
      return { ...base, data: { eventId: d.eventId, date: d.date, title: cp.title, time: cp.time, location: cp.location, offer, request, kids: cp.kids, gone: !offer && !request } };
    }
    if (m.kind === 'match') {
      const o = occ(d.eventId, d.date);
      return { ...base, data: { eventId: o.e.id, date: o.date, title: evTitle(o.e), meetTime: o.data.meetTime || o.e.meetTime, location: o.e.location, venue: o.e.venue, type: o.e.type } };
    }
  } catch {
    return { ...base, data: { ...d, gone: true } };
  }
  if (m.kind === 'poll') {
    const votes = all('SELECT v.option_id, v.user_id, u.name FROM chat_votes v JOIN users u ON u.id = v.user_id WHERE msg_id = ?', m.id);
    return {
      ...base,
      data: {
        question: d.question, multi: !!d.multi,
        options: (d.options || []).map((o) => ({ ...o, votes: votes.filter((v) => v.option_id === o.id).length, mine: votes.some((v) => v.option_id === o.id && v.user_id === user.id), voters: votes.filter((v) => v.option_id === o.id).map((v) => v.name) })),
        total: new Set(votes.map((v) => v.user_id)).size,
      },
    };
  }
  if (m.kind === 'tasks') {
    const claims = all('SELECT c.item_id, c.user_id, u.name FROM chat_claims c JOIN users u ON u.id = c.user_id WHERE msg_id = ?', m.id);
    return {
      ...base,
      data: { title: d.title, date: d.date ?? null, items: (d.items || []).map((it) => { const c = claims.find((x) => x.item_id === it.id); return { ...it, by: c ? { name: c.name, mine: c.user_id === user.id } : null }; }) },
    };
  }
  return { ...base, data: d };
}

socialApi.get('/chat/threads/:id/messages', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  const before = Number(req.query.before) || now() + 1;
  const rows = all(
    `SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.created_at < ? AND m.created_at > ? AND (m.deleted = 0 OR ?) ORDER BY m.created_at DESC LIMIT 60`,
    t.id, before, clearedAt(t.id, req.user.id), seesDeleted(req.user) ? 1 : 0,
  ).reverse();
  const members = memberIds(t);
  const reads = Object.fromEntries(all('SELECT user_id, last_read_at FROM chat_members WHERE thread_id = ?', t.id).map((r) => [r.user_id, r.last_read_at]));
  res.json({
    thread: threadSummary(t, req.user),
    members: members.map((id) => ({ id, name: userName(id), readAt: reads[id] ?? 0 })),
    messages: rows.map((m) => enrich(m, req.user)),
    more: rows.length === 60,
  });
});

function broadcast(t, msg, except = null) {
  toUsers(memberIds(t).filter((id) => id !== except), msg);
}

function insertMessage(t, user, kind, body, data) {
  const id = newId();
  const at = now();
  run('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, 0)', id, t.id, user.id, kind, body, JSON.stringify(data || {}), at);
  run('UPDATE chat_threads SET updated_at = ? WHERE id = ?', at, t.id);
  // Une discussion supprimée réapparaît chez ceux qui l'avaient retirée de leur liste.
  if (t.kind === 'direct' || t.kind === 'group') run('UPDATE chat_members SET hidden = 0 WHERE thread_id = ?', t.id);
  markRead(t.id, user.id, at);
  const title = threadTitle(t, user).title;
  const text = preview({ kind, body, data: JSON.stringify(data || {}), deleted: 0 });
  for (const uid of memberIds(t)) {
    if (uid === user.id) continue;
    pushTo(uid, { title: t.kind === 'direct' ? user.name : `${user.name} · ${title}`, body: text.slice(0, 160), url: `/messages/${t.id}`, tag: `chat-${t.id}` });
  }
  broadcast(t, { t: 'chat', threadId: t.id });
  return id;
}

/** Message posté automatiquement dans la discussion de l'équipe (ex. : une offre de covoiturage). */
export function postToTeam(teamId, user, kind, body, data) {
  return insertMessage(ensureTeamThread(teamId), user, kind, body, data);
}

socialApi.post('/chat/threads/:id/messages', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  const kind = String(req.body.kind || 'text');
  needIn(req.user, t, 'send');
  if (kind !== 'text') needIn(req.user, t, 'media');
  const d = req.body.data || {};
  let data = {};
  let body = str(req.body.body, 4000);
  if (kind === 'text') {
    if (!body) throw new HttpError(400, 'Message vide');
  } else if (kind === 'poll') {
    const options = (Array.isArray(d.options) ? d.options : []).map((o) => str(typeof o === 'string' ? o : o?.label, 80)).filter(Boolean).slice(0, 8);
    if (!str(d.question, 200) || options.length < 2) throw new HttpError(400, 'Une question et deux réponses minimum');
    data = { question: str(d.question, 200), multi: !!d.multi, options: options.map((label) => ({ id: newId(6), label })) };
  } else if (kind === 'tasks') {
    const items = (Array.isArray(d.items) ? d.items : []).map((x) => str(typeof x === 'string' ? x : x?.label, 80)).filter(Boolean).slice(0, 12);
    if (!items.length) throw new HttpError(400, 'Ajoutez au moins une chose à apporter');
    data = { title: str(d.title, 120) || 'Qui apporte quoi ?', date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : null, items: items.map((label) => ({ id: newId(6), label })) };
  } else if (kind === 'match') {
    const o = occ(String(d.eventId || ''), String(d.date || ''));
    needTeam(req.user, o.e.teamId);
    data = { eventId: o.e.id, date: o.date };
  } else if (kind === 'location') {
    if (!str(d.label, 120)) throw new HttpError(400, 'Lieu manquant');
    data = { label: str(d.label, 120), address: str(d.address, 200) };
  } else if (kind === 'carpool') {
    throw new HttpError(400, 'Utilisez le covoiturage du match');
  } else throw new HttpError(400, 'Type de message inconnu');
  const id = insertMessage(t, req.user, kind, body, data);
  res.json(enrich(get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', id), req.user));
});

function decodeImage(dataUrl, maxBytes) {
  const m = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Image invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, 'Image trop lourde');
  return buf;
}

socialApi.post('/chat/threads/:id/image', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  needIn(req.user, t, 'send');
  needIn(req.user, t, 'media');
  const buf = decodeImage(req.body.image, 5_000_000);
  const file = newId();
  writeFileSync(join(UPLOADS, `chat_${file}.jpg`), buf);
  const id = insertMessage(t, req.user, 'image', str(req.body.caption, 500), { file, w: Number(req.body.width) || 1, h: Number(req.body.height) || 1 });
  res.json(enrich(get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', id), req.user));
});

socialApi.get('/chat/images/:msgId', (req, res) => {
  const m = get('SELECT * FROM chat_messages WHERE id = ?', req.params.msgId);
  if (!m || m.kind !== 'image' || (m.deleted && !seesDeleted(req.user))) throw new HttpError(404, 'Image introuvable');
  threadAccess(req.user, m.thread_id);
  const file = join(UPLOADS, `chat_${JSON.parse(m.data).file}.jpg`);
  if (!existsSync(file)) throw new HttpError(404, 'Image introuvable');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('jpeg').sendFile(file);
});

socialApi.post('/chat/threads/:id/read', (req, res) => {
  const t = threadAccess(req.user, req.params.id);
  const before = lastRead(t.id, req.user.id);
  const fresh = get('SELECT 1 FROM chat_messages WHERE thread_id = ? AND created_at > ? AND (user_id IS NULL OR user_id != ?) LIMIT 1', t.id, before, req.user.id);
  markRead(t.id, req.user.id);
  // Accusé de lecture diffusé seulement s'il y avait vraiment du nouveau (pas de ping-pong entre onglets).
  if (fresh) broadcast(t, { t: 'chat-read', threadId: t.id }, req.user.id);
  res.json({ ok: true, fresh: !!fresh });
});

function messageAccess(user, id) {
  const m = get('SELECT * FROM chat_messages WHERE id = ?', id);
  if (!m || m.deleted) throw new HttpError(404, 'Message introuvable');
  return { m, t: threadAccess(user, m.thread_id) };
}

const refresh = (m, t, user) => {
  broadcast(t, { t: 'chat', threadId: t.id, messageId: m.id }, user.id);
  return enrich(get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', m.id), user);
};

socialApi.post('/chat/messages/:id/react', (req, res) => {
  const { m, t } = messageAccess(req.user, req.params.id);
  needIn(req.user, t, 'react');
  const emoji = REACTIONS.includes(req.body.emoji) ? req.body.emoji : null;
  const cur = get('SELECT emoji FROM chat_reactions WHERE msg_id = ? AND user_id = ?', m.id, req.user.id);
  if (!emoji || cur?.emoji === emoji) run('DELETE FROM chat_reactions WHERE msg_id = ? AND user_id = ?', m.id, req.user.id);
  else run('INSERT INTO chat_reactions VALUES (?, ?, ?) ON CONFLICT(msg_id, user_id) DO UPDATE SET emoji = excluded.emoji', m.id, req.user.id, emoji);
  res.json(refresh(m, t, req.user));
});

socialApi.post('/chat/messages/:id/vote', (req, res) => {
  const { m, t } = messageAccess(req.user, req.params.id);
  if (m.kind !== 'poll') throw new HttpError(400, 'Ce message n’est pas un sondage');
  const d = JSON.parse(m.data);
  const opt = String(req.body.optionId || '');
  if (!d.options.some((o) => o.id === opt)) throw new HttpError(400, 'Réponse inconnue');
  const had = get('SELECT 1 FROM chat_votes WHERE msg_id = ? AND user_id = ? AND option_id = ?', m.id, req.user.id, opt);
  tx(() => {
    if (!d.multi) run('DELETE FROM chat_votes WHERE msg_id = ? AND user_id = ?', m.id, req.user.id);
    if (had) run('DELETE FROM chat_votes WHERE msg_id = ? AND user_id = ? AND option_id = ?', m.id, req.user.id, opt);
    else run('INSERT INTO chat_votes VALUES (?, ?, ?)', m.id, req.user.id, opt);
  });
  res.json(refresh(m, t, req.user));
});

socialApi.post('/chat/messages/:id/claim', (req, res) => {
  const { m, t } = messageAccess(req.user, req.params.id);
  if (m.kind !== 'tasks') throw new HttpError(400, 'Ce message n’est pas une liste');
  const item = String(req.body.itemId || '');
  if (!JSON.parse(m.data).items.some((i) => i.id === item)) throw new HttpError(400, 'Élément inconnu');
  const cur = get('SELECT user_id FROM chat_claims WHERE msg_id = ? AND item_id = ?', m.id, item);
  if (cur && cur.user_id !== req.user.id) throw new HttpError(409, 'Déjà pris par quelqu’un d’autre');
  if (cur) run('DELETE FROM chat_claims WHERE msg_id = ? AND item_id = ?', m.id, item);
  else run('INSERT INTO chat_claims VALUES (?, ?, ?)', m.id, item, req.user.id);
  res.json(refresh(m, t, req.user));
});

socialApi.delete('/chat/messages/:id', (req, res) => {
  const { m, t } = messageAccess(req.user, req.params.id);
  if (m.user_id !== req.user.id && !canIn(req.user, t, 'manage')) throw new HttpError(403, 'Action non autorisée');
  run('UPDATE chat_messages SET deleted = 1 WHERE id = ?', m.id);
  broadcast(t, { t: 'chat', threadId: t.id });
  res.json({ ok: true });
});
