/**
 * Temps réel (Server-Sent Events) : un flux par onglet ouvert.
 * - Canal d'équipe : « tel exercice / telle séance a changé » pour rafraîchir les listes.
 * - Salle d'exercice : présence, état de l'éditeur diffusé en direct et curseurs des autres éducateurs.
 */
import { HttpError } from './auth.js';

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** clientId → { id, res, user, teams, watch, editor } */
const clients = new Map();

function send(c, msg) {
  c.res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

export function openStream(req, res, teamIds) {
  const id = String(req.query.clientId || '');
  if (!CLIENT_ID.test(id)) throw new HttpError(400, 'Identifiant de connexion invalide');
  const old = clients.get(id);
  if (old && old.user.id !== req.user.id) throw new HttpError(409, 'Identifiant de connexion déjà utilisé');
  if (old) drop(old);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const c = { id, res, user: { id: req.user.id, name: req.user.name }, teams: new Set(teamIds), watch: null, editor: false };
  clients.set(id, c);
  send(c, { t: 'hello' });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    if (clients.get(id) === c) drop(c);
  });
}

function drop(c) {
  clients.delete(c.id);
  if (c.watch) presence(c.watch);
  try {
    c.res.end();
  } catch {
    /* déjà fermé */
  }
}

/** Connexion d'un onglet de cet utilisateur (ou null). */
export function clientOf(user, clientId) {
  const c = clients.get(String(clientId || ''));
  return c && c.user.id === user.id ? c : null;
}

/** L'onglet regarde (ou quitte, avec null) un exercice. */
export function setWatch(c, exerciseId, editor) {
  const prev = c.watch;
  c.watch = exerciseId;
  c.editor = !!exerciseId && editor;
  if (prev && prev !== exerciseId) presence(prev);
  if (exerciseId) presence(exerciseId);
}

function presence(exerciseId) {
  const users = [...clients.values()]
    .filter((c) => c.watch === exerciseId)
    .map((c) => ({ clientId: c.id, userId: c.user.id, name: c.user.name, editor: c.editor }));
  toRoom(exerciseId, { t: 'presence', exId: exerciseId, users });
}

export function toRoom(exerciseId, msg, except = null) {
  for (const c of clients.values()) if (c.watch === exerciseId && c.id !== except) send(c, msg);
}

export function toTeam(teamId, msg, except = null) {
  if (!teamId) return;
  for (const c of clients.values()) if (c.teams.has(teamId) && c.id !== except) send(c, msg);
}

/** Une seule fois à chaque onglet de l'équipe ou présent sur l'exercice. */
export function toTeamAndRoom(teamId, exerciseId, msg, except = null) {
  for (const c of clients.values()) {
    if (c.id !== except && ((teamId && c.teams.has(teamId)) || c.watch === exerciseId)) send(c, msg);
  }
}

/** Une équipe vient d'être créée ou ses éducateurs ont changé : les flux concernés se reconnectent. */
export function refreshTeams(userIds) {
  for (const c of clients.values()) if (!userIds || userIds.includes(c.user.id)) send(c, { t: 'reconnect' });
}
