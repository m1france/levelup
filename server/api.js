import { Router } from 'express';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, tx, parse, UPLOADS } from './db.js';
import {
  ROLES, PERMISSIONS, permsFor, setRolePerms, newId, hashPassword, checkPassword,
  startSession, endSession, requireUser, can, need, needTeam, teamIdsFor, isStaff,
  childIdsFor, HttpError,
} from './auth.js';
import { seedStarterLibrary, seedDemoTeam } from './demo.js';
import { openStream, clientOf, setWatch, toRoom, toTeam, toTeamAndRoom, refreshTeams } from './live.js';

export const api = Router();

const now = () => Date.now();
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const checkId = (id) => {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide');
  return id;
};
const INVITE_DAYS = 30;
/** Onglet à l'origine de la requête : il ne reçoit pas l'écho de sa propre modification. */
const origin = (req) => String(req.get('X-Client-Id') || '') || null;

/* ------------------------------------------------------------------ setup & auth */

api.get('/bootstrap', (req, res) => {
  const club = get('SELECT name FROM club WHERE id = 1');
  res.json({ setupNeeded: !club, clubName: club?.name ?? null, signedIn: !!req.user });
});

api.post('/setup', (req, res) => {
  if (get('SELECT id FROM club WHERE id = 1')) throw new HttpError(409, 'Le club est déjà configuré');
  const clubName = str(req.body.clubName, 120);
  const name = str(req.body.name, 120);
  const email = str(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  if (!clubName || !name || !email.includes('@')) throw new HttpError(400, 'Champs manquants');
  if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum');
  const id = newId();
  tx(() => {
    run('INSERT INTO club VALUES (1, ?, ?)', clubName, now());
    run(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, 'admin', 'active', ?)`,
      id, email, name, hashPassword(password), now(),
    );
    seedStarterLibrary();
    if (req.body.demo) seedDemoTeam(id);
  });
  startSession(res, id);
  res.json({ ok: true });
});

const attempts = new Map();
api.post('/login', (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const key = `${req.ip}|${email}`;
  const a = attempts.get(key) || { n: 0, t: now() };
  if (now() - a.t > 10 * 60e3) Object.assign(a, { n: 0, t: now() });
  if (a.n >= 10) throw new HttpError(429, 'Trop de tentatives, réessayez dans quelques minutes');
  const user = get('SELECT id, password_hash, status FROM users WHERE email = ?', email);
  if (!user || user.status !== 'active' || !checkPassword(String(req.body.password || ''), user.password_hash)) {
    a.n++;
    attempts.set(key, a);
    throw new HttpError(401, 'E-mail ou mot de passe incorrect');
  }
  attempts.delete(key);
  startSession(res, user.id);
  res.json({ ok: true });
});

api.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

const clubName = () => get('SELECT name FROM club WHERE id = 1')?.name;
const teamInfo = (id) => (id ? get('SELECT id, category, color FROM teams WHERE id = ?', id) ?? null : null);
const userName = (id) => (id ? get('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);

/** Invitation personnelle (un membre précis) ou lien partageable (rôle + équipe prédéfinis). */
function findInvite(token) {
  const personal = get(
    `SELECT i.user_id, i.invited_by, u.name, u.email, u.role FROM invites i JOIN users u ON u.id = i.user_id
     WHERE i.token = ? AND i.expires_at > ?`,
    token, now(),
  );
  if (personal) return { kind: 'personal', ...personal };
  const link = get('SELECT * FROM invite_links WHERE token = ? AND expires_at > ?', token, now());
  if (link) return { kind: 'link', ...link };
  throw new HttpError(404, "Cette invitation n'est plus valide");
}

api.get('/invites/:token', (req, res) => {
  const inv = findInvite(req.params.token);
  if (inv.kind === 'personal') {
    const teams = inv.role === 'parent'
      ? all('SELECT DISTINCT t.id, t.category, t.color FROM player_parents pp JOIN players p ON p.id = pp.player_id JOIN teams t ON t.id = p.team_id WHERE pp.user_id = ?', inv.user_id)
      : all('SELECT t.id, t.category, t.color FROM team_staff s JOIN teams t ON t.id = s.team_id WHERE s.user_id = ?', inv.user_id);
    return res.json({
      kind: 'personal', name: inv.name, email: inv.email, role: inv.role, teams,
      invitedBy: userName(inv.invited_by), clubName: clubName(),
    });
  }
  const team = teamInfo(inv.team_id);
  // Pour un lien « parent », la personne choisit son enfant dans l'effectif de l'équipe.
  const players = inv.role === 'parent' && team
    ? all('SELECT id, data FROM players WHERE team_id = ?', team.id)
        .map(parse)
        .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName ? `${p.lastName[0]}.` : '' }))
        .sort((a, b) => a.firstName.localeCompare(b.firstName))
    : [];
  res.json({
    kind: 'link', role: inv.role, teams: team ? [team] : [], players,
    invitedBy: userName(inv.created_by), clubName: clubName(),
  });
});

api.post('/invites/:token', (req, res) => {
  const inv = findInvite(req.params.token);
  const password = String(req.body.password || '');
  if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum');
  const name = str(req.body.name, 120);
  if (inv.kind === 'personal') {
    tx(() => {
      run(
        `UPDATE users SET password_hash = ?, status = 'active', name = COALESCE(NULLIF(?, ''), name) WHERE id = ?`,
        hashPassword(password), name, inv.user_id,
      );
      run('DELETE FROM invites WHERE user_id = ?', inv.user_id);
    });
    startSession(res, inv.user_id);
    return res.json({ ok: true });
  }
  const email = str(req.body.email, 200).toLowerCase();
  if (!name || !email.includes('@')) throw new HttpError(400, 'Nom et e-mail requis');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Cet e-mail est déjà utilisé');
  let playerIds = [];
  if (inv.role === 'parent') {
    const wanted = new Set(Array.isArray(req.body.playerIds) ? req.body.playerIds : []);
    playerIds = all('SELECT id FROM players WHERE team_id = ?', inv.team_id).map((r) => r.id).filter((id) => wanted.has(id));
    if (!playerIds.length) throw new HttpError(400, 'Choisissez au moins un joueur');
  }
  const id = newId();
  tx(() => {
    run(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      id, email, name, hashPassword(password), inv.role, now(),
    );
    assignLinks(id, inv.role, inv.team_id ? [inv.team_id] : [], playerIds);
    run('UPDATE invite_links SET uses = uses + 1 WHERE token = ?', inv.token);
  });
  startSession(res, id);
  res.json({ ok: true });
});

/* Tout ce qui suit nécessite d'être connecté, sauf le lien public de séance. */

api.get('/public/trainings/:token', (req, res) => {
  const row = get('SELECT * FROM trainings WHERE share_token = ?', req.params.token);
  if (!row) throw new HttpError(404, "Ce lien n'est plus actif");
  res.json(trainingPayload(row, { sanitize: true }));
});

api.use(requireUser);

api.get('/me', (req, res) => {
  const u = req.user;
  const club = get('SELECT name FROM club WHERE id = 1');
  const children = u.role === 'parent'
    ? all(
        `SELECT p.id, p.team_id, p.data FROM player_parents pp JOIN players p ON p.id = pp.player_id WHERE pp.user_id = ?`,
        u.id,
      ).map((r) => ({ ...parse(r), teamId: r.team_id, level: undefined }))
    : [];
  res.json({
    user: { id: u.id, name: u.name, email: u.email, role: u.role },
    perms: [...permsFor(u.role)],
    club,
    teams: listTeams(u),
    children,
  });
});

api.patch('/me', (req, res) => {
  const name = str(req.body.name, 120);
  if (name) run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
  if (req.body.newPassword) {
    const row = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!checkPassword(String(req.body.currentPassword || ''), row.password_hash)) {
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    }
    if (String(req.body.newPassword).length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(req.body.newPassword)), req.user.id);
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ club, membres, permissions */

api.patch('/club', (req, res) => {
  if (req.user.role !== 'admin') throw new HttpError(403, "Réservé à l'administrateur");
  const name = str(req.body.name, 120);
  if (name) run('UPDATE club SET name = ? WHERE id = 1', name);
  res.json({ ok: true });
});

api.get('/permissions', (req, res) => {
  const roles = {};
  for (const r of ROLES.filter((r) => r !== 'admin')) roles[r] = permsFor(r);
  res.json({ catalog: PERMISSIONS.map(({ defaults, ...p }) => p), roles });
});

api.put('/permissions', (req, res) => {
  if (req.user.role !== 'admin') throw new HttpError(403, "Réservé à l'administrateur");
  tx(() => {
    for (const r of ROLES.filter((r) => r !== 'admin')) {
      if (Array.isArray(req.body.roles?.[r])) setRolePerms(r, req.body.roles[r]);
    }
  });
  res.json({ ok: true });
});

function userRow(u) {
  const invite = u.status === 'invited'
    ? get('SELECT token, expires_at FROM invites WHERE user_id = ? ORDER BY expires_at DESC', u.id)
    : null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    teamIds: all('SELECT team_id FROM team_staff WHERE user_id = ?', u.id).map((r) => r.team_id),
    playerIds: all('SELECT player_id FROM player_parents WHERE user_id = ?', u.id).map((r) => r.player_id),
    inviteToken: invite && invite.expires_at > now() ? invite.token : null,
  };
}

api.get('/users', (req, res) => {
  need(req.user, 'members.manage');
  res.json(all('SELECT * FROM users ORDER BY role = ? DESC, name COLLATE NOCASE', 'admin').map(userRow));
});

/** Liste légère des éducateurs (pour les affecter à une équipe). */
api.get('/staff', (req, res) => {
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  res.json(all(`SELECT id, name, role FROM users WHERE role != 'parent' AND status != 'disabled' ORDER BY name`));
});

function assignLinks(userId, role, teamIds, playerIds) {
  run('DELETE FROM team_staff WHERE user_id = ?', userId);
  run('DELETE FROM player_parents WHERE user_id = ?', userId);
  if (role !== 'parent') {
    for (const t of teamIds || []) if (get('SELECT id FROM teams WHERE id = ?', t)) run('INSERT INTO team_staff VALUES (?, ?)', t, userId);
  } else {
    for (const p of playerIds || []) if (get('SELECT id FROM players WHERE id = ?', p)) run('INSERT INTO player_parents VALUES (?, ?)', p, userId);
  }
}

function createInvite(userId, invitedBy) {
  const token = newId(24);
  run('DELETE FROM invites WHERE user_id = ?', userId);
  run(
    'INSERT INTO invites (token, user_id, expires_at, invited_by) VALUES (?, ?, ?, ?)',
    token, userId, now() + INVITE_DAYS * 864e5, invitedBy,
  );
  return token;
}

api.post('/users', (req, res) => {
  need(req.user, 'members.manage');
  const role = req.body.role;
  if (!ROLES.includes(role) || role === 'admin') throw new HttpError(400, 'Rôle invalide');
  const email = str(req.body.email, 200).toLowerCase();
  const name = str(req.body.name, 120);
  if (!name || !email.includes('@')) throw new HttpError(400, 'Nom et e-mail requis');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Cet e-mail est déjà utilisé');
  const id = newId();
  tx(() => {
    run(`INSERT INTO users (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, 'invited', ?)`, id, email, name, role, now());
    assignLinks(id, role, req.body.teamIds, req.body.playerIds);
    createInvite(id, req.user.id);
  });
  res.json(userRow(get('SELECT * FROM users WHERE id = ?', id)));
});

api.patch('/users/:id', (req, res) => {
  need(req.user, 'members.manage');
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw new HttpError(404, 'Membre introuvable');
  if (u.role === 'admin' && req.user.role !== 'admin') throw new HttpError(403, "L'administrateur ne peut pas être modifié");
  const role = u.role === 'admin' ? 'admin' : req.body.role ?? u.role;
  if (!ROLES.includes(role) || (role === 'admin' && u.role !== 'admin')) throw new HttpError(400, 'Rôle invalide');
  const name = str(req.body.name, 120) || u.name;
  let status = u.status;
  if (req.body.status === 'disabled' && u.role !== 'admin') status = 'disabled';
  if (req.body.status === 'active' && u.status === 'disabled') status = u.password_hash ? 'active' : 'invited';
  tx(() => {
    run('UPDATE users SET role = ?, name = ?, status = ? WHERE id = ?', role, name, status, u.id);
    if (status === 'disabled') run('DELETE FROM auth_sessions WHERE user_id = ?', u.id);
    if (req.body.teamIds || req.body.playerIds || role !== u.role) {
      const cur = userRow(u);
      assignLinks(u.id, role, req.body.teamIds ?? cur.teamIds, req.body.playerIds ?? cur.playerIds);
    }
  });
  refreshTeams([u.id]);
  res.json(userRow(get('SELECT * FROM users WHERE id = ?', u.id)));
});

api.post('/users/:id/invite', (req, res) => {
  need(req.user, 'members.manage');
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u || u.status !== 'invited') throw new HttpError(400, 'Ce membre a déjà activé son compte');
  createInvite(u.id, req.user.id);
  res.json(userRow(u));
});

/* Liens d'invitation partageables : chaque personne qui s'inscrit reçoit le rôle et l'équipe prévus. */

const linkRow = (l) => ({
  token: l.token,
  role: l.role,
  teamId: l.team_id,
  createdBy: userName(l.created_by),
  uses: l.uses,
  expiresAt: l.expires_at,
});

api.get('/invite-links', (req, res) => {
  need(req.user, 'members.manage');
  res.json(all('SELECT * FROM invite_links WHERE expires_at > ? ORDER BY created_at DESC', now()).map(linkRow));
});

api.post('/invite-links', (req, res) => {
  need(req.user, 'members.manage');
  const role = req.body.role;
  if (!ROLES.includes(role) || role === 'admin') throw new HttpError(400, 'Rôle invalide');
  const teamId = req.body.teamId || null;
  if (teamId && !get('SELECT id FROM teams WHERE id = ?', teamId)) throw new HttpError(400, 'Équipe introuvable');
  if (role === 'parent' && !teamId) throw new HttpError(400, 'Choisissez l’équipe des joueurs');
  const token = newId(24);
  run(
    'INSERT INTO invite_links (token, role, team_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    token, role, teamId, req.user.id, now(), now() + INVITE_DAYS * 864e5,
  );
  res.json(linkRow(get('SELECT * FROM invite_links WHERE token = ?', token)));
});

api.delete('/invite-links/:token', (req, res) => {
  need(req.user, 'members.manage');
  run('DELETE FROM invite_links WHERE token = ?', req.params.token);
  res.json({ ok: true });
});

api.delete('/users/:id', (req, res) => {
  need(req.user, 'members.manage');
  const u = get('SELECT role FROM users WHERE id = ?', req.params.id);
  if (!u) throw new HttpError(404, 'Membre introuvable');
  if (u.role === 'admin' || req.params.id === req.user.id) throw new HttpError(400, 'Impossible de supprimer ce compte');
  run('DELETE FROM users WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ équipes */

function listTeams(user) {
  const ids = teamIdsFor(user);
  if (!ids.length) return [];
  return all(`SELECT * FROM teams WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY category, name`, ...ids).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    season: t.season,
    color: t.color,
    staff: all(
      'SELECT u.id, u.name FROM team_staff s JOIN users u ON u.id = s.user_id WHERE s.team_id = ? ORDER BY u.name',
      t.id,
    ),
    playerCount: get('SELECT COUNT(*) n FROM players WHERE team_id = ?', t.id).n,
  }));
}

api.get('/teams', (req, res) => res.json(listTeams(req.user)));

api.put('/teams/:id', (req, res) => {
  need(req.user, 'teams.manage');
  const id = checkId(req.params.id);
  // La catégorie choisie sert de nom à l'équipe.
  const category = str(req.body.category, 40);
  const name = category;
  if (!category) throw new HttpError(400, 'Catégorie requise');
  const exists = get('SELECT id FROM teams WHERE id = ?', id);
  if (exists && !teamIdsFor(req.user).includes(id)) throw new HttpError(404, 'Équipe introuvable');
  tx(() => {
    if (exists) {
      run('UPDATE teams SET name = ?, category = ?, season = ?, color = ? WHERE id = ?', name, category, str(req.body.season, 20), str(req.body.color, 20) || '#1f6f4a', id);
    } else {
      run('INSERT INTO teams VALUES (?, ?, ?, ?, ?, ?)', id, name, category, str(req.body.season, 20), str(req.body.color, 20) || '#1f6f4a', now());
      if (req.user.role !== 'admin' && !can(req.user, 'teams.all')) run('INSERT INTO team_staff VALUES (?, ?)', id, req.user.id);
    }
    if (Array.isArray(req.body.staffIds)) {
      run('DELETE FROM team_staff WHERE team_id = ?', id);
      for (const u of req.body.staffIds) {
        if (get(`SELECT id FROM users WHERE id = ? AND role != 'parent'`, u)) run('INSERT OR IGNORE INTO team_staff VALUES (?, ?)', id, u);
      }
    }
  });
  refreshTeams();
  res.json(listTeams(req.user).find((t) => t.id === id) ?? null);
});

api.delete('/teams/:id', (req, res) => {
  need(req.user, 'teams.manage');
  needTeam(req.user, req.params.id);
  run('DELETE FROM teams WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ joueurs & pages joueurs */

function playerOut(row, user) {
  const p = { ...parse(row), teamId: row.team_id, updatedAt: row.updated_at };
  if (!isStaff(user)) delete p.level;
  return p;
}

function playerAccess(user, playerId) {
  const row = get('SELECT * FROM players WHERE id = ?', playerId);
  if (!row) throw new HttpError(404, 'Joueur introuvable');
  if (isStaff(user)) needTeam(user, row.team_id);
  else if (!childIdsFor(user).includes(playerId)) throw new HttpError(404, 'Joueur introuvable');
  return row;
}

api.get('/teams/:teamId/players', (req, res) => {
  needTeam(req.user, req.params.teamId);
  let rows = all('SELECT * FROM players WHERE team_id = ?', req.params.teamId);
  if (!isStaff(req.user)) {
    const kids = childIdsFor(req.user);
    rows = rows.filter((r) => kids.includes(r.id));
  }
  const players = rows.map((r) => playerOut(r, req.user));
  players.sort((a, b) => (a.firstName || '').localeCompare(b.firstName || '', 'fr'));
  res.json(players);
});

api.get('/players/:id', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  const u = req.user;
  let notes = [];
  if (isStaff(u) && can(u, 'notes.view')) {
    notes = all(
      `SELECT n.*, u.name author_name FROM player_notes n LEFT JOIN users u ON u.id = n.author_id WHERE player_id = ? ORDER BY created_at DESC`,
      row.id,
    );
  } else if (!isStaff(u)) {
    notes = all(
      `SELECT n.*, u.name author_name FROM player_notes n LEFT JOIN users u ON u.id = n.author_id WHERE player_id = ? AND visibility = 'parents' ORDER BY created_at DESC`,
      row.id,
    );
  }
  const trainings = all('SELECT id, date, data FROM trainings WHERE team_id = ? ORDER BY date DESC', row.team_id)
    .map((t) => ({ id: t.id, date: t.date, ...JSON.parse(t.data) }))
    .filter((t) => Array.isArray(t.attendance));
  const history = trainings.map((t) => ({ id: t.id, date: t.date, title: t.title, present: t.attendance.includes(row.id) }));
  res.json({
    player: playerOut(row, u),
    notes: notes.map((n) => ({
      id: n.id, playerId: n.player_id, authorId: n.author_id, authorName: n.author_name, kind: n.kind, text: n.text,
      visibility: n.visibility, trainingId: n.training_id, createdAt: n.created_at, updatedAt: n.updated_at,
    })),
    attendance: { present: history.filter((h) => h.present).length, total: history.length, history: history.slice(0, 30) },
    parents: isStaff(u)
      ? all('SELECT u.id, u.name, u.email FROM player_parents pp JOIN users u ON u.id = pp.user_id WHERE pp.player_id = ?', row.id)
      : [],
  });
});

const PLAYER_FIELDS = ['firstName', 'lastName', 'birthYear', 'number', 'level', 'foot', 'position', 'color'];

api.put('/players/:id', (req, res) => {
  need(req.user, 'players.manage');
  const id = checkId(req.params.id);
  const teamId = req.body.teamId;
  needTeam(req.user, teamId, { staff: true });
  const existing = get('SELECT team_id FROM players WHERE id = ?', id);
  if (existing) needTeam(req.user, existing.team_id);
  const data = {};
  for (const f of PLAYER_FIELDS) if (req.body[f] !== undefined) data[f] = typeof req.body[f] === 'string' ? str(req.body[f], 80) : req.body[f];
  if (!data.firstName) throw new HttpError(400, 'Prénom requis');
  if (existing) run('UPDATE players SET team_id = ?, data = ?, updated_at = ? WHERE id = ?', teamId, JSON.stringify(data), now(), id);
  else run('INSERT INTO players VALUES (?, ?, ?, ?, ?)', id, teamId, JSON.stringify(data), now(), now());
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', id), req.user));
});

api.delete('/players/:id', (req, res) => {
  need(req.user, 'players.manage');
  const row = playerAccess(req.user, req.params.id);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  run('DELETE FROM players WHERE id = ?', row.id);
  res.json({ ok: true });
});

const NOTE_KINDS = ['force', 'faiblesse', 'objectif', 'remarque'];

api.put('/notes/:id', (req, res) => {
  need(req.user, 'notes.write');
  const id = checkId(req.params.id);
  const existing = get('SELECT * FROM player_notes WHERE id = ?', id);
  const playerId = existing?.player_id ?? req.body.playerId;
  playerAccess(req.user, playerId);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  if (existing && existing.author_id !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, "Seul l'auteur peut modifier cette remarque");
  }
  const kind = NOTE_KINDS.includes(req.body.kind) ? req.body.kind : 'remarque';
  const text = str(req.body.text, 4000);
  if (!text) throw new HttpError(400, 'La remarque est vide');
  const visibility = req.body.visibility === 'parents' ? 'parents' : 'staff';
  if (existing) {
    run('UPDATE player_notes SET kind = ?, text = ?, visibility = ?, updated_at = ? WHERE id = ?', kind, text, visibility, now(), id);
  } else {
    run(
      'INSERT INTO player_notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, playerId, req.user.id, kind, text, visibility, str(req.body.trainingId, 64) || null, now(), now(),
    );
  }
  res.json({ ok: true });
});

api.delete('/notes/:id', (req, res) => {
  const n = get('SELECT * FROM player_notes WHERE id = ?', req.params.id);
  if (!n) return res.json({ ok: true });
  playerAccess(req.user, n.player_id);
  if (n.author_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, "Seul l'auteur peut supprimer cette remarque");
  run('DELETE FROM player_notes WHERE id = ?', n.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ exercices */

function exerciseOut(row, user = null) {
  const owner = row.owner_id ? get('SELECT name FROM users WHERE id = ?', row.owner_id) : null;
  const out = {
    ...parse(row),
    ownerId: row.owner_id,
    ownerName: owner?.name ?? 'Club',
    teamId: row.team_id ?? null,
    visibility: row.visibility,
    validated: !!row.validated,
    updatedAt: row.updated_at,
  };
  if (user) out.canEdit = exerciseEditable(user, row);
  return out;
}

/** Lecture : l'auteur, toute personne de l'équipe (joueurs et parents compris), et les éducateurs pour la bibliothèque du club. */
function exerciseReadable(user, row) {
  if (user.role === 'admin' || row.owner_id === user.id) return true;
  if (row.team_id && teamIdsFor(user).includes(row.team_id)) return true;
  return isStaff(user) && row.visibility === 'club';
}

/** Écriture : l'auteur, l'administrateur, et tous les éducateurs / dirigeants de l'équipe de l'exercice. */
function exerciseEditable(user, row) {
  if (user.role === 'admin' || row.owner_id === user.id) return true;
  return !!row.team_id && isStaff(user) && can(user, 'exercises.create') && teamIdsFor(user).includes(row.team_id);
}

function exerciseRow(user, id) {
  const row = get('SELECT * FROM exercises WHERE id = ?', id);
  if (!row || !exerciseReadable(user, row)) throw new HttpError(404, 'Exercice introuvable');
  return row;
}

/** Prévient l'équipe (listes, séances) et la salle de l'exercice (lecteurs). */
function exerciseChanged(req, row, deleted = false) {
  const msg = { t: 'exercise', id: row.id, teamId: row.team_id ?? null, deleted, by: req.user.name, updatedAt: deleted ? now() : row.updated_at };
  toTeamAndRoom(row.team_id, row.id, msg, origin(req));
}

api.get('/exercises', (req, res) => {
  const scope = req.query.scope;
  let rows;
  if (scope === 'team') {
    needTeam(req.user, String(req.query.teamId || ''));
    rows = all('SELECT * FROM exercises WHERE team_id = ? ORDER BY updated_at DESC', req.query.teamId);
  } else {
    if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
    rows = scope === 'club'
      ? all(`SELECT * FROM exercises WHERE visibility = 'club' ORDER BY validated DESC, updated_at DESC`)
      : all('SELECT * FROM exercises WHERE owner_id = ? AND team_id IS NULL ORDER BY updated_at DESC', req.user.id);
  }
  res.json(rows.map((r) => exerciseOut(r, req.user)));
});

api.get('/exercises/:id', (req, res) => {
  res.json(exerciseOut(exerciseRow(req.user, req.params.id), req.user));
});

const EX_META = ['id', 'ownerId', 'ownerName', 'teamId', 'visibility', 'validated', 'updatedAt', 'canEdit'];

api.put('/exercises/:id', (req, res) => {
  const id = checkId(req.params.id);
  const existing = get('SELECT * FROM exercises WHERE id = ?', id);
  if (existing) {
    if (!exerciseEditable(req.user, existing)) throw new HttpError(403, 'Seuls les éducateurs de son équipe peuvent modifier cet exercice');
  } else need(req.user, 'exercises.create');
  // Équipe : fixée à la création, ou déplacée par quelqu'un qui encadre la nouvelle équipe.
  let teamId = existing?.team_id ?? null;
  if (req.body.teamId !== undefined && req.body.teamId !== teamId) {
    if (req.body.teamId) needTeam(req.user, req.body.teamId, { staff: true });
    teamId = req.body.teamId || null;
  }
  const visibility = req.body.visibility === 'club' ? 'club' : 'private';
  if (visibility === 'club' && existing?.visibility !== 'club') need(req.user, 'library.share');
  const data = { ...req.body };
  for (const k of EX_META) delete data[k];
  data.title = str(data.title, 120) || 'Exercice sans titre';
  const json = JSON.stringify(data);
  if (json.length > 2_000_000) throw new HttpError(413, 'Exercice trop volumineux');
  if (existing) {
    // Un exercice modifié doit être revalidé.
    const validated = visibility === 'club' && existing.validated && existing.data === json ? 1 : 0;
    run('UPDATE exercises SET visibility = ?, validated = ?, data = ?, team_id = ?, updated_at = ? WHERE id = ?', visibility, validated, json, teamId, now(), id);
  } else {
    run(
      'INSERT INTO exercises (id, owner_id, visibility, validated, data, created_at, updated_at, team_id) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      id, req.user.id, visibility, json, now(), now(), teamId,
    );
  }
  const row = get('SELECT * FROM exercises WHERE id = ?', id);
  exerciseChanged(req, row);
  // Changement d'équipe : l'ancienne équipe retire l'exercice de sa liste.
  if (existing?.team_id && existing.team_id !== teamId) toTeam(existing.team_id, { t: 'exercise', id, teamId: existing.team_id, deleted: true }, origin(req));
  res.json(exerciseOut(row, req.user));
});

api.post('/exercises/:id/validate', (req, res) => {
  need(req.user, 'library.validate');
  const row = get('SELECT * FROM exercises WHERE id = ?', req.params.id);
  if (!row || row.visibility !== 'club') throw new HttpError(404, 'Exercice introuvable');
  run('UPDATE exercises SET validated = ? WHERE id = ?', req.body.validated ? 1 : 0, row.id);
  const updated = get('SELECT * FROM exercises WHERE id = ?', row.id);
  exerciseChanged(req, updated);
  res.json(exerciseOut(updated, req.user));
});

api.delete('/exercises/:id', (req, res) => {
  const row = get('SELECT * FROM exercises WHERE id = ?', req.params.id);
  if (!row) return res.json({ ok: true });
  if (!exerciseEditable(req.user, row)) throw new HttpError(403, 'Seuls les éducateurs de son équipe peuvent supprimer cet exercice');
  run('DELETE FROM exercises WHERE id = ?', row.id);
  exerciseChanged(req, row, true);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ temps réel */

api.get('/live', (req, res) => {
  openStream(req, res, teamIdsFor(req.user));
});

/** L'onglet ouvre (ou ferme, exerciseId = null) un exercice : présence et diffusion en direct. */
api.post('/live/watch', (req, res) => {
  const c = clientOf(req.user, origin(req));
  if (!c) throw new HttpError(404, 'Connexion temps réel introuvable');
  const exId = req.body.exerciseId ? String(req.body.exerciseId) : null;
  if (!exId) {
    setWatch(c, null, false);
    return res.json({ ok: true });
  }
  const row = exerciseRow(req.user, exId);
  setWatch(c, exId, exerciseEditable(req.user, row));
  res.json({ ok: true });
});

/** Relais instantané (sans enregistrement) de l'état de l'éditeur et du curseur vers les autres personnes présentes. */
api.post('/exercises/:id/live', (req, res) => {
  const c = clientOf(req.user, origin(req));
  if (!c || c.watch !== req.params.id || !c.editor) throw new HttpError(403, 'Action non autorisée');
  const msg = { exId: c.watch, from: c.id, userId: req.user.id, name: req.user.name };
  if (req.body.state && typeof req.body.state === 'object') {
    const data = { ...req.body.state };
    for (const k of EX_META) if (k !== 'visibility') delete data[k];
    toRoom(c.watch, { t: 'state', ...msg, data }, c.id);
  }
  if (req.body.cursor !== undefined) {
    const cur = req.body.cursor;
    const ok = Array.isArray(cur) && cur.length === 2 && cur.every(Number.isFinite);
    toRoom(c.watch, { t: 'cursor', ...msg, cursor: ok ? cur : null, frame: Number(req.body.frame) || 0 }, c.id);
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ séances */

function exerciseIdsOf(t) {
  const ids = new Set();
  for (const b of t.blocks || []) {
    if (b.exerciseId) ids.add(b.exerciseId);
    for (const s of b.stations || []) if (s.exerciseId) ids.add(s.exerciseId);
  }
  return [...ids];
}

/** Visuel d'une séance : son premier exercice animé (ou à défaut le premier exercice). */
function coverOf(t) {
  let first = null;
  for (const id of exerciseIdsOf(t)) {
    const row = get('SELECT * FROM exercises WHERE id = ?', id);
    if (!row) continue;
    const ex = parse(row);
    const out = { id: row.id, title: ex.title, field: ex.field, items: ex.items, paths: ex.paths, frames: ex.frames };
    if ((ex.frames?.length ?? 0) > 1) return out;
    first ??= out;
  }
  return first;
}

function trainingPayload(row, { sanitize }) {
  const t = { ...JSON.parse(row.data), id: row.id, teamId: row.team_id, date: row.date, published: !!row.published, shareToken: row.share_token, updatedAt: row.updated_at };
  const exercises = {};
  for (const id of exerciseIdsOf(t)) {
    const ex = get('SELECT * FROM exercises WHERE id = ?', id);
    if (ex) exercises[id] = exerciseOut(ex);
  }
  if (sanitize) {
    delete t.attendance;
    delete t.groups;
    delete t.coachNotes;
    delete t.shareToken;
    for (const e of Object.values(exercises)) delete e.ownerId;
    const team = get('SELECT name, category FROM teams WHERE id = ?', row.team_id);
    t.team = team;
    t.club = get('SELECT name FROM club WHERE id = 1')?.name;
  }
  return { training: t, exercises };
}

api.get('/teams/:teamId/trainings', (req, res) => {
  needTeam(req.user, req.params.teamId);
  const staff = isStaff(req.user);
  const rows = all(
    `SELECT * FROM trainings WHERE team_id = ? ${staff ? '' : 'AND published = 1'} ORDER BY date DESC`,
    req.params.teamId,
  );
  res.json(rows.map((r) => {
    const t = { ...JSON.parse(r.data), id: r.id, teamId: r.team_id, date: r.date, published: !!r.published, shareToken: staff ? r.share_token : undefined, updatedAt: r.updated_at };
    if (!staff) { delete t.attendance; delete t.groups; delete t.coachNotes; }
    t.cover = coverOf(t);
    return t;
  }));
});

api.get('/trainings/:id', (req, res) => {
  const row = get('SELECT * FROM trainings WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'Séance introuvable');
  needTeam(req.user, row.team_id);
  const staff = isStaff(req.user);
  if (!staff && !row.published) throw new HttpError(404, 'Séance introuvable');
  res.json(trainingPayload(row, { sanitize: !staff }));
});

const TRAINING_META = ['id', 'teamId', 'date', 'published', 'shareToken', 'updatedAt', 'team', 'club', 'cover'];

api.put('/trainings/:id', (req, res) => {
  need(req.user, 'trainings.manage');
  const id = checkId(req.params.id);
  needTeam(req.user, req.body.teamId, { staff: true });
  const existing = get('SELECT * FROM trainings WHERE id = ?', id);
  if (existing) needTeam(req.user, existing.team_id);
  const published = req.body.published ? 1 : 0;
  if (published !== (existing?.published ?? 0)) need(req.user, 'trainings.publish');
  const date = /^\d{4}-\d{2}-\d{2}/.test(req.body.date || '') ? req.body.date.slice(0, 16) : new Date().toISOString().slice(0, 10);
  const data = { ...req.body };
  for (const k of TRAINING_META) delete data[k];
  data.title = str(data.title, 120) || 'Séance';
  if (existing) {
    run('UPDATE trainings SET team_id = ?, date = ?, published = ?, data = ?, updated_at = ? WHERE id = ?', req.body.teamId, date, published, JSON.stringify(data), now(), id);
  } else {
    run('INSERT INTO trainings VALUES (?, ?, ?, ?, NULL, ?, ?, ?)', id, req.body.teamId, date, published, JSON.stringify(data), now(), now());
  }
  toTeam(req.body.teamId, { t: 'training', id, teamId: req.body.teamId, by: req.user.name }, origin(req));
  res.json(trainingPayload(get('SELECT * FROM trainings WHERE id = ?', id), { sanitize: false }));
});

api.post('/trainings/:id/share', (req, res) => {
  need(req.user, 'trainings.publish');
  const row = get('SELECT * FROM trainings WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'Séance introuvable');
  needTeam(req.user, row.team_id, { staff: true });
  const token = req.body.enabled === false ? null : row.share_token || newId(18);
  run('UPDATE trainings SET share_token = ? WHERE id = ?', token, row.id);
  res.json({ shareToken: token });
});

api.delete('/trainings/:id', (req, res) => {
  need(req.user, 'trainings.manage');
  const row = get('SELECT team_id FROM trainings WHERE id = ?', req.params.id);
  if (!row) return res.json({ ok: true });
  needTeam(req.user, row.team_id, { staff: true });
  run('DELETE FROM trainings WHERE id = ?', req.params.id);
  toTeam(row.team_id, { t: 'training', id: req.params.id, teamId: row.team_id, deleted: true }, origin(req));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ calendrier */

const EVENT_TYPES = ['training', 'match', 'plateau', 'tournament', 'meeting', 'other'];
const hhmm = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? v : '');
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');

function eventOut(r, staff) {
  const e = { ...JSON.parse(r.data), id: r.id, teamId: r.team_id, updatedAt: r.updated_at };
  if (!staff) delete e.notes;
  return e;
}

api.get('/teams/:teamId/events', (req, res) => {
  needTeam(req.user, req.params.teamId);
  const staff = isStaff(req.user);
  res.json(
    all('SELECT * FROM events WHERE team_id = ?', req.params.teamId)
      .map((r) => eventOut(r, staff))
      .filter((e) => staff || e.parents !== false),
  );
});

api.put('/events/:id', (req, res) => {
  need(req.user, 'events.manage');
  const id = checkId(req.params.id);
  needTeam(req.user, req.body.teamId, { staff: true });
  const existing = get('SELECT team_id FROM events WHERE id = ?', id);
  if (existing) needTeam(req.user, existing.team_id);
  const b = req.body;
  const start = ymd(b.start);
  if (!start) throw new HttpError(400, 'Date invalide');
  const r = b.recurrence || {};
  const data = {
    type: EVENT_TYPES.includes(b.type) ? b.type : 'other',
    title: str(b.title, 120),
    start,
    allDay: !!b.allDay,
    time: hhmm(b.time),
    endTime: hhmm(b.endTime),
    meetTime: hhmm(b.meetTime),
    location: str(b.location, 200),
    opponent: str(b.opponent, 80),
    venue: ['home', 'away', 'neutral'].includes(b.venue) ? b.venue : '',
    notes: str(b.notes, 2000),
    color: str(b.color, 20),
    parents: b.parents !== false,
    recurrence: {
      freq: ['none', 'daily', 'weekly', 'monthly'].includes(r.freq) ? r.freq : 'none',
      interval: Math.max(1, Math.min(12, Number(r.interval) || 1)),
      days: Array.isArray(r.days) ? r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      until: ymd(r.until) || null,
      count: Number(r.count) > 0 ? Math.min(200, Number(r.count)) : null,
    },
    exdates: Array.isArray(b.exdates) ? b.exdates.filter(ymd).slice(0, 400) : [],
  };
  if (existing) run('UPDATE events SET team_id = ?, data = ?, updated_at = ? WHERE id = ?', b.teamId, JSON.stringify(data), now(), id);
  else run('INSERT INTO events VALUES (?, ?, ?, ?, ?)', id, b.teamId, JSON.stringify(data), now(), now());
  res.json(eventOut(get('SELECT * FROM events WHERE id = ?', id), true));
});

api.delete('/events/:id', (req, res) => {
  need(req.user, 'events.manage');
  const row = get('SELECT team_id FROM events WHERE id = ?', req.params.id);
  if (!row) return res.json({ ok: true });
  needTeam(req.user, row.team_id, { staff: true });
  run('DELETE FROM events WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ album souvenir */

const photoOut = (r) => ({
  id: r.id, teamId: r.team_id, authorId: r.author_id, authorName: r.author_name ?? null, caption: r.caption,
  width: r.width, height: r.height, takenAt: r.taken_at, createdAt: r.created_at,
});

api.get('/teams/:teamId/photos', (req, res) => {
  needTeam(req.user, req.params.teamId);
  res.json(
    all(
      `SELECT p.*, u.name author_name FROM photos p LEFT JOIN users u ON u.id = p.author_id WHERE team_id = ? ORDER BY taken_at DESC`,
      req.params.teamId,
    ).map(photoOut),
  );
});

function decodeImage(dataUrl, maxBytes) {
  const m = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Image invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, 'Image trop lourde');
  return buf;
}

api.post('/teams/:teamId/photos', (req, res) => {
  need(req.user, 'album.manage');
  needTeam(req.user, req.params.teamId, { staff: true });
  const full = decodeImage(req.body.image, 5_000_000);
  const thumb = decodeImage(req.body.thumb, 600_000);
  const id = newId();
  writeFileSync(join(UPLOADS, `${id}.jpg`), full);
  writeFileSync(join(UPLOADS, `${id}_t.jpg`), thumb);
  const takenAt = Number(req.body.takenAt) || now();
  run(
    'INSERT INTO photos VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, req.params.teamId, req.user.id, str(req.body.caption, 200),
    Math.max(1, Number(req.body.width) || 1), Math.max(1, Number(req.body.height) || 1), takenAt, now(),
  );
  res.json(photoOut(get('SELECT * FROM photos WHERE id = ?', id)));
});

function photoAccess(user, id) {
  const p = get('SELECT * FROM photos WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Photo introuvable');
  needTeam(user, p.team_id);
  return p;
}

api.get('/photos/:id/:size', (req, res) => {
  const p = photoAccess(req.user, req.params.id);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('jpeg').sendFile(join(UPLOADS, `${p.id}${req.params.size === 'thumb' ? '_t' : ''}.jpg`));
});

function canEditPhoto(user, p) {
  return user.role === 'admin' || p.author_id === user.id || (isStaff(user) && can(user, 'album.manage'));
}

api.patch('/photos/:id', (req, res) => {
  const p = photoAccess(req.user, req.params.id);
  if (!canEditPhoto(req.user, p)) throw new HttpError(403, 'Action non autorisée');
  run('UPDATE photos SET caption = ? WHERE id = ?', str(req.body.caption, 200), p.id);
  res.json({ ok: true });
});

api.delete('/photos/:id', (req, res) => {
  const p = get('SELECT * FROM photos WHERE id = ?', req.params.id);
  if (!p) return res.json({ ok: true });
  photoAccess(req.user, p.id);
  if (!canEditPhoto(req.user, p)) throw new HttpError(403, 'Action non autorisée');
  run('DELETE FROM photos WHERE id = ?', p.id);
  for (const f of [`${p.id}.jpg`, `${p.id}_t.jpg`]) {
    try {
      unlinkSync(join(UPLOADS, f));
    } catch {
      /* déjà supprimé */
    }
  }
  res.json({ ok: true });
});
