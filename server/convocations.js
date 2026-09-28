/**
 * Convocations : disponibilités demandées aux parents, relances, date limite de publication,
 * sélection équitable (métriques de temps de jeu), lecture par les parents, mode match et résumé.
 *
 * Une convocation porte sur une occurrence d'événement : (event_id, date).
 * Les réglages (quand demander, relancer, publier…) sont relatifs à la date du match,
 * ils s'appliquent donc aussi aux événements récurrents.
 */
import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, run, tx, parse, kvGet, kvSet } from './db.js';
import { can, need, needTeam, isStaff, childIdsFor, teamIdsFor, permsFor, newId, HttpError } from './auth.js';
import { at, occurrences, todayYMD, ymdAdd, seasonStart, shortDay, momentLabel, hm, dayLabel } from './occurrences.js';
import { notify } from './notify.js';
import { toTeam } from './live.js';
import { publicKey, saveSubscription } from './push.js';
import { AWARDS, autoAwards } from './reveal.js';
import { eventGroup, inGroup, teamInfo } from './groups.js';
import { pressSettings, warmPress } from './press.js';

export const CONV_TYPES = ['match', 'plateau', 'tournament'];

/** Réglages par défaut : pour un match le samedi, dispos le lundi, relance le mardi, convocation au plus tard le mercredi 20h. */
export const DEFAULT_SETTINGS = {
  request: { on: true, days: 5, time: '18:00' },
  reminders: [{ days: 4, time: '19:00' }],
  answerBy: { on: true, days: 3, time: '12:00' },
  deadline: { days: 3, time: '20:00' },
  coachAlert: 24,
  escalate: true,
  eve: { on: true, days: 1, time: '18:00' },
  squad: 10,
  onField: 8,
  periods: 2,
  periodMinutes: 25,
  stats: true,
  bring: 'Tenue du club, protège-tibias, gourde',
};

const BUILTIN_PRESETS = [
  { name: 'Match du week-end', isDefault: true, settings: {} },
  {
    name: 'Plateau (école de foot)',
    settings: { squad: 8, onField: 5, periods: 4, periodMinutes: 10, stats: false, reminders: [{ days: 4, time: '19:00' }, { days: 3, time: '18:00' }], answerBy: { on: true, days: 3, time: '12:00' } },
  },
  {
    name: 'Tournoi (prévu longtemps à l’avance)',
    settings: {
      request: { on: true, days: 14, time: '18:00' }, reminders: [{ days: 10, time: '19:00' }, { days: 8, time: '19:00' }],
      answerBy: { on: true, days: 7, time: '20:00' }, deadline: { days: 5, time: '20:00' }, coachAlert: 48, squad: 12,
    },
  },
];

const now = () => Date.now();
const clampInt = (v, min, max, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const hhmm = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? v : '');
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');

export function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const when = (w, dw) => ({
    on: w?.on !== undefined ? !!w.on : dw.on ?? true,
    days: clampInt(w?.days, 0, 30, dw.days),
    time: hhmm(w?.time) || dw.time,
  });
  const deadline = when(s.deadline, d.deadline);
  delete deadline.on;
  return {
    request: when(s.request, d.request),
    reminders: (Array.isArray(s.reminders) ? s.reminders : d.reminders).slice(0, 4).map((r) => ({
      days: clampInt(r?.days, 0, 30, 1),
      time: hhmm(r?.time) || '19:00',
    })),
    answerBy: when(s.answerBy, d.answerBy),
    deadline,
    coachAlert: clampInt(s.coachAlert, 0, 168, d.coachAlert),
    escalate: s.escalate !== undefined ? !!s.escalate : d.escalate,
    eve: when(s.eve, d.eve),
    squad: clampInt(s.squad, 1, 30, d.squad),
    onField: clampInt(s.onField, 1, 11, d.onField),
    periods: clampInt(s.periods, 1, 6, d.periods),
    periodMinutes: clampInt(s.periodMinutes, 1, 60, d.periodMinutes),
    stats: s.stats !== undefined ? !!s.stats : d.stats,
    bring: typeof s.bring === 'string' ? s.bring.trim().slice(0, 200) : d.bring,
  };
}

/* ------------------------------------------------------------------ réglages prédéfinis */

export function seedPresets() {
  if (get('SELECT id FROM conv_presets LIMIT 1')) return;
  for (const p of BUILTIN_PRESETS) {
    run(
      'INSERT INTO conv_presets VALUES (?, NULL, ?, ?, ?, ?, ?)',
      newId(), p.name, JSON.stringify(normalizeSettings(p.settings)), p.isDefault ? 1 : 0, now(), now(),
    );
  }
}

const presetOut = (r) => ({ id: r.id, teamId: r.team_id, name: r.name, isDefault: !!r.is_default, settings: normalizeSettings(JSON.parse(r.data)) });

/** Réglage par défaut d'une équipe : le sien, sinon celui du club, sinon le premier du club. */
function defaultPresetRow(teamId) {
  return (
    get('SELECT * FROM conv_presets WHERE team_id = ? AND is_default = 1', teamId) ??
    get('SELECT * FROM conv_presets WHERE team_id IS NULL AND is_default = 1') ??
    get('SELECT * FROM conv_presets WHERE team_id IS NULL ORDER BY created_at LIMIT 1')
  );
}

/** Convocation d'un événement : activée ? avec quels réglages ? */
export function convOf(e) {
  const c = e.conv || {};
  const enabled = c.enabled ?? CONV_TYPES.includes(e.type);
  let settings;
  let presetName = null;
  if (c.custom) settings = normalizeSettings(c.custom);
  else {
    const p = (c.presetId && get('SELECT * FROM conv_presets WHERE id = ?', c.presetId)) || defaultPresetRow(e.teamId);
    settings = p ? normalizeSettings(JSON.parse(p.data)) : normalizeSettings({});
    presetName = p?.name ?? null;
  }
  return { enabled, settings, presetId: c.presetId ?? null, custom: !!c.custom, presetName };
}

/** Valide le bloc `conv` envoyé avec un événement. */
export function cleanConv(c) {
  if (!c || typeof c !== 'object') return undefined;
  return {
    enabled: c.enabled === undefined ? undefined : !!c.enabled,
    presetId: typeof c.presetId === 'string' && c.presetId ? c.presetId.slice(0, 64) : null,
    custom: c.custom ? normalizeSettings(c.custom) : null,
  };
}

/* ------------------------------------------------------------------ calendrier d'une convocation */

export function timeline(e, date, s) {
  const start = at(date, 0, e.allDay || !e.time ? '09:00' : e.time);
  const deadline = Math.min(at(date, s.deadline.days, s.deadline.time), start);
  return {
    request: s.request.on ? Math.min(at(date, s.request.days, s.request.time), deadline) : null,
    reminders: s.reminders.map((r) => at(date, r.days, r.time)).filter((t) => t < deadline).sort((a, b) => a - b),
    answerBy: s.answerBy.on ? Math.min(at(date, s.answerBy.days, s.answerBy.time), deadline) : null,
    deadline,
    coachAlert: deadline - s.coachAlert * 3600e3,
    eve: s.eve.on ? at(date, s.eve.days || 1, s.eve.time) : null,
    start,
  };
}

const TYPE_LABEL = { match: 'Match', plateau: 'Plateau', tournament: 'Tournoi', training: 'Entraînement', meeting: 'Réunion', other: 'Événement' };
export function evTitle(e) {
  if (e.title) return e.title;
  if (e.type === 'match' && e.opponent) return `Match ${e.venue === 'away' ? 'à' : 'contre'} ${e.opponent}`;
  if (e.type === 'plateau' && gamesOf(e)) return e.organizer ? `Plateau à ${e.organizer}` : e.venue === 'home' ? 'Plateau à domicile' : 'Plateau';
  return TYPE_LABEL[e.type] || 'Événement';
}

/** Club qui organise le match : le nôtre à domicile, sinon celui indiqué (ou l'adversaire). */
export function organizerOf(e) {
  if (e.organizer) return e.organizer;
  if (e.venue === 'home') return get('SELECT name FROM club WHERE id = 1')?.name ?? '';
  // Plateau : l'adversaire est la liste des équipes invitées, pas l'organisateur.
  return gamesOf(e) ? '' : e.opponent || '';
}

/** Plateau : les matchs prévus (adversaire, heure, durée), s'il y en a. */
export const gamesOf = (e) => (Array.isArray(e?.games) && e.games.length ? e.games : null);

/**
 * Résultat de chaque match d'un plateau : les matchs terminés (m.results), puis celui en cours.
 * null pour un match simple.
 */
export function gameResults(e, m) {
  const games = gamesOf(e);
  if (!games) return null;
  const results = m?.results || [];
  const current = m && !m.finished && m.started ? (m.period || 1) - 1 : -1;
  return games.map((g, i) => {
    const r = results[i] ?? (i === current ? m.score : null);
    return { id: g.id, opponent: g.opponent, time: g.time || '', us: r ? r.us ?? 0 : null, them: r ? r.them ?? 0 : null, live: i === current && !results[i] };
  });
}

/** « 2 victoires · 1 nul · 1 défaite » pour un plateau terminé. */
export function plateauRecord(games) {
  const played = (games || []).filter((g) => g.us !== null);
  const n = (f) => played.filter(f).length;
  const w = n((g) => g.us > g.them);
  const d = n((g) => g.us === g.them);
  const l = n((g) => g.us < g.them);
  const part = (k, one, many) => (k ? `${k} ${k > 1 ? many : one}` : null);
  return [part(w, 'victoire', 'victoires'), part(d, 'nul', 'nuls'), part(l, 'défaite', 'défaites')].filter(Boolean).join(' · ') || `${played.length} matchs`;
}

export function loadEvent(id) {
  const r = get('SELECT * FROM events WHERE id = ?', id);
  return r ? { ...JSON.parse(r.data), id: r.id, teamId: r.team_id } : null;
}

function convRow(eventId, date) {
  return get('SELECT * FROM convocations WHERE event_id = ? AND date = ?', eventId, date);
}

/** Tout le contexte d'une occurrence. Lève 404 si l'événement n'a pas lieu ce jour-là. */
export function occ(eventId, date) {
  const e = loadEvent(eventId);
  if (!e || !ymd(date) || !occurrences(e, date, date).length) throw new HttpError(404, 'Match introuvable');
  const c = convOf(e);
  const row = convRow(eventId, date);
  const data = row ? JSON.parse(row.data) : {};
  return { e, date, ...c, t: timeline(e, date, c.settings), row, data };
}

export function saveData(o, patch = {}) {
  const data = { ...o.data, ...patch };
  if (o.row) run('UPDATE convocations SET data = ?, updated_at = ? WHERE event_id = ? AND date = ?', JSON.stringify(data), now(), o.e.id, o.date);
  else run('INSERT INTO convocations VALUES (?, ?, ?, ?, NULL, ?)', o.e.id, o.date, o.e.teamId, JSON.stringify(data), now());
  o.row = convRow(o.e.id, o.date);
  o.data = data;
  return data;
}

/** Étape de la convocation. */
function phaseOf(o, t = now()) {
  if (o.row?.published_at) return o.data.match?.finished || t > o.t.start + 4 * 3600e3 ? 'played' : 'published';
  if (t > o.t.start) return 'missed';
  if (t > o.t.deadline) return 'late';
  if ((o.t.request && t >= o.t.request) || jobSent(o, 'request')) return 'collecting';
  return 'upcoming';
}

const jobSent = (o, job) => !!get('SELECT 1 FROM conv_jobs WHERE event_id = ? AND date = ? AND job = ?', o.e.id, o.date, job);
const markJob = (o, job) => run('INSERT OR IGNORE INTO conv_jobs VALUES (?, ?, ?, ?)', o.e.id, o.date, job, now());

/* ------------------------------------------------------------------ personnes */

export function teamPlayers(teamId) {
  return all('SELECT * FROM players WHERE team_id = ?', teamId)
    .map((r) => ({ ...parse(r), createdAt: r.created_at }))
    .sort((a, b) => (a.firstName || '').localeCompare(b.firstName || '', 'fr'));
}

/** Joueurs concernés par une occurrence : ceux de la catégorie du match (U8 ou U9), ou toute l'équipe. */
export function occPlayers(o, players = teamPlayers(o.e.teamId)) {
  const g = eventGroup(o.e);
  return g ? players.filter((p) => inGroup(p, o.e.teamId, g)) : players;
}

export function parentsOf(playerId) {
  return all(
    `SELECT u.id, u.name FROM player_parents pp JOIN users u ON u.id = pp.user_id WHERE pp.player_id = ? AND u.status = 'active'`,
    playerId,
  );
}

export function staffOf(teamId) {
  return all(`SELECT u.id FROM team_staff s JOIN users u ON u.id = s.user_id WHERE s.team_id = ? AND u.status = 'active'`, teamId).map((r) => r.id);
}

/** Responsables du club à prévenir en cas de retard. */
function clubLeads() {
  return all(`SELECT id, role FROM users WHERE role IN ('admin', 'dirigeant') AND status = 'active'`)
    .filter((u) => u.role === 'admin' || permsFor(u.role).includes('club.dashboard'))
    .map((u) => u.id);
}

const pushCount = (userId) => get('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?', userId).n;

export function availabilityOf(o) {
  const map = {};
  for (const a of all(
    'SELECT a.*, u.name by_name FROM availability a LEFT JOIN users u ON u.id = a.by_user WHERE event_id = ? AND date = ?',
    o.e.id, o.date,
  )) {
    map[a.player_id] = { status: a.status, note: a.note, at: a.updated_at, by: a.by_name ?? null };
  }
  return map;
}

/* ------------------------------------------------------------------ jetons de réponse sans connexion */

export function secret() {
  let s = kvGet('answer_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    kvSet('answer_secret', s);
  }
  return s;
}

export function answerToken(playerId, eventId, date) {
  const payload = Buffer.from(`${playerId}|${eventId}|${date}`).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 22);
  return `${payload}.${sig}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) throw new HttpError(404, 'Lien invalide');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 22);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new HttpError(404, 'Lien invalide');
  const [playerId, eventId, date] = Buffer.from(payload, 'base64url').toString().split('|');
  return { playerId, eventId, date };
}

/* ------------------------------------------------------------------ messages */

export const meetOf = (o) => o.data.meetTime || o.e.meetTime || '';
export const bringOf = (o) => (o.data.bring ?? '') || o.settings.bring;

function whereLine(o) {
  const meet = meetOf(o);
  const parts = [];
  if (meet) parts.push(`RDV ${hm(meet)}`);
  else if (o.e.time) parts.push(`Coup d'envoi ${hm(o.e.time)}`);
  if (o.e.location) parts.push(o.e.location);
  return parts.join(' · ');
}

export const matchUrl = (o) => `/matchs/${o.e.id}/${o.date}`;

function sendRequest(o, players, onlyMissing) {
  const avail = availabilityOf(o);
  let n = 0;
  const title = `⚽ ${evTitle(o.e)} · ${shortDay(o.date)}`;
  for (const p of players) {
    if (onlyMissing && avail[p.id]) continue;
    const parents = parentsOf(p.id).map((u) => u.id);
    if (!parents.length) continue;
    const by = o.t.answerBy ? ` Réponse souhaitée avant ${momentLabel(o.t.answerBy)}.` : '';
    n += notify(parents, {
      kind: onlyMissing ? 'reminder' : 'request',
      title: onlyMissing ? `On attend votre réponse pour ${p.firstName}` : title,
      body: onlyMissing
        ? `${evTitle(o.e)}, ${dayLabel(o.date)} : ${p.firstName} sera là ?${by}`
        : `${p.firstName} sera là ?${by} Convocation au plus tard ${momentLabel(o.t.deadline)}.`,
      url: matchUrl(o),
      tag: `conv-${o.e.id}-${o.date}-${p.id}`,
      actions: [{ action: 'yes', title: '✅ Présent' }, { action: 'no', title: '❌ Absent' }],
      answerToken: answerToken(p.id, o.e.id, o.date),
    });
  }
  return n;
}

/* ------------------------------------------------------------------ métriques d'équité */

/**
 * Bilan de la saison par joueur : convocations, matchs joués, non retenu, indisponible,
 * absent sans prévenir, minutes, titularisations, buts. `excludeKey` ignore une occurrence (celle qu'on prépare).
 */
export function teamStats(teamId, excludeKey = null, group = null) {
  const players = teamPlayers(teamId).filter((p) => inGroup(p, teamId, group));
  const today = todayYMD();
  // Chaque catégorie a ses propres matchs : un match U9 ne compte pas dans l'équité des U8.
  const groupOfEvent = new Map(all('SELECT id, data FROM events WHERE team_id = ?', teamId).map((r) => [r.id, eventGroup({ ...JSON.parse(r.data), teamId })]));
  const rows = all(
    `SELECT * FROM convocations WHERE team_id = ? AND published_at IS NOT NULL AND date >= ? ORDER BY date`,
    teamId, seasonStart(),
  ).filter((r) => !group || !groupOfEvent.get(r.event_id) || groupOfEvent.get(r.event_id) === group);
  const avail = new Map();
  for (const a of all(
    'SELECT a.* FROM availability a JOIN events e ON e.id = a.event_id WHERE e.team_id = ? AND a.date >= ?',
    teamId, seasonStart(),
  )) avail.set(`${a.event_id}|${a.date}|${a.player_id}`, a.status);

  const st = {};
  for (const p of players) {
    st[p.id] = {
      matches: 0, convoked: 0, played: 0, notSelected: 0, unavailable: 0, noShow: 0, minutes: 0, starts: 0,
      goals: 0, assists: 0, upcoming: 0, lastPlayed: null, lastNotSelected: null, streakOut: 0,
    };
  }
  let matches = 0;
  let lastDate = null;
  for (const r of rows) {
    if (`${r.event_id}|${r.date}` === excludeKey) continue;
    const d = JSON.parse(r.data);
    const sel = new Set(d.selection || []);
    const past = r.date < today || d.match?.finished;
    if (!past) {
      for (const pid of sel) if (st[pid]) st[pid].upcoming++;
      continue;
    }
    matches++;
    lastDate = r.date;
    const absent = new Set(d.match?.absent || []);
    const starters = new Set(d.match?.starters || []);
    const g = groupOfEvent.get(r.event_id);
    for (const p of players) {
      if (!inGroup(p, teamId, g)) continue;
      // Un joueur arrivé en cours de saison n'est pas compté sur les matchs d'avant son arrivée.
      if (p.createdAt > new Date(`${r.date}T23:59`).getTime()) continue;
      const s = st[p.id];
      s.matches++;
      if (sel.has(p.id)) {
        s.convoked++;
        if (absent.has(p.id)) s.noShow++;
        else {
          s.played++;
          s.streakOut = 0;
          s.minutes += Math.round((d.match?.seconds?.[p.id] || 0) / 60);
          if (starters.has(p.id)) s.starts++;
          s.lastPlayed = r.date;
        }
      } else if (avail.get(`${r.event_id}|${r.date}|${p.id}`) === 'no') s.unavailable++;
      else {
        s.notSelected++;
        s.streakOut++;
        s.lastNotSelected = r.date;
      }
    }
    for (const ev of d.match?.events || []) {
      if (ev.t === 'goal' && ev.pid && st[ev.pid]) st[ev.pid].goals++;
      if (ev.t === 'goal' && ev.assist && st[ev.assist]) st[ev.assist].assists++;
    }
  }

  // Part de matchs joués parmi ceux où le joueur était disponible.
  const shares = [];
  let playedSum = 0;
  let counted = 0;
  const minuteRates = [];
  for (const p of players) {
    const s = st[p.id];
    s.opportunities = Math.max(0, s.matches - s.unavailable);
    s.share = s.opportunities ? s.played / s.opportunities : null;
    s.minutesPerMatch = s.played ? Math.round(s.minutes / s.played) : null;
    if (s.matches) {
      playedSum += s.played;
      counted++;
    }
    if (s.share !== null) shares.push(s.share);
    if (s.minutesPerMatch !== null && s.minutes > 0) minuteRates.push(s.minutesPerMatch);
  }
  const mean = counted ? playedSum / counted : 0;
  const index = (arr) => {
    if (arr.length < 2) return null;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!m) return null;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
    return Math.max(0, Math.round(100 * (1 - sd / m)));
  };
  const avgMinutes = minuteRates.length ? minuteRates.reduce((a, b) => a + b, 0) / minuteRates.length : null;
  for (const p of players) st[p.id].delta = st[p.id].matches ? +(st[p.id].played - mean).toFixed(1) : 0;
  return { matches, mean: +mean.toFixed(1), equity: index(shares), minutesEquity: index(minuteRates), avgMinutes: avgMinutes && Math.round(avgMinutes), lastDate, players: st };
}

/** Sélection proposée : disponibles d'abord, puis ceux qui ont le moins joué. */
function suggest(players, stats, avail, squad) {
  const rank = { yes: 0, maybe: 1 };
  const reasons = {};
  const scored = players
    .filter((p) => avail[p.id]?.status !== 'no')
    .map((p) => {
      const s = stats.players[p.id];
      return { p, s, a: rank[avail[p.id]?.status] ?? 2, load: s.played + s.upcoming };
    })
    .sort((x, y) =>
      x.a - y.a || x.load - y.load || y.s.notSelected - x.s.notSelected || y.s.streakOut - x.s.streakOut ||
      (x.s.minutes || 0) - (y.s.minutes || 0) || (x.s.lastPlayed || '').localeCompare(y.s.lastPlayed || ''),
    );
  for (const p of players) {
    const s = stats.players[p.id];
    const r = [];
    const gap = stats.mean - s.played;
    if (s.matches && gap >= 0.95) r.push({ tone: 'up', text: `${Math.round(gap)} match${Math.round(gap) > 1 ? 's' : ''} de moins que la moyenne` });
    if (s.streakOut >= 2) r.push({ tone: 'up', text: `Non retenu ${s.streakOut} fois de suite` });
    else if (s.lastNotSelected && s.lastNotSelected === stats.lastDate) r.push({ tone: 'up', text: 'Non retenu au dernier match' });
    if (stats.avgMinutes && s.minutesPerMatch !== null && s.minutesPerMatch < stats.avgMinutes * 0.75) r.push({ tone: 'up', text: `Peu de temps de jeu (${s.minutesPerMatch} min/match)` });
    if (s.matches && gap <= -0.95) r.push({ tone: 'down', text: `${Math.round(-gap)} match${Math.round(-gap) > 1 ? 's' : ''} de plus que la moyenne` });
    if (s.upcoming) r.push({ tone: 'down', text: 'Déjà convoqué pour un autre match à venir' });
    reasons[p.id] = r;
  }
  return { ids: scored.slice(0, squad).map((x) => x.p.id), order: scored.map((x) => x.p.id), reasons };
}

/* ------------------------------------------------------------------ vues */

function eventInfo(o) {
  const e = o.e;
  return {
    eventId: e.id, date: o.date, teamId: e.teamId, type: e.type, title: evTitle(e), group: eventGroup(e),
    organizer: organizerOf(e), logo: e.logo ? `/api/events/${e.id}/logo?v=${e.logo}` : null, time: e.allDay ? '' : e.time, endTime: e.endTime,
    meetTime: meetOf(o), location: e.location, opponent: e.opponent, venue: e.venue, color: e.color, bring: bringOf(o), message: o.data.message || '',
    games: gamesOf(e),
  };
}

/** Résumé d'une convocation pour les listes (éducateurs). */
function snapshot(o, all_ = teamPlayers(o.e.teamId)) {
  const players = occPlayers(o, all_);
  const avail = availabilityOf(o);
  const counts = { yes: 0, maybe: 0, no: 0, none: 0 };
  for (const p of players) counts[avail[p.id]?.status ?? 'none']++;
  const parentIds = new Set();
  const convokedParents = new Set();
  const sel = new Set(o.data.selection || []);
  for (const p of players) {
    for (const u of parentsOf(p.id)) {
      parentIds.add(u.id);
      if (sel.has(p.id)) convokedParents.add(u.id);
    }
  }
  const reads = o.row?.published_at
    ? all('SELECT user_id FROM conv_reads WHERE event_id = ? AND date = ?', o.e.id, o.date).filter((r) => parentIds.has(r.user_id)).length
    : 0;
  const m = o.data.match;
  return {
    ...eventInfo(o),
    phase: phaseOf(o),
    timeline: o.t,
    squad: o.settings.squad,
    selected: sel.size,
    counts,
    total: players.length,
    publishedAt: o.row?.published_at ?? null,
    publishedLate: o.row?.published_at ? o.row.published_at > o.t.deadline : null,
    reads,
    readers: parentIds.size,
    score: m && (m.started || m.finished) ? { us: m.score?.us ?? 0, them: m.score?.them ?? 0, finished: !!m.finished, games: gameResults(o.e, m) } : null,
    presetName: o.presetName,
  };
}

/** Détail complet pour l'éducateur. */
function detail(o) {
  const players = occPlayers(o);
  const avail = availabilityOf(o);
  const stats = teamStats(o.e.teamId, `${o.e.id}|${o.date}`, eventGroup(o.e));
  const sug = suggest(players, stats, avail, o.settings.squad);
  const sel = new Set(o.data.selection || []);
  const reads = Object.fromEntries(all('SELECT user_id, read_at FROM conv_reads WHERE event_id = ? AND date = ?', o.e.id, o.date).map((r) => [r.user_id, r.read_at]));
  return {
    ...snapshot(o, players),
    settings: o.settings,
    custom: o.custom,
    presetId: o.presetId,
    selection: [...sel],
    suggestion: sug.ids,
    stats: { matches: stats.matches, mean: stats.mean, equity: stats.equity, minutesEquity: stats.minutesEquity, avgMinutes: stats.avgMinutes },
    match: o.data.match ?? null,
    summary: o.data.summary ?? null,
    awards: o.data.awards ?? null,
    requestSent: jobSent(o, 'request'),
    players: players.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName ?? '',
      number: p.number,
      positions: p.profile?.positions ?? [],
      availability: avail[p.id] ?? null,
      selected: sel.has(p.id),
      notified: o.data.notified?.[p.id] ?? null,
      metrics: stats.players[p.id],
      reasons: sug.reasons[p.id] ?? [],
      rank: sug.order.indexOf(p.id),
      answerToken: answerToken(p.id, o.e.id, o.date),
      parents: parentsOf(p.id).map((u) => ({ id: u.id, name: u.name, readAt: reads[u.id] ?? null, push: pushCount(u.id) > 0 })),
    })),
  };
}

/** Billet d'un enfant pour un match (vue parent). */
function ticket(o, child, user) {
  const avail = availabilityOf(o)[child.id] ?? null;
  const published = !!o.row?.published_at;
  const sel = new Set(o.data.selection || []);
  const phase = phaseOf(o);
  let status;
  if (published) status = sel.has(child.id) ? 'convoked' : 'not_selected';
  else if (now() > o.t.start) status = 'past';
  else status = avail ? 'answered' : 'to_answer';
  const m = o.data.match;
  const players = published ? occPlayers(o).filter((p) => sel.has(p.id)) : [];
  const goals = (m?.events || []).filter((ev) => ev.t === 'goal' && ev.pid === child.id).length;
  return {
    key: `${o.e.id}:${o.date}:${child.id}`,
    ...eventInfo(o),
    child: { id: child.id, firstName: child.firstName },
    status,
    phase,
    availability: avail,
    timeline: { request: o.t.request, answerBy: o.t.answerBy, deadline: o.t.deadline, start: o.t.start },
    publishedAt: o.row?.published_at ?? null,
    press: pressSettings().enabled,
    read: published ? !!get('SELECT 1 FROM conv_reads WHERE event_id = ? AND date = ? AND user_id = ?', o.e.id, o.date, user.id) : false,
    squad: players.map((p) => ({ id: p.id, firstName: p.firstName, number: p.number })),
    result: m?.finished
      ? {
          us: m.score?.us ?? 0, them: m.score?.them ?? 0,
          minutes: sel.has(child.id) && !(m.absent || []).includes(child.id) ? Math.round((m.seconds?.[child.id] || 0) / 60) : null,
          goals: o.settings.stats ? goals : null,
          summary: o.data.summary?.text ?? '',
          games: gameResults(o.e, m),
        }
      : null,
  };
}

/** Occurrences avec convocation d'une équipe entre deux dates. */
function teamOccurrences(teamId, from, to) {
  const out = [];
  for (const r of all('SELECT * FROM events WHERE team_id = ?', teamId)) {
    const e = { ...JSON.parse(r.data), id: r.id, teamId: r.team_id };
    const c = convOf(e);
    if (!c.enabled) continue;
    for (const date of occurrences(e, from, to)) {
      const row = convRow(e.id, date);
      out.push({ e, date, ...c, t: timeline(e, date, c.settings), row, data: row ? JSON.parse(row.data) : {} });
    }
  }
  return out.sort((a, b) => a.t.start - b.t.start);
}

/* ------------------------------------------------------------------ tâches planifiées */

function runJobs() {
  const t = now();
  const today = todayYMD();
  for (const r of all('SELECT * FROM events')) {
    const e = { ...JSON.parse(r.data), id: r.id, teamId: r.team_id };
    const c = convOf(e);
    if (!c.enabled || e.parents === false) continue;
    for (const date of occurrences(e, today, ymdAdd(today, 35))) {
      const row = convRow(e.id, date);
      const o = { e, date, ...c, t: timeline(e, date, c.settings), row, data: row ? JSON.parse(row.data) : {} };
      if (t >= o.t.start) continue;
      const published = !!row?.published_at;
      const once = (job, fn) => {
        if (jobSent(o, job)) return;
        markJob(o, job);
        try {
          fn();
        } catch (err) {
          console.error(`Tâche ${job} (${e.id} ${date}) :`, err);
        }
      };
      const players = () => occPlayers(o);
      if (!published && o.t.request && t >= o.t.request && t < o.t.deadline) once('request', () => sendRequest(o, players(), false));
      o.t.reminders.forEach((at, i) => {
        if (!published && t >= at && t < o.t.deadline && jobSent(o, 'request')) once(`reminder:${i}`, () => sendRequest(o, players(), true));
      });
      if (!published && t >= o.t.coachAlert && t < o.t.deadline) {
        once('coach_alert', () => {
          const s = snapshot(o);
          notify(staffOf(e.teamId), {
            kind: 'coach_alert',
            title: `Convocation à publier avant ${momentLabel(o.t.deadline)}`,
            body: `${evTitle(e)} (${shortDay(date)}) · ${s.counts.yes + s.counts.maybe + s.counts.no}/${s.total} réponses des parents.`,
            url: matchUrl(o),
          });
        });
      }
      if (!published && t >= o.t.deadline) {
        once('late', () => {
          const team = get('SELECT category FROM teams WHERE id = ?', e.teamId)?.category ?? '';
          const n = {
            kind: 'late',
            title: `⚠️ Convocation ${team} en retard`,
            body: `${evTitle(e)} ${shortDay(date)} : la date limite (${momentLabel(o.t.deadline)}) est dépassée.`,
            url: matchUrl(o),
          };
          notify(o.settings.escalate ? [...staffOf(e.teamId), ...clubLeads()] : staffOf(e.teamId), n);
        });
      }
      if (published && o.t.eve && t >= o.t.eve) {
        once('eve', () => {
          const sel = new Set(o.data.selection || []);
          for (const p of players().filter((p) => sel.has(p.id))) {
            notify(parentsOf(p.id).map((u) => u.id), {
              kind: 'eve',
              title: `${shortDay(date) === 'demain' ? 'Demain' : 'Bientôt'} : ${evTitle(e)}`,
              body: `${p.firstName} est dans le groupe. ${whereLine(o)}. ${bringOf(o)}`.trim(),
              url: matchUrl(o),
            });
          }
        });
      }
    }
  }
}

export function startScheduler() {
  const tick = () => {
    try {
      runJobs();
    } catch (e) {
      console.error('Planificateur des convocations :', e);
    }
  };
  setTimeout(tick, 4000);
  setInterval(tick, 60_000);
}

/* ------------------------------------------------------------------ routes publiques */

export const convPublic = Router();

function publicAnswerView(token) {
  const { playerId, eventId, date } = readToken(token);
  const o = occ(eventId, date);
  const p = get('SELECT * FROM players WHERE id = ?', playerId);
  if (!p || p.team_id !== o.e.teamId) throw new HttpError(404, 'Lien invalide');
  const child = parse(p);
  const team = get('SELECT category, color FROM teams WHERE id = ?', o.e.teamId);
  return { o, child, view: { ...eventInfo(o), team, club: get('SELECT name FROM club WHERE id = 1')?.name ?? '', child: { firstName: child.firstName }, availability: availabilityOf(o)[playerId] ?? null, published: !!o.row?.published_at, convoked: (o.data.selection || []).includes(playerId), timeline: { answerBy: o.t.answerBy, deadline: o.t.deadline, start: o.t.start }, closed: now() > o.t.start } };
}

convPublic.get('/public/answer/:token', (req, res) => {
  res.json(publicAnswerView(req.params.token).view);
});

convPublic.post('/public/answer/:token', (req, res) => {
  const { o, child } = publicAnswerView(req.params.token);
  setAvailability(o, child.id, req.body.status, str(req.body.note, 200), req.user?.id ?? null);
  res.json(publicAnswerView(req.params.token).view);
});

function setAvailability(o, playerId, status, note, userId) {
  if (!['yes', 'no', 'maybe'].includes(status)) throw new HttpError(400, 'Réponse invalide');
  if (now() > o.t.start) throw new HttpError(400, 'Le match a déjà eu lieu');
  run(
    `INSERT INTO availability VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, date, player_id) DO UPDATE SET status = excluded.status, note = excluded.note, by_user = excluded.by_user, updated_at = excluded.updated_at`,
    o.e.id, o.date, playerId, status, note, userId, now(),
  );
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
}

/* ------------------------------------------------------------------ routes (connecté) */

export const convApi = Router();

function staffOcc(req, write = false) {
  const o = occ(req.params.eventId, req.params.date);
  needTeam(req.user, o.e.teamId, { staff: true });
  if (write) need(req.user, 'convocations.manage');
  return o;
}

convApi.get('/teams/:teamId/convocations', (req, res) => {
  needTeam(req.user, req.params.teamId, { staff: true });
  const today = todayYMD();
  const from = req.query.past ? seasonStart() : ymdAdd(today, -45);
  const players = teamPlayers(req.params.teamId);
  const group = teamInfo(req.params.teamId).groups.includes(req.query.group) ? req.query.group : null;
  const list = teamOccurrences(req.params.teamId, from, ymdAdd(today, 60)).filter((o) => !group || !eventGroup(o.e) || eventGroup(o.e) === group);
  res.json(list.map((o) => snapshot(o, players)));
});

convApi.get('/teams/:teamId/stats', (req, res) => {
  needTeam(req.user, req.params.teamId, { staff: true });
  const group = teamInfo(req.params.teamId).groups.includes(req.query.group) ? req.query.group : null;
  const s = teamStats(req.params.teamId, null, group);
  const players = teamPlayers(req.params.teamId).filter((p) => inGroup(p, req.params.teamId, group)).map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName ?? '', number: p.number, ...s.players[p.id] }));
  res.json({ ...s, players });
});

convApi.get('/convocations/:eventId/:date', (req, res) => {
  const o = occ(req.params.eventId, req.params.date);
  if (isStaff(req.user)) {
    needTeam(req.user, o.e.teamId, { staff: true });
    return res.json({ kind: 'staff', ...detail(o) });
  }
  // Parent : un billet par enfant de l'équipe.
  const kids = childIdsFor(req.user);
  const children = occPlayers(o).filter((p) => kids.includes(p.id));
  if (!children.length || o.e.parents === false) throw new HttpError(404, 'Match introuvable');
  res.json({ kind: 'parent', tickets: children.map((c) => ticket(o, c, req.user)) });
});

convApi.put('/convocations/:eventId/:date', (req, res) => {
  const o = staffOcc(req, true);
  const ids = new Set(occPlayers(o).map((p) => p.id));
  const patch = {};
  if (Array.isArray(req.body.selection)) patch.selection = [...new Set(req.body.selection.filter((id) => ids.has(id)))];
  if (req.body.message !== undefined) patch.message = str(req.body.message, 1000);
  if (req.body.meetTime !== undefined) patch.meetTime = hhmm(req.body.meetTime);
  if (req.body.bring !== undefined) patch.bring = str(req.body.bring, 200);
  saveData(o, patch);
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date }, req.get('X-Client-Id'));
  res.json(detail(o));
});

convApi.post('/convocations/:eventId/:date/publish', (req, res) => {
  const o = staffOcc(req, true);
  const players = occPlayers(o);
  const sel = new Set(o.data.selection || []);
  if (!sel.size) throw new HttpError(400, 'Sélectionnez au moins un joueur');
  const first = !o.row?.published_at;
  const notified = { ...(o.data.notified || {}) };
  let sent = 0;
  // Toutes les familles reçoivent la même notification : elle ouvre la conférence de presse, qui annonce le groupe.
  // Le prénom convoqué (ou non) n'est jamais écrit dans la notification : la cinématique garde la surprise.
  const press = pressSettings().enabled;
  const group = eventGroup(o.e) ?? get('SELECT category FROM teams WHERE id = ?', o.e.teamId)?.category ?? '';
  tx(() => {
    for (const p of players) {
      const state = sel.has(p.id) ? 'in' : 'out';
      if (notified[p.id] === state) continue;
      notified[p.id] = state;
      const parents = parentsOf(p.id).map((u) => u.id);
      // Changement : les parents concernés doivent relire la convocation.
      for (const uid of parents) run('DELETE FROM conv_reads WHERE event_id = ? AND date = ? AND user_id = ?', o.e.id, o.date, uid);
      if (!parents.length || o.e.parents === false) continue;
      const change = !first ? 'Mise à jour : ' : '';
      sent += notify(parents, press
        ? {
            kind: 'convocation',
            title: `${change}🎙️ Conférence de presse : la convocation ${group} est tombée`,
            body: `${evTitle(o.e)} ${shortDay(o.date)} · Lancez la vidéo pour découvrir le groupe !`,
            url: `${matchUrl(o)}/conference`,
            tag: `conv-${o.e.id}-${o.date}-${p.id}`,
          }
        : {
            kind: 'convocation',
            title: `${change}📣 La convocation ${group} est tombée`,
            body: `${evTitle(o.e)} ${shortDay(o.date)} · Découvrez le groupe.`,
            url: matchUrl(o),
            tag: `conv-${o.e.id}-${o.date}-${p.id}`,
          });
    }
    saveData(o, { notified });
    if (first) run('UPDATE convocations SET published_at = ? WHERE event_id = ? AND date = ?', now(), o.e.id, o.date);
    o.row = convRow(o.e.id, o.date);
  });
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
  // Les voix de la conférence de presse se génèrent maintenant : les familles qui ouvrent la notification n'attendent pas.
  warmPress(o);
  res.json({ ...detail(o), sent });
});

convApi.post('/convocations/:eventId/:date/request', (req, res) => {
  const o = staffOcc(req, true);
  const onlyMissing = jobSent(o, 'request') || !!req.body.onlyMissing;
  const sent = sendRequest(o, occPlayers(o), onlyMissing);
  markJob(o, 'request');
  res.json({ sent, reminder: onlyMissing });
});

convApi.put('/convocations/:eventId/:date/availability/:playerId', (req, res) => {
  const o = occ(req.params.eventId, req.params.date);
  const pid = req.params.playerId;
  const p = get('SELECT team_id FROM players WHERE id = ?', pid);
  if (!p || p.team_id !== o.e.teamId || !occPlayers(o).some((x) => x.id === pid)) throw new HttpError(404, 'Joueur introuvable');
  if (isStaff(req.user)) {
    needTeam(req.user, o.e.teamId, { staff: true });
    need(req.user, 'convocations.manage');
    if (req.body.status === null) {
      run('DELETE FROM availability WHERE event_id = ? AND date = ? AND player_id = ?', o.e.id, o.date, pid);
      toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
      return res.json({ ok: true });
    }
  } else if (!childIdsFor(req.user).includes(pid)) throw new HttpError(404, 'Joueur introuvable');
  setAvailability(o, pid, req.body.status, str(req.body.note, 200), req.user.id);
  res.json({ ok: true });
});

convApi.post('/convocations/:eventId/:date/read', (req, res) => {
  const o = occ(req.params.eventId, req.params.date);
  if (!isStaff(req.user) && o.row?.published_at) {
    const kids = childIdsFor(req.user);
    if (occPlayers(o).some((p) => kids.includes(p.id))) {
      run('INSERT OR IGNORE INTO conv_reads VALUES (?, ?, ?, ?)', o.e.id, o.date, req.user.id, now());
      toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
    }
  }
  res.json({ ok: true });
});

/** État du mode match (composition, chrono, changements, temps de jeu, buts). */
convApi.put('/convocations/:eventId/:date/match', (req, res) => {
  const o = staffOcc(req, true);
  const m = req.body;
  if (!m || typeof m !== 'object') throw new HttpError(400, 'État invalide');
  const json = JSON.stringify(m);
  if (json.length > 200_000) throw new HttpError(413, 'État trop volumineux');
  saveData(o, { match: { ...m, finished: !!o.data.match?.finished && m.finished !== false ? true : !!m.finished } });
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date }, req.get('X-Client-Id'));
  res.json({ ok: true });
});

/** Fin du match : le résumé part aux parents (score, temps de jeu de leur enfant, mot du coach). */
convApi.post('/convocations/:eventId/:date/finish', (req, res) => {
  const o = staffOcc(req, true);
  const m = { ...(o.data.match || {}), ...(req.body.match || {}), finished: true };
  const text = str(req.body.text, 1500);
  const absentSet = new Set(m.absent || []);
  const present = (o.data.selection || []).filter((pid) => !absentSet.has(pid));
  const awards = { ...autoAwards(m, present) };
  for (const [pid, key] of Object.entries(req.body.awards || {})) if (AWARDS[key] && present.includes(pid)) awards[pid] = key;
  saveData(o, { match: m, summary: { text, at: now() }, awards });
  let sent = 0;
  if (req.body.publish !== false && o.e.parents !== false) {
    const us = m.score?.us ?? 0;
    const them = m.score?.them ?? 0;
    const team = eventGroup(o.e) ?? get('SELECT category FROM teams WHERE id = ?', o.e.teamId)?.category ?? 'Nous';
    const games = gameResults(o.e, m);
    const title = games ? `Fin du plateau ${team} : ${plateauRecord(games)}` : `Fin du match : ${team} ${us} – ${them} ${o.e.opponent || 'adversaire'}`;
    const sel = new Set(o.data.selection || []);
    const absent = new Set(m.absent || []);
    for (const p of occPlayers(o)) {
      const parents = parentsOf(p.id).map((u) => u.id);
      if (!parents.length) continue;
      let body = '';
      if (sel.has(p.id) && !absent.has(p.id)) {
        const min = Math.round((m.seconds?.[p.id] || 0) / 60);
        const goals = (m.events || []).filter((ev) => ev.t === 'goal' && ev.pid === p.id).length;
        body = `${p.firstName} a joué ${min} min${o.settings.stats && goals ? ` · ⚽ ${goals} but${goals > 1 ? 's' : ''}` : ''}. ${AWARDS[awards[p.id]]?.emoji ?? '🏆'} Récompense à découvrir : retournez sa carte !`;
      }
      if (text) body += `${body ? ' ' : ''}Le mot du coach : ${text}`;
      sent += notify(parents, { kind: 'summary', title, body: body.slice(0, 400), url: `${matchUrl(o)}/cartes` });
    }
  }
  toTeam(o.e.teamId, { t: 'conv', eventId: o.e.id, date: o.date });
  res.json({ ...detail(o), sent });
});

/** Billets de match des enfants du parent connecté. */
convApi.get('/me/matches', (req, res) => {
  const kids = childIdsFor(req.user);
  if (!kids.length) return res.json([]);
  const children = all(`SELECT * FROM players WHERE id IN (${kids.map(() => '?').join(',')})`, ...kids).map((r) => ({ ...parse(r), teamId: r.team_id }));
  const today = todayYMD();
  const out = [];
  for (const teamId of [...new Set(children.map((c) => c.teamId))]) {
    for (const o of teamOccurrences(teamId, ymdAdd(today, -21), ymdAdd(today, 42))) {
      if (o.e.parents === false) continue;
      for (const c of occPlayers(o, children.filter((c) => c.teamId === teamId))) out.push(ticket(o, c, req.user));
    }
  }
  res.json(out.sort((a, b) => a.timeline.start - b.timeline.start));
});

/** Tableau de bord du club : chaque équipe, son prochain match et le respect des délais. */
convApi.get('/club/overview', (req, res) => {
  if (!can(req.user, 'club.dashboard')) throw new HttpError(403, 'Réservé aux responsables du club');
  const today = todayYMD();
  const teams = all('SELECT * FROM teams WHERE id IN (' + teamIdsFor(req.user).map(() => '?').join(',') + ') ORDER BY category', ...teamIdsFor(req.user));
  // Une équipe U8/U9 apparaît une fois par catégorie : chacune a ses matchs et son équité.
  res.json(teams.flatMap((team) => {
    const all_ = teamPlayers(team.id);
    const occs = teamOccurrences(team.id, seasonStart(), ymdAdd(today, 21));
    const staff = all('SELECT u.name FROM team_staff s JOIN users u ON u.id = s.user_id WHERE s.team_id = ?', team.id).map((u) => u.name);
    const groups = teamInfo(team.id).groups;
    return (groups.length ? groups : [null]).map((group) => {
      const players = all_.filter((p) => inGroup(p, team.id, group));
      const list = occs.filter((o) => !group || !eventGroup(o.e) || eventGroup(o.e) === group);
      const past = list.filter((o) => o.t.start < now());
      const onTime = past.filter((o) => o.row?.published_at && o.row.published_at <= o.t.deadline).length;
      const upcoming = list.filter((o) => o.t.start >= now()).slice(0, 3).map((o) => snapshot(o, all_));
      return {
        team: { id: team.id, category: group ?? team.category, color: team.color },
        group,
        staff,
        players: players.length,
        past: past.length,
        onTime,
        equity: teamStats(team.id, null, group).equity,
        upcoming,
      };
    });
  }));
});

/* ---- réglages prédéfinis */

convApi.get('/conv-presets', (req, res) => {
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const teamIds = teamIdsFor(req.user);
  res.json({
    defaults: DEFAULT_SETTINGS,
    presets: all('SELECT * FROM conv_presets ORDER BY team_id IS NOT NULL, created_at').filter((r) => !r.team_id || teamIds.includes(r.team_id)).map(presetOut),
  });
});

function presetAccess(user, teamId) {
  need(user, 'events.manage');
  if (teamId) needTeam(user, teamId, { staff: true });
  else if (user.role !== 'admin' && !can(user, 'teams.manage')) throw new HttpError(403, 'Seuls les responsables modifient les réglages du club');
}

convApi.put('/conv-presets/:id', (req, res) => {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new HttpError(400, 'Identifiant invalide');
  const existing = get('SELECT * FROM conv_presets WHERE id = ?', id);
  const teamId = existing ? existing.team_id : req.body.teamId || null;
  presetAccess(req.user, teamId);
  const name = str(req.body.name, 80) || 'Réglage';
  const data = JSON.stringify(normalizeSettings(req.body.settings || {}));
  tx(() => {
    if (existing) run('UPDATE conv_presets SET name = ?, data = ?, updated_at = ? WHERE id = ?', name, data, now(), id);
    else run('INSERT INTO conv_presets VALUES (?, ?, ?, ?, 0, ?, ?)', id, teamId, name, data, now(), now());
    if (req.body.isDefault) {
      run(`UPDATE conv_presets SET is_default = 0 WHERE ${teamId ? 'team_id = ?' : 'team_id IS NULL'}`, ...(teamId ? [teamId] : []));
      run('UPDATE conv_presets SET is_default = 1 WHERE id = ?', id);
    } else if (existing?.is_default && req.body.isDefault === false) run('UPDATE conv_presets SET is_default = 0 WHERE id = ?', id);
  });
  res.json(presetOut(get('SELECT * FROM conv_presets WHERE id = ?', id)));
});

convApi.delete('/conv-presets/:id', (req, res) => {
  const p = get('SELECT * FROM conv_presets WHERE id = ?', req.params.id);
  if (!p) return res.json({ ok: true });
  presetAccess(req.user, p.team_id);
  if (!p.team_id && get('SELECT COUNT(*) n FROM conv_presets WHERE team_id IS NULL').n <= 1) throw new HttpError(400, 'Gardez au moins un réglage pour le club');
  run('DELETE FROM conv_presets WHERE id = ?', p.id);
  res.json({ ok: true });
});

/* ---- notifications */

convApi.get('/notifications', (req, res) => {
  const list = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60', req.user.id);
  res.json({
    unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n,
    push: pushCount(req.user.id),
    items: list.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, createdAt: n.created_at, read: !!n.read_at })),
  });
});

convApi.post('/notifications/read', (req, res) => {
  if (Array.isArray(req.body.ids)) {
    for (const id of req.body.ids.slice(0, 200)) run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', now(), String(id), req.user.id);
  } else run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), req.user.id);
  res.json({ ok: true });
});

convApi.get('/push/key', (_req, res) => res.json({ key: publicKey() }));

convApi.post('/push/subscribe', (req, res) => {
  if (!saveSubscription(req.user.id, req.body)) throw new HttpError(400, 'Abonnement invalide');
  res.json({ ok: true });
});

convApi.post('/push/unsubscribe', (req, res) => {
  run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String(req.body.endpoint || ''), req.user.id);
  res.json({ ok: true });
});

convApi.post('/push/test', (req, res) => {
  notify([req.user.id], { kind: 'test', title: 'Les notifications fonctionnent 🎉', body: 'Vous recevrez ici les convocations et les rappels.', url: '/' });
  res.json({ ok: true });
});
