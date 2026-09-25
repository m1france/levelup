import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, get, run } from './db.js';

export const ROLES = ['admin', 'dirigeant', 'coach', 'parent'];

/** Catalogue des permissions. `defaults` = rôles qui l'ont à l'installation (l'admin a tout, toujours). */
export const PERMISSIONS = [
  { key: 'members.manage', label: 'Inviter et gérer les membres', group: 'Club', defaults: [] },
  { key: 'teams.manage', label: 'Créer et modifier les équipes', group: 'Club', defaults: ['dirigeant'] },
  { key: 'teams.all', label: 'Accéder à toutes les équipes', group: 'Club', defaults: ['dirigeant'] },
  { key: 'players.manage', label: "Gérer l'effectif (ajouter, modifier des joueurs)", group: 'Joueurs', defaults: ['dirigeant', 'coach'] },
  { key: 'notes.view', label: 'Consulter les pages joueurs', group: 'Joueurs', defaults: ['dirigeant', 'coach'] },
  { key: 'notes.write', label: 'Écrire des remarques sur les joueurs', group: 'Joueurs', defaults: ['coach'] },
  { key: 'exercises.create', label: 'Créer des exercices', group: 'Exercices', defaults: ['dirigeant', 'coach'] },
  { key: 'library.share', label: 'Partager dans la bibliothèque du club', group: 'Exercices', defaults: ['dirigeant', 'coach'] },
  { key: 'library.validate', label: 'Valider les exercices du club', group: 'Exercices', defaults: ['dirigeant'] },
  { key: 'trainings.manage', label: 'Préparer et animer les séances', group: 'Séances', defaults: ['coach'] },
  { key: 'trainings.publish', label: 'Publier une séance aux parents / lien public', group: 'Séances', defaults: ['coach'] },
  { key: 'events.manage', label: 'Gérer le calendrier (matchs, plateaux, événements)', group: 'Séances', defaults: ['dirigeant', 'coach'] },
  { key: 'album.manage', label: 'Ajouter et retirer des photos de l’album', group: 'Séances', defaults: ['dirigeant', 'coach'] },
];
const PERM_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/** Applique les droits par défaut des permissions jamais initialisées (y compris celles ajoutées dans une mise à jour). */
export function seedPermissions() {
  const seeded = new Set(all('SELECT key FROM perm_seeded').map((r) => r.key));
  if (!seeded.size) {
    // Base créée avant le suivi : ce qui existe déjà est considéré comme initialisé.
    for (const r of all('SELECT DISTINCT perm FROM role_permissions')) seeded.add(r.perm);
    for (const k of seeded) run('INSERT OR IGNORE INTO perm_seeded VALUES (?)', k);
  }
  for (const p of PERMISSIONS) {
    if (seeded.has(p.key)) continue;
    for (const r of p.defaults) run('INSERT OR IGNORE INTO role_permissions VALUES (?, ?)', r, p.key);
    run('INSERT OR IGNORE INTO perm_seeded VALUES (?)', p.key);
  }
}

export function permsFor(role) {
  if (role === 'admin') return PERMISSIONS.map((p) => p.key);
  return all('SELECT perm FROM role_permissions WHERE role = ?', role)
    .map((r) => r.perm)
    .filter((k) => PERM_KEYS.has(k));
}

export function setRolePerms(role, perms) {
  run('DELETE FROM role_permissions WHERE role = ?', role);
  for (const k of perms) if (PERM_KEYS.has(k)) run('INSERT INTO role_permissions VALUES (?, ?)', role, k);
}

export const newId = (n = 12) => randomBytes(n).toString('base64url');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SESSION_DAYS = 60;
const COOKIE = 'atelier_session';

export function startSession(res, userId) {
  const token = newId(32);
  const expires = Date.now() + SESSION_DAYS * 864e5;
  run('INSERT INTO auth_sessions VALUES (?, ?, ?)', token, userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
}

export function endSession(req, res) {
  const token = readCookie(req);
  if (token) run('DELETE FROM auth_sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attache req.user (ou null) à chaque requête. */
export function loadUser(req, _res, next) {
  req.user = null;
  const token = readCookie(req);
  if (token) {
    const row = get(
      `SELECT u.id, u.email, u.name, u.role, u.status FROM auth_sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
      token,
      Date.now(),
    );
    if (row && row.status === 'active') {
      req.user = { ...row, perms: new Set(permsFor(row.role)) };
    }
  }
  next();
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Connexion requise'));
  next();
}

export const can = (user, perm) => !!user && (user.role === 'admin' || user.perms.has(perm));

export function need(user, perm) {
  if (!can(user, perm)) throw new HttpError(403, "Vous n'avez pas la permission pour cette action");
}

/** Équipes visibles par l'utilisateur. */
export function teamIdsFor(user) {
  if (user.role === 'admin' || can(user, 'teams.all')) return all('SELECT id FROM teams').map((r) => r.id);
  if (user.role === 'parent') {
    return all(
      `SELECT DISTINCT p.team_id id FROM player_parents pp JOIN players p ON p.id = pp.player_id WHERE pp.user_id = ?`,
      user.id,
    ).map((r) => r.id);
  }
  return all('SELECT team_id id FROM team_staff WHERE user_id = ?', user.id).map((r) => r.id);
}

export const isStaff = (user) => user.role !== 'parent';

export function needTeam(user, teamId, { staff = false } = {}) {
  if (!teamId || !teamIdsFor(user).includes(teamId)) throw new HttpError(404, 'Équipe introuvable');
  if (staff && !isStaff(user)) throw new HttpError(403, 'Réservé aux éducateurs');
}

export function childIdsFor(user) {
  return all('SELECT player_id id FROM player_parents WHERE user_id = ?', user.id).map((r) => r.id);
}
