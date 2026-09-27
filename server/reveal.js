/**
 * Cartes de fin de match : chaque enfant présent reçoit une carte façon « Ultimate Team »
 * (note générale, poste le plus joué, six statistiques) et une récompense.
 * Les parents les retournent une à une, dans l'app ou via un lien partagé sans compte.
 */
import { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { get, parse, UPLOADS } from './db.js';
import { childIdsFor, isStaff, need, needTeam, HttpError } from './auth.js';
import { occ, saveData, evTitle } from './convocations.js';
import { eventGroup } from './groups.js';
import { sign, verify } from './tokens.js';
import { toTeam } from './live.js';

export const AWARDS = {
  mvp: { label: 'Joueur du match', emoji: '⭐', tier: 'totw' },
  scorer: { label: 'Meilleur buteur', emoji: '⚽', tier: 'red' },
  assist: { label: 'Meilleur passeur', emoji: '🎯', tier: 'blue' },
  keeper: { label: 'Meilleur gardien', emoji: '🧤', tier: 'green' },
  wall: { label: 'Mur défensif', emoji: '🛡️', tier: 'silver' },
  engine: { label: 'Infatigable', emoji: '🔋', tier: 'gold' },
  fighter: { label: 'Guerrier du match', emoji: '🔥', tier: 'gold' },
  spirit: { label: 'Esprit d’équipe', emoji: '🤝', tier: 'gold' },
  dribbler: { label: 'Roi du dribble', emoji: '🌀', tier: 'gold' },
  progress: { label: 'Plus gros progrès', emoji: '📈', tier: 'gold' },
  heart: { label: 'Coup de cœur du coach', emoji: '❤️', tier: 'pink' },
  smile: { label: 'Sourire du match', emoji: '😄', tier: 'gold' },
};
const FILLERS = ['fighter', 'spirit', 'dribbler', 'progress', 'heart', 'smile', 'engine', 'wall'];

const count = (m, t, key, pid) => (m.events || []).filter((e) => e.t === t && e[key] === pid).length;

function mostUsed(roles) {
  const entries = Object.entries(roles || {}).filter(([, s]) => s > 0);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

const DEF_POS = new Set(['DG', 'DC', 'DD', 'MDC']);

/** Une récompense par enfant : buteur, passeur, gardien, défenseur, infatigable… puis les récompenses « cœur ». */
export function autoAwards(m, present) {
  const out = {};
  const free = () => present.filter((pid) => !out[pid]);
  const best = (score, key) => {
    const list = free().map((pid) => [pid, score(pid)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (list[0]) out[list[0][0]] = key;
  };
  best((pid) => count(m, 'goal', 'pid', pid), 'scorer');
  best((pid) => count(m, 'goal', 'assist', pid), 'assist');
  best((pid) => m.roles?.[pid]?.GB ?? 0, 'keeper');
  best((pid) => Object.entries(m.roles?.[pid] || {}).filter(([k]) => DEF_POS.has(k)).reduce((a, [, v]) => a + v, 0), 'wall');
  best((pid) => m.seconds?.[pid] ?? 0, 'engine');
  let i = 0;
  for (const pid of free()) {
    const used = new Set(Object.values(out));
    const key = FILLERS.find((k) => !used.has(k)) ?? FILLERS[i++ % FILLERS.length];
    out[pid] = key;
  }
  return out;
}

const clamp = (v) => Math.max(60, Math.min(99, Math.round(v)));

function card(p, m, awardKey, totalSec, photoUrl) {
  const r = p.profile?.ratings || {};
  const g = (...keys) => keys.reduce((a, k) => a + (r[k] || 3), 0) / keys.length;
  // Échelle généreuse : un 3/5 donne 80, un 5/5 donne 92.
  const to = (v) => 62 + v * 6;
  const goals = count(m, 'goal', 'pid', p.id);
  const assists = count(m, 'goal', 'assist', p.id);
  const seconds = m.seconds?.[p.id] ?? 0;
  const pos = mostUsed(m.roles?.[p.id]) || p.profile?.positions?.[0] || 'MC';
  const boost = (k) => (awardKey === k ? 3 : 0);
  const stats = pos === 'GB'
    ? [
        ['PLO', to(g('equilibre')) + 2 + boost('keeper')],
        ['JMA', to(g('controle'))],
        ['DÉG', to(g('frappe'))],
        ['RÉF', to(g('concentration')) + 2 + boost('keeper')],
        ['VIT', to(g('vitesse'))],
        ['PLA', to(g('placement'))],
      ]
    : [
        ['VIT', to(g('vitesse'))],
        ['TIR', to(g('frappe')) + goals * 3 + boost('scorer')],
        ['PAS', to(g('passe')) + assists * 3 + boost('assist')],
        ['DRI', to(g('dribble', 'conduite')) + boost('dribbler')],
        ['DEF', to(g('repli', 'placement')) + boost('wall')],
        ['PHY', to(g('endurance', 'equilibre', 'combativite')) + (seconds >= totalSec * 0.75 ? 2 : 0) + boost('engine')],
      ];
  const clamped = stats.map(([k, v]) => [k, clamp(v)]);
  const ovr = clamp(clamped.reduce((a, [, v]) => a + v, 0) / clamped.length + Math.min(3, goals) + (awardKey === 'mvp' ? 2 : 0));
  const award = AWARDS[awardKey] ?? AWARDS.spirit;
  return {
    id: p.id,
    firstName: p.firstName,
    number: p.number,
    photo: photoUrl,
    position: pos,
    ovr,
    stats: clamped,
    award: { key: awardKey, ...award },
    minutes: Math.round(seconds / 60),
    goals,
    assists,
  };
}

/** Cartes d'un match terminé. `publicToken` : lien sans compte (photos seulement si l'autorisation a été donnée). */
export function revealPayload(o, { user = null, publicToken = null } = {}) {
  const m = o.data.match;
  if (!m?.finished) throw new HttpError(404, 'Les cartes seront disponibles à la fin du match');
  const absent = new Set(m.absent || []);
  const present = (o.data.selection || []).filter((pid) => !absent.has(pid));
  const awards = { ...autoAwards(m, present), ...(o.data.awards || {}) };
  const totalSec = Math.max(1, Object.values(m.seconds || {}).reduce((a, b) => Math.max(a, b), 0));
  const kids = user && !isStaff(user) ? childIdsFor(user) : [];
  const team = get('SELECT category, color FROM teams WHERE id = ?', o.e.teamId);
  // Équipe U8/U9 : les cartes portent la catégorie du match.
  if (team && eventGroup(o.e)) team.category = eventGroup(o.e);
  const cards = present
    .map((pid) => {
      const row = get('SELECT * FROM players WHERE id = ?', pid);
      if (!row) return null;
      const p = parse(row);
      const consent = p.info?.photoConsent ?? '';
      const allowed = p.photo && (publicToken ? consent === 'yes' : consent !== 'no');
      const url = allowed ? (publicToken ? `/api/public/reveal/${publicToken}/photo/${pid}?v=${p.photo}` : `/api/players/${pid}/photo?v=${p.photo}`) : null;
      return { ...card(p, m, awards[pid], totalSec, url), mine: kids.includes(pid) };
    })
    .filter(Boolean);
  return {
    eventId: o.e.id,
    date: o.date,
    title: evTitle(o.e),
    opponent: o.e.opponent || '',
    venue: o.e.venue,
    team,
    club: get('SELECT name FROM club WHERE id = 1')?.name ?? '',
    score: { us: m.score?.us ?? 0, them: m.score?.them ?? 0 },
    summary: o.data.summary?.text ?? '',
    cards,
  };
}

export const revealLink = (eventId, date) => sign('reveal', eventId, date);

/* ------------------------------------------------------------------ routes */

export const revealPublic = Router();

revealPublic.get('/public/reveal/:token', (req, res) => {
  const [eventId, date] = verify('reveal', req.params.token);
  res.json(revealPayload(occ(eventId, date), { publicToken: req.params.token }));
});

revealPublic.get('/public/reveal/:token/photo/:pid', (req, res) => {
  const [eventId, date] = verify('reveal', req.params.token);
  const o = occ(eventId, date);
  const row = get('SELECT * FROM players WHERE id = ?', req.params.pid);
  if (!row || row.team_id !== o.e.teamId || !(o.data.selection || []).includes(row.id)) throw new HttpError(404, 'Photo introuvable');
  const p = parse(row);
  if (p.info?.photoConsent !== 'yes') throw new HttpError(404, 'Photo introuvable');
  sendPlayerPhoto(res, row.id);
});

export function sendPlayerPhoto(res, pid) {
  const file = join(UPLOADS, `player_${pid}.jpg`);
  if (!existsSync(file)) throw new HttpError(404, 'Photo introuvable');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('jpeg').sendFile(file);
}

export const revealApi = Router();

function teamOcc(req) {
  const o = occ(req.params.eventId, req.params.date);
  needTeam(req.user, o.e.teamId);
  if (!isStaff(req.user) && o.e.parents === false) throw new HttpError(404, 'Match introuvable');
  return o;
}

revealApi.get('/convocations/:eventId/:date/reveal', (req, res) => {
  const o = teamOcc(req);
  res.json({ ...revealPayload(o, { user: req.user }), shareToken: isStaff(req.user) ? revealLink(o.e.id, o.date) : null });
});

revealApi.put('/convocations/:eventId/:date/awards', (req, res) => {
  const o = teamOcc(req);
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  need(req.user, 'convocations.manage');
  const awards = {};
  for (const [pid, key] of Object.entries(req.body.awards || {})) if (AWARDS[key] && (o.data.selection || []).includes(pid)) awards[pid] = key;
  saveData(o, { awards });
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
  res.json({ ok: true });
});
