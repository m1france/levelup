/**
 * Vie d'équipe : covoiturage par match, messagerie (discussions d'équipe, messages privés,
 * cartes interactives : covoiturage, sondage, « qui apporte quoi », match, lieu) et annonces du club
 * avec accusé de lecture.
 */
import { Router } from 'express';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, tx, UPLOADS } from './db.js';
import { can, need, needTeam, isStaff, childIdsFor, teamIdsFor, permsFor, newId, HttpError } from './auth.js';

const asUser = (u) => ({ ...u, perms: new Set(permsFor(u.role)) });
import { occ, evTitle, teamPlayers, parentsOf, staffOf, convOf } from './convocations.js';
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

/** Enfants que l'utilisateur peut inscrire : les siens (parent) ou toute l'équipe (éducateur). */
function bookableKids(user, teamId) {
  const players = teamPlayers(teamId);
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
    eventId: o.e.id, date: o.date, title: evTitle(o.e), time: o.e.time, meetTime: o.data.meetTime || o.e.meetTime || '', location: o.e.location,
    offers, requests, free, needs: requests.filter((r) => !r.solved).length,
    kids: bookableKids(user, o.e.teamId).map((p) => ({ id: p.id, firstName: p.firstName, booked: booked.has(p.id) })),
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
    const kid = bookableKids(req.user, o.e.teamId).find((p) => p.id === req.body.playerId);
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
  const kid = bookableKids(req.user, o.e.teamId).find((p) => p.id === req.body.playerId);
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

function ensureTeamThread(teamId) {
  let t = get(`SELECT * FROM chat_threads WHERE kind = 'team' AND team_id = ?`, teamId);
  if (!t) {
    const id = newId();
    run(`INSERT INTO chat_threads VALUES (?, 'team', ?, '', NULL, ?, ?)`, id, teamId, now(), now());
    t = get('SELECT * FROM chat_threads WHERE id = ?', id);
  }
  return t;
}

function ensureStaffThread() {
  let t = get(`SELECT * FROM chat_threads WHERE kind = 'staff'`);
  if (!t) {
    const id = newId();
    run(`INSERT INTO chat_threads VALUES (?, 'staff', NULL, 'Éducateurs du club', NULL, ?, ?)`, id, now(), now());
    t = get('SELECT * FROM chat_threads WHERE id = ?', id);
  }
  return t;
}

function memberIds(t) {
  if (t.kind === 'team') return teamMemberIds(t.team_id);
  if (t.kind === 'staff') return all(`SELECT id FROM users WHERE role != 'parent' AND status = 'active'`).map((u) => u.id);
  return all('SELECT user_id FROM chat_members WHERE thread_id = ?', t.id).map((r) => r.user_id);
}

function threadAccess(user, id) {
  const t = get('SELECT * FROM chat_threads WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Discussion introuvable');
  const ok = t.kind === 'team' ? teamIdsFor(user).includes(t.team_id) : t.kind === 'staff' ? isStaff(user) : !!get('SELECT 1 FROM chat_members WHERE thread_id = ? AND user_id = ?', t.id, user.id);
  if (!ok) throw new HttpError(404, 'Discussion introuvable');
  return t;
}

const lastRead = (threadId, userId) => get('SELECT last_read_at FROM chat_members WHERE thread_id = ? AND user_id = ?', threadId, userId)?.last_read_at ?? 0;

function markRead(threadId, userId, at = now()) {
  run(
    `INSERT INTO chat_members VALUES (?, ?, ?) ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
    threadId, userId, at,
  );
}

function preview(m) {
  if (m.deleted) return 'Message supprimé';
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
  const other = all('SELECT u.id, u.name, u.role FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.user_id != ?', t.id, user.id)[0];
  return { title: other?.name ?? 'Discussion', color: null, category: null, otherId: other?.id ?? null, otherRole: other?.role ?? null };
}

function threadSummary(t, user) {
  const last = get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? ORDER BY m.created_at DESC LIMIT 1', t.id);
  const read = lastRead(t.id, user.id);
  const unread = get('SELECT COUNT(*) n FROM chat_messages WHERE thread_id = ? AND created_at > ? AND (user_id IS NULL OR user_id != ?) AND deleted = 0', t.id, read, user.id).n;
  return {
    id: t.id, kind: t.kind, teamId: t.team_id, ...threadTitle(t, user), unread,
    last: last ? { preview: preview(last), author: last.author, mine: last.user_id === user.id, at: last.created_at } : null,
    updatedAt: last?.created_at ?? t.created_at,
  };
}

function userThreads(user) {
  const list = teamIdsFor(user).map(ensureTeamThread);
  if (isStaff(user)) list.push(ensureStaffThread());
  list.push(...all(`SELECT t.* FROM chat_threads t JOIN chat_members m ON m.thread_id = t.id WHERE t.kind = 'direct' AND m.user_id = ?`, user.id));
  return list;
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
  if (existing) return res.json({ id: existing.id });
  const id = newId();
  tx(() => {
    run(`INSERT INTO chat_threads VALUES (?, 'direct', NULL, '', ?, ?, ?)`, id, req.user.id, now(), now());
    run('INSERT INTO chat_members VALUES (?, ?, ?)', id, req.user.id, now());
    run('INSERT INTO chat_members VALUES (?, ?, 0)', id, other);
  });
  res.json({ id });
});

const REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓', '⚽', '👏'];

function enrich(m, user) {
  const d = JSON.parse(m.data || '{}');
  const base = {
    id: m.id, threadId: m.thread_id, userId: m.user_id, author: m.author ?? null, mine: m.user_id === user.id, kind: m.deleted ? 'deleted' : m.kind,
    body: m.deleted ? '' : m.body, at: m.created_at,
    reactions: all('SELECT r.emoji, r.user_id, u.name FROM chat_reactions r JOIN users u ON u.id = r.user_id WHERE msg_id = ?', m.id).map((r) => ({ emoji: r.emoji, mine: r.user_id === user.id, name: r.name })),
  };
  if (m.deleted) return base;
  try {
    if (m.kind === 'carpool') {
      const cp = carpoolView(occ(d.eventId, d.date), user);
      const offer = d.offerId ? cp.offers.find((x) => x.id === d.offerId) ?? null : null;
      const request = d.requestId ? cp.requests.find((x) => x.id === d.requestId) ?? null : null;
      return { ...base, data: { eventId: d.eventId, date: d.date, title: cp.title, time: cp.time, location: cp.location, offer, request, kids: cp.kids, gone: !offer && !request } };
    }
    if (m.kind === 'match') {
      const o = occ(d.eventId, d.date);
      return { ...base, data: { eventId: o.e.id, date: o.date, title: evTitle(o.e), time: o.e.time, meetTime: o.data.meetTime || o.e.meetTime, location: o.e.location, venue: o.e.venue, type: o.e.type } };
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
    `SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT 60`,
    t.id, before,
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
  const buf = decodeImage(req.body.image, 5_000_000);
  const file = newId();
  writeFileSync(join(UPLOADS, `chat_${file}.jpg`), buf);
  const id = insertMessage(t, req.user, 'image', str(req.body.caption, 500), { file, w: Number(req.body.width) || 1, h: Number(req.body.height) || 1 });
  res.json(enrich(get('SELECT m.*, u.name author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', id), req.user));
});

socialApi.get('/chat/images/:msgId', (req, res) => {
  const m = get('SELECT * FROM chat_messages WHERE id = ?', req.params.msgId);
  if (!m || m.kind !== 'image' || m.deleted) throw new HttpError(404, 'Image introuvable');
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
  if (m.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Action non autorisée');
  run('UPDATE chat_messages SET deleted = 1 WHERE id = ?', m.id);
  broadcast(t, { t: 'chat', threadId: t.id });
  res.json({ ok: true });
});

/* ================================================================== annonces du club */

function audience(user, body) {
  const allowed = teamIdsFor(user);
  let teams = Array.isArray(body.teamIds) ? body.teamIds.filter((id) => allowed.includes(id)) : [];
  if (!teams.length) {
    if (!can(user, 'club.dashboard') && user.role !== 'admin') throw new HttpError(400, 'Choisissez au moins une équipe');
    teams = allowed;
  }
  const roles = (Array.isArray(body.roles) ? body.roles : ['parent', 'coach']).filter((r) => ['parent', 'coach'].includes(r));
  if (!roles.length) throw new HttpError(400, 'Choisissez les destinataires');
  const ids = new Set();
  for (const teamId of teams) {
    if (roles.includes('coach')) staffOf(teamId).forEach((id) => ids.add(id));
    if (roles.includes('parent')) for (const p of teamPlayers(teamId)) parentsOf(p.id).forEach((u) => ids.add(u.id));
  }
  ids.delete(user.id);
  return { teams, roles, ids: [...ids] };
}

function annOut(a, user) {
  const d = JSON.parse(a.data || '{}');
  const t = get('SELECT read_at FROM announcement_targets WHERE ann_id = ? AND user_id = ?', a.id, user.id);
  const stats = get('SELECT COUNT(*) total, COUNT(read_at) read FROM announcement_targets WHERE ann_id = ?', a.id);
  const teams = (d.teams || []).map((id) => get('SELECT id, category, color FROM teams WHERE id = ?', id)).filter(Boolean);
  return {
    id: a.id, title: a.title, body: a.body, important: !!d.important, emoji: d.emoji || '📣', teams, roles: d.roles || [], createdAt: a.created_at,
    author: { id: a.author_id, name: a.author_id ? userName(a.author_id) : 'Le club' }, mine: a.author_id === user.id,
    target: !!t, read: !!t?.read_at, stats: a.author_id === user.id || can(user, 'club.dashboard') || user.role === 'admin' ? stats : null,
  };
}

socialApi.get('/announcements', (req, res) => {
  const u = req.user;
  const seeAll = can(u, 'club.dashboard') || u.role === 'admin';
  const rows = all(
    `SELECT DISTINCT a.* FROM announcements a LEFT JOIN announcement_targets t ON t.ann_id = a.id
     WHERE t.user_id = ? OR a.author_id = ? ${seeAll ? 'OR 1 = 1' : ''} ORDER BY a.created_at DESC LIMIT 60`,
    u.id, u.id,
  );
  res.json(rows.map((a) => annOut(a, u)));
});

socialApi.post('/announcements', (req, res) => {
  need(req.user, 'announcements.send');
  const title = str(req.body.title, 140);
  const body = str(req.body.body, 4000);
  if (!title || !body) throw new HttpError(400, 'Titre et message requis');
  const { teams, roles, ids } = audience(req.user, req.body);
  const emoji = str(req.body.emoji, 8) || '📣';
  const id = newId();
  tx(() => {
    run('INSERT INTO announcements VALUES (?, ?, ?, ?, ?, ?)', id, req.user.id, title, body, JSON.stringify({ teams, roles, important: !!req.body.important, emoji }), now());
    for (const uid of ids) run('INSERT INTO announcement_targets VALUES (?, ?, NULL)', id, uid);
  });
  notify(ids, { kind: 'announcement', title: `${emoji} ${title}`, body: body.slice(0, 200), url: `/annonces/${id}` });
  res.json(annOut(get('SELECT * FROM announcements WHERE id = ?', id), req.user));
});

socialApi.get('/announcements/:id', (req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', req.params.id);
  if (!a) throw new HttpError(404, 'Annonce introuvable');
  const out = annOut(a, req.user);
  if (!out.target && !out.mine && !out.stats) throw new HttpError(404, 'Annonce introuvable');
  const recipients = out.stats
    ? all(
        `SELECT t.user_id, t.read_at, u.name, u.role FROM announcement_targets t JOIN users u ON u.id = t.user_id WHERE ann_id = ? ORDER BY t.read_at IS NULL, u.name`,
        a.id,
      ).map((r) => ({
        id: r.user_id, name: r.name, role: r.role, readAt: r.read_at,
        kids: all('SELECT p.data FROM player_parents pp JOIN players p ON p.id = pp.player_id WHERE pp.user_id = ?', r.user_id).map((p) => JSON.parse(p.data).firstName),
      }))
    : null;
  res.json({ ...out, recipients });
});

socialApi.post('/announcements/:id/read', (req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', req.params.id);
  if (!a) throw new HttpError(404, 'Annonce introuvable');
  run('UPDATE announcement_targets SET read_at = ? WHERE ann_id = ? AND user_id = ? AND read_at IS NULL', now(), a.id, req.user.id);
  if (a.author_id) toUsers([a.author_id], { t: 'announcement', id: a.id });
  res.json({ ok: true });
});

socialApi.post('/announcements/:id/remind', (req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', req.params.id);
  if (!a) throw new HttpError(404, 'Annonce introuvable');
  if (a.author_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Action non autorisée');
  const ids = all('SELECT user_id FROM announcement_targets WHERE ann_id = ? AND read_at IS NULL', a.id).map((r) => r.user_id);
  const emoji = JSON.parse(a.data || '{}').emoji || '📣';
  notify(ids, { kind: 'announcement', title: `Rappel : ${emoji} ${a.title}`, body: a.body.slice(0, 200), url: `/annonces/${a.id}` });
  res.json({ sent: ids.length });
});

socialApi.delete('/announcements/:id', (req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', req.params.id);
  if (!a) return res.json({ ok: true });
  if (a.author_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Action non autorisée');
  run('DELETE FROM announcements WHERE id = ?', a.id);
  res.json({ ok: true });
});

