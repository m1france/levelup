/**
 * Fiches joueurs : identité, profil d'évaluation (1 à 5 par compétence, historique pour l'évolution),
 * postes et pied fort, objectifs individuels avec points d'étape, observations, infos pratiques
 * (contacts d'urgence, santé, licence) et historique des matchs.
 *
 * Confidentialité : les évaluations restent entre éducateurs. Les parents voient les objectifs
 * et observations explicitement partagés, les présences, les matchs et les infos pratiques de leur enfant.
 */
import { Router } from 'express';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, parse, UPLOADS } from './db.js';
import { can, need, needTeam, isStaff, childIdsFor, newId, HttpError } from './auth.js';
import { evTitle } from './convocations.js';
import { todayYMD } from './occurrences.js';
import { AWARDS, autoAwards, sendPlayerPhoto } from './reveal.js';
import { guessGroup, teamInfo } from './groups.js';

export const playersApi = Router();

const now = () => Date.now();
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const checkId = (id) => {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide');
  return id;
};

/** Compétences évaluées, par domaine (les libellés sont côté client, src/lib/profile.ts). */
export const DOMAINS = {
  tech: ['conduite', 'passe', 'controle', 'frappe', 'dribble'],
  phys: ['vitesse', 'endurance', 'coordination', 'equilibre'],
  tact: ['placement', 'vision', 'repli', 'demarquage'],
  mental: ['concentration', 'confiance', 'combativite', 'frustration'],
  behav: ['ecoute', 'equipe', 'respect', 'assiduite'],
};
const SKILLS = new Set(Object.values(DOMAINS).flat());

/** Tests concrets et mesurables (plus petit = mieux pour les chronos). */
export const TESTS = {
  sprint20: { lower: true, max: 20 },
  slalom: { lower: true, max: 60 },
  jongles: { lower: false, max: 999 },
  tirs: { lower: false, max: 10 },
  passes: { lower: false, max: 10 },
  endurance: { lower: false, max: 20 },
};
const POSITIONS = new Set(['GB', 'DG', 'DC', 'DD', 'MDC', 'MG', 'MC', 'MD', 'MOC', 'AG', 'BU', 'AD']);

function domainAverages(ratings = {}) {
  const out = {};
  for (const [d, skills] of Object.entries(DOMAINS)) {
    const vals = skills.map((s) => ratings[s]).filter((v) => v >= 1 && v <= 5);
    if (vals.length) out[d] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  }
  return out;
}

/** Aisance 1–3 (pour équilibrer les groupes en séance) déduite des évaluations. */
function levelFrom(ratings, fallback) {
  const vals = Object.values(ratings || {}).filter((v) => v >= 1 && v <= 5);
  if (!vals.length) return fallback ?? 2;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg < 2.5 ? 1 : avg < 3.5 ? 2 : 3;
}

/* Ancien format (pied et poste en texte libre) → profil. */
(function migrate() {
  const guess = (t) => {
    const s = (t || '').toLowerCase();
    if (/gard|goal/.test(s)) return ['GB'];
    if (/d[ée]f|arri[èe]re/.test(s)) return ['DC'];
    if (/milieu/.test(s)) return ['MC'];
    if (/att|avant|butt?eur/.test(s)) return ['BU'];
    if (/ailier/.test(s)) return ['AG'];
    return [];
  };
  for (const r of all('SELECT id, data FROM players')) {
    const d = JSON.parse(r.data);
    if (d.foot === undefined && d.position === undefined) continue;
    const profile = { ...(d.profile || {}) };
    if (d.foot && !profile.foot) profile.foot = d.foot;
    if (d.position && !profile.positions?.length) profile.positions = guess(d.position);
    delete d.foot;
    delete d.position;
    d.profile = profile;
    run('UPDATE players SET data = ? WHERE id = ?', JSON.stringify(d), r.id);
  }
})();

/* ------------------------------------------------------------------ lecture */

export function playerOut(row, user, extras = false) {
  const p = { ...parse(row), teamId: row.team_id, updatedAt: row.updated_at, createdAt: row.created_at };
  const profile = p.profile || {};
  if (!isStaff(user) || !can(user, 'notes.view')) {
    p.profile = { positions: profile.positions ?? [], foot: profile.foot ?? '' };
    if (!isStaff(user)) delete p.level;
  } else p.profile = { ...profile, domains: domainAverages(profile.ratings) };
  if (!isStaff(user) && !childIdsFor(user).includes(p.id)) delete p.info;
  if (extras && isStaff(user) && can(user, 'notes.view')) p.followUp = followUp(p);
  return p;
}

/** Ce qui demande l'attention de l'éducateur pour ce joueur. */
function followUp(p) {
  const lastObs = get('SELECT MAX(created_at) t FROM player_observations WHERE player_id = ?', p.id).t;
  const goals = all('SELECT data FROM player_objectives WHERE player_id = ?', p.id).map((g) => JSON.parse(g.data));
  const today = todayYMD();
  const active = goals.filter((g) => g.status === 'active');
  const cert = p.info?.certificate;
  const certEnd = cert ? new Date(new Date(`${cert}T12:00`).getTime() + 365 * 864e5).toISOString().slice(0, 10) : null;
  const since = lastObs ?? p.createdAt;
  return {
    lastObservation: lastObs ?? null,
    quietDays: Math.floor((now() - since) / 864e5),
    activeGoals: active.length,
    overdueGoals: active.filter((g) => g.due && g.due < today).length,
    doneGoals: goals.filter((g) => g.status === 'done').length,
    rated: Object.keys(p.profile?.ratings || {}).length,
    certificate: !cert ? 'missing' : certEnd < today ? 'expired' : certEnd < new Date(now() + 30 * 864e5).toISOString().slice(0, 10) ? 'soon' : 'ok',
  };
}

export function playerAccess(user, playerId) {
  const row = get('SELECT * FROM players WHERE id = ?', playerId);
  if (!row) throw new HttpError(404, 'Joueur introuvable');
  if (isStaff(user)) needTeam(user, row.team_id);
  else if (!childIdsFor(user).includes(playerId)) throw new HttpError(404, 'Joueur introuvable');
  return row;
}

playersApi.get('/teams/:teamId/players', (req, res) => {
  needTeam(req.user, req.params.teamId);
  let rows = all('SELECT * FROM players WHERE team_id = ?', req.params.teamId);
  if (!isStaff(req.user)) {
    const kids = childIdsFor(req.user);
    rows = rows.filter((r) => kids.includes(r.id));
  }
  const players = rows.map((r) => playerOut(r, req.user, req.query.followUp === '1'));
  players.sort((a, b) => (a.firstName || '').localeCompare(b.firstName || '', 'fr'));
  res.json(players);
});

const obsOut = (n) => ({
  id: n.id, playerId: n.player_id, authorId: n.author_id, authorName: n.author_name ?? null, skill: n.skill, trend: n.trend,
  text: n.text, visibility: n.visibility, trainingId: n.training_id, createdAt: n.created_at, updatedAt: n.updated_at,
});
const goalOut = (g) => ({
  ...JSON.parse(g.data), id: g.id, playerId: g.player_id, authorId: g.author_id, authorName: g.author_name ?? null,
  visibility: g.visibility, createdAt: g.created_at, updatedAt: g.updated_at,
});

/** Matchs de la saison pour ce joueur (convocations publiées). */
function playerMatches(playerId, teamId) {
  const avail = new Map(all('SELECT event_id, date, status FROM availability WHERE player_id = ?', playerId).map((a) => [`${a.event_id}|${a.date}`, a.status]));
  const today = todayYMD();
  return all(
    `SELECT c.*, e.data edata FROM convocations c JOIN events e ON e.id = c.event_id
     WHERE c.team_id = ? AND c.published_at IS NOT NULL ORDER BY c.date DESC LIMIT 60`,
    teamId,
  ).map((r) => {
    const d = JSON.parse(r.data);
    const e = JSON.parse(r.edata);
    const m = d.match;
    const sel = (d.selection || []).includes(playerId);
    const past = r.date < today || m?.finished;
    let status;
    if (!past) status = sel ? 'upcoming' : 'notSelected';
    else if (sel) status = (m?.absent || []).includes(playerId) ? 'noShow' : 'played';
    else status = avail.get(`${r.event_id}|${r.date}`) === 'no' ? 'unavailable' : 'notSelected';
    return {
      eventId: r.event_id, date: r.date, title: evTitle(e), type: e.type, status,
      minutes: status === 'played' ? Math.round((m?.seconds?.[playerId] || 0) / 60) : null,
      goals: (m?.events || []).filter((ev) => ev.t === 'goal' && ev.pid === playerId).length,
      starter: (m?.starters || []).includes(playerId),
      score: m?.finished ? { us: m.score?.us ?? 0, them: m.score?.them ?? 0 } : null,
      award: status === 'played' && m?.finished ? (() => {
        const absent = new Set(m.absent || []);
        const key = d.awards?.[playerId] ?? autoAwards(m, (d.selection || []).filter((x) => !absent.has(x)))[playerId];
        return key && AWARDS[key] ? { key, ...AWARDS[key] } : null;
      })() : null,
    };
  });
}

playersApi.get('/players/:id', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  const u = req.user;
  const staffView = isStaff(u) && can(u, 'notes.view');
  const shared = staffView ? '' : `AND visibility = 'parents'`;
  const canSee = staffView || !isStaff(u);
  const observations = canSee
    ? all(`SELECT n.*, u.name author_name FROM player_observations n LEFT JOIN users u ON u.id = n.author_id WHERE player_id = ? ${shared} ORDER BY created_at DESC`, row.id).map(obsOut)
    : [];
  const objectives = canSee
    ? all(`SELECT g.*, u.name author_name FROM player_objectives g LEFT JOIN users u ON u.id = g.author_id WHERE player_id = ? ${shared} ORDER BY created_at DESC`, row.id).map(goalOut)
    : [];
  const trainings = all('SELECT id, date, data FROM trainings WHERE team_id = ? ORDER BY date DESC', row.team_id)
    .map((t) => ({ id: t.id, date: t.date, ...JSON.parse(t.data) }))
    .filter((t) => Array.isArray(t.attendance) && t.attendance.length);
  const history = trainings.map((t) => ({ id: t.id, date: t.date, title: t.title, present: t.attendance.includes(row.id) }));
  res.json({
    player: playerOut(row, u, true),
    observations,
    objectives,
    attendance: { present: history.filter((h) => h.present).length, total: history.length, history: history.slice(0, 40) },
    matches: playerMatches(row.id, row.team_id),
    parents: all('SELECT u.id, u.name, u.email, u.phone FROM player_parents pp JOIN users u ON u.id = pp.user_id WHERE pp.player_id = ?', row.id),
  });
});

/* ------------------------------------------------------------------ écriture */

const IDENTITY = ['firstName', 'lastName', 'birthYear', 'number'];

playersApi.put('/players/:id', (req, res) => {
  need(req.user, 'players.manage');
  const id = checkId(req.params.id);
  const teamId = req.body.teamId;
  needTeam(req.user, teamId, { staff: true });
  const existing = get('SELECT * FROM players WHERE id = ?', id);
  if (existing) needTeam(req.user, existing.team_id);
  const data = existing ? JSON.parse(existing.data) : { level: 2 };
  for (const f of IDENTITY) {
    if (req.body[f] === undefined) continue;
    const v = req.body[f];
    if (f === 'birthYear' || f === 'number') data[f] = v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v));
    else data[f] = str(v, 80);
  }
  if (!data.firstName) throw new HttpError(400, 'Prénom requis');
  // Équipe à plusieurs catégories (U8/U9) : la catégorie est enregistrée sur la fiche du joueur.
  const groups = teamInfo(teamId).groups;
  if (!groups.length) delete data.category;
  else if (groups.includes(req.body.category)) data.category = req.body.category;
  else if (!groups.includes(data.category)) data.category = guessGroup(data.birthYear, teamId) ?? undefined;
  if (existing) run('UPDATE players SET team_id = ?, data = ?, updated_at = ? WHERE id = ?', teamId, JSON.stringify(data), now(), id);
  else run('INSERT INTO players VALUES (?, ?, ?, ?, ?)', id, teamId, JSON.stringify(data), now(), now());
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', id), req.user));
});

playersApi.delete('/players/:id', (req, res) => {
  need(req.user, 'players.manage');
  const row = playerAccess(req.user, req.params.id);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  run('DELETE FROM players WHERE id = ?', row.id);
  // Les photos et la vidéo de l'enfant partent avec sa fiche.
  for (const f of [join(UPLOADS, `player_${row.id}.jpg`), join(UPLOADS, `player_${row.id}.png`), ...walkoutFiles(row.id)]) if (existsSync(f)) unlinkSync(f);
  res.json({ ok: true });
});

/** Évaluations, pied fort et postes. Chaque jour d'évaluation garde une photo des moyennes pour l'évolution. */
playersApi.put('/players/:id/profile', (req, res) => {
  need(req.user, 'notes.write');
  const row = playerAccess(req.user, req.params.id);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const data = JSON.parse(row.data);
  const profile = { ...(data.profile || {}) };
  const b = req.body;
  if (b.ratings && typeof b.ratings === 'object') {
    const ratings = { ...(profile.ratings || {}) };
    for (const [k, v] of Object.entries(b.ratings)) {
      if (!SKILLS.has(k)) continue;
      if (v === null || v === 0) delete ratings[k];
      else if (Number(v) >= 1 && Number(v) <= 5) ratings[k] = Math.round(Number(v));
    }
    profile.ratings = ratings;
    const today = todayYMD();
    const snap = { at: today, d: domainAverages(ratings) };
    const hist = (profile.history || []).filter((h) => h.at !== today);
    profile.history = [...hist, snap].sort((a, b) => a.at.localeCompare(b.at)).slice(-80);
    data.level = levelFrom(ratings, data.level);
  }
  if (b.foot !== undefined) profile.foot = ['droit', 'gauche', 'deux'].includes(b.foot) ? b.foot : '';
  if (b.weakFoot !== undefined) profile.weakFoot = Number(b.weakFoot) >= 1 && Number(b.weakFoot) <= 5 ? Math.round(Number(b.weakFoot)) : 0;
  if (Array.isArray(b.positions)) profile.positions = [...new Set(b.positions.filter((p) => POSITIONS.has(p)))].slice(0, 5);
  data.profile = profile;
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});

/** Infos pratiques : modifiables par les éducateurs qui gèrent l'effectif et par les parents de l'enfant. */
playersApi.put('/players/:id/info', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  if (isStaff(req.user)) need(req.user, 'players.manage');
  const data = JSON.parse(row.data);
  const b = req.body || {};
  const contacts = Array.isArray(b.contacts)
    ? b.contacts.slice(0, 4).map((c) => ({ name: str(c?.name, 80), relation: str(c?.relation, 40), phone: str(c?.phone, 30) })).filter((c) => c.name || c.phone)
    : data.info?.contacts ?? [];
  data.info = {
    contacts,
    allergies: str(b.allergies, 300),
    treatment: str(b.treatment, 300),
    health: str(b.health, 600),
    licence: { number: str(b.licence?.number, 40), status: ['ok', 'pending', 'missing'].includes(b.licence?.status) ? b.licence.status : 'missing' },
    certificate: ymd(b.certificate),
    photoConsent: ['yes', 'no'].includes(b.photoConsent) ? b.photoConsent : '',
    city: str(b.city, 80),
  };
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});

function staffWriter(req, playerId) {
  need(req.user, 'notes.write');
  playerAccess(req.user, playerId);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
}

playersApi.put('/observations/:id', (req, res) => {
  const id = checkId(req.params.id);
  const existing = get('SELECT * FROM player_observations WHERE id = ?', id);
  const playerId = existing?.player_id ?? req.body.playerId;
  staffWriter(req, playerId);
  if (existing && existing.author_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, "Seul l'auteur peut modifier cette observation");
  const skill = SKILLS.has(req.body.skill) ? req.body.skill : '';
  const trend = ['up', 'flat', 'down'].includes(req.body.trend) ? req.body.trend : 'flat';
  const text = str(req.body.text, 4000);
  if (!text && !skill) throw new HttpError(400, 'Observation vide');
  const visibility = req.body.visibility === 'parents' ? 'parents' : 'staff';
  if (existing) {
    run('UPDATE player_observations SET skill = ?, trend = ?, text = ?, visibility = ?, updated_at = ? WHERE id = ?', skill, trend, text, visibility, now(), id);
  } else {
    run(
      'INSERT INTO player_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, playerId, req.user.id, skill, trend, text, visibility, str(req.body.trainingId, 64) || null, now(), now(),
    );
  }
  res.json({ ok: true });
});

playersApi.delete('/observations/:id', (req, res) => {
  const n = get('SELECT * FROM player_observations WHERE id = ?', req.params.id);
  if (!n) return res.json({ ok: true });
  playerAccess(req.user, n.player_id);
  if (n.author_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, "Seul l'auteur peut supprimer cette observation");
  run('DELETE FROM player_observations WHERE id = ?', n.id);
  res.json({ ok: true });
});

function cleanGoal(b, prev = {}) {
  const status = ['active', 'done', 'dropped'].includes(b.status) ? b.status : prev.status ?? 'active';
  return {
    title: str(b.title, 160) || prev.title || 'Objectif',
    domain: Object.keys(DOMAINS).includes(b.domain) ? b.domain : '',
    skill: SKILLS.has(b.skill) ? b.skill : '',
    due: ymd(b.due),
    status,
    progress: status === 'done' ? 100 : Math.max(0, Math.min(100, Math.round(Number(b.progress ?? prev.progress ?? 0) / 25) * 25)),
    checkins: prev.checkins ?? [],
    doneAt: status === 'done' ? prev.doneAt ?? now() : null,
  };
}

playersApi.put('/objectives/:id', (req, res) => {
  const id = checkId(req.params.id);
  const existing = get('SELECT * FROM player_objectives WHERE id = ?', id);
  const playerId = existing?.player_id ?? req.body.playerId;
  staffWriter(req, playerId);
  const data = cleanGoal(req.body, existing ? JSON.parse(existing.data) : {});
  const visibility = req.body.visibility === 'parents' ? 'parents' : 'staff';
  if (existing) run('UPDATE player_objectives SET data = ?, visibility = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), visibility, now(), id);
  else run('INSERT INTO player_objectives VALUES (?, ?, ?, ?, ?, ?, ?)', id, playerId, req.user.id, JSON.stringify(data), visibility, now(), now());
  res.json(goalOut(get('SELECT * FROM player_objectives WHERE id = ?', id)));
});

/** Point d'étape : où en est l'objectif (0, 25, 50, 75, 100 %) et ce qui a été observé. */
playersApi.post('/objectives/:id/checkin', (req, res) => {
  const g = get('SELECT * FROM player_objectives WHERE id = ?', req.params.id);
  if (!g) throw new HttpError(404, 'Objectif introuvable');
  staffWriter(req, g.player_id);
  const data = JSON.parse(g.data);
  const progress = Math.max(0, Math.min(100, Math.round(Number(req.body.progress ?? data.progress) / 25) * 25));
  data.checkins = [...(data.checkins || []), { at: now(), note: str(req.body.note, 500), progress, by: req.user.name, trainingId: str(req.body.trainingId, 64) || null }].slice(-50);
  data.progress = progress;
  if (progress === 100 && data.status === 'active') {
    data.status = 'done';
    data.doneAt = now();
  }
  run('UPDATE player_objectives SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), g.id);
  res.json(goalOut(get('SELECT * FROM player_objectives WHERE id = ?', g.id)));
});

playersApi.delete('/objectives/:id', (req, res) => {
  const g = get('SELECT * FROM player_objectives WHERE id = ?', req.params.id);
  if (!g) return res.json({ ok: true });
  staffWriter(req, g.player_id);
  run('DELETE FROM player_objectives WHERE id = ?', g.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ photo */

function decodeImage(dataUrl, maxBytes) {
  const m = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Image invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, 'Image trop lourde');
  return buf;
}

/** Photo du joueur (carte de match, fiche) : les éducateurs qui gèrent l'effectif ou les parents de l'enfant. */
playersApi.post('/players/:id/photo', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  if (isStaff(req.user)) need(req.user, 'players.manage');
  // PNG : photo détourée, la transparence est conservée sur les cartes.
  const alpha = /^data:image\/png;/.test(String(req.body.image || ''));
  const buf = decodeImage(req.body.image, 3_000_000);
  for (const e of ['jpg', 'png']) if (existsSync(join(UPLOADS, `player_${row.id}.${e}`))) unlinkSync(join(UPLOADS, `player_${row.id}.${e}`));
  writeFileSync(join(UPLOADS, `player_${row.id}.${alpha ? 'png' : 'jpg'}`), buf);
  const data = JSON.parse(row.data);
  data.photo = now();
  data.photoAlpha = alpha;
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});

playersApi.get('/players/:id/photo', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  sendPlayerPhoto(res, row.id);
});

/* ------------------------------------------------------------------ entrée sur le terrain (walkout) */

/*
 * Pour l'entrée sur le terrain de la convocation : une photo en pied (idéalement détourée, PNG transparent).
 * Mêmes droits que la photo : éducateurs qui gèrent l'effectif, parents de l'enfant.
 */
const HERO_PHOTO = { png: 'image/png', jpg: 'image/jpeg' };
const heroPhotoFile = (pid, ext) => join(UPLOADS, `player_${pid}_walkout.${ext}`);
const walkoutFiles = (pid) => Object.keys(HERO_PHOTO).map((e) => heroPhotoFile(pid, e));

/** Médias de l'entrée d'un joueur (URL) ; rien si l'autorisation photo est refusée. */
export function heroOf(p) {
  const w = p.walkout || {};
  if (p.info?.photoConsent === 'no') return null;
  if (!w.photo) return null;
  return { photo: `/api/players/${p.id}/walkout/photo?v=${w.photo.v}`, alpha: !!w.photo.alpha };
}

function editWalkout(req) {
  const row = playerAccess(req.user, req.params.id);
  if (isStaff(req.user)) need(req.user, 'players.manage');
  return row;
}

function saveWalkout(row, fn) {
  const data = JSON.parse(row.data);
  const w = { ...(data.walkout || {}) };
  fn(w);
  if (!w.photo) delete w.photo;
  delete w.video;
  if (Object.keys(w).length) data.walkout = w;
  else delete data.walkout;
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
}

const playerJson = (req, id) => playerOut(get('SELECT * FROM players WHERE id = ?', id), req.user, true);

playersApi.post('/players/:id/walkout/photo', (req, res) => {
  const row = editWalkout(req);
  const m = /^data:image\/(png|jpeg);base64,/.exec(String(req.body.image || ''));
  if (!m) throw new HttpError(400, 'Image invalide');
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const buf = decodeImage(req.body.image, 6_000_000);
  for (const e of Object.keys(HERO_PHOTO)) if (existsSync(heroPhotoFile(row.id, e))) unlinkSync(heroPhotoFile(row.id, e));
  writeFileSync(heroPhotoFile(row.id, ext), buf);
  saveWalkout(row, (w) => {
    w.photo = { v: now(), ext, alpha: ext === 'png' && !!req.body.alpha };
  });
  res.json(playerJson(req, row.id));
});

playersApi.delete('/players/:id/walkout/photo', (req, res) => {
  const row = editWalkout(req);
  for (const e of Object.keys(HERO_PHOTO)) if (existsSync(heroPhotoFile(row.id, e))) unlinkSync(heroPhotoFile(row.id, e));
  saveWalkout(row, (w) => delete w.photo);
  res.json(playerJson(req, row.id));
});

playersApi.get('/players/:id/walkout/photo', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  const ext = parse(row).walkout?.photo?.ext;
  if (!ext || !existsSync(heroPhotoFile(row.id, ext))) throw new HttpError(404, 'Photo introuvable');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(HERO_PHOTO[ext]).sendFile(heroPhotoFile(row.id, ext));
});

/* ------------------------------------------------------------------ tests mesurés */

playersApi.post('/players/:id/tests', (req, res) => {
  need(req.user, 'notes.write');
  const row = playerAccess(req.user, req.params.id);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const t = TESTS[req.body.key];
  const v = Number(req.body.value);
  if (!t || !Number.isFinite(v) || v < 0 || v > t.max) throw new HttpError(400, 'Mesure invalide');
  const data = JSON.parse(row.data);
  const profile = { ...(data.profile || {}) };
  const tests = { ...(profile.tests || {}) };
  tests[req.body.key] = [...(tests[req.body.key] || []), { at: todayYMD(), v: Math.round(v * 100) / 100 }].slice(-30);
  profile.tests = tests;
  data.profile = profile;
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});

playersApi.delete('/players/:id/tests/:key', (req, res) => {
  need(req.user, 'notes.write');
  const row = playerAccess(req.user, req.params.id);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const data = JSON.parse(row.data);
  const list = data.profile?.tests?.[req.params.key];
  if (list?.length) {
    list.pop();
    run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  }
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});
