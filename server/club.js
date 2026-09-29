/**
 * Club : tableau de bord (présences, convocations, équité par équipe), effectif complet avec coordonnées,
 * import depuis SportEasy (CSV) et abonnement agenda (iPhone, Google) par lien iCalendar privé.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { all, get, run, tx, parse } from './db.js';
import { can, need, needTeam, isStaff, childIdsFor, teamIdsFor, newId, HttpError } from './auth.js';
import { convOf, evTitle, teamStats, timeline } from './convocations.js';
import { occurrences, todayYMD, ymdAdd, seasonStart } from './occurrences.js';
import { refreshTeams } from './live.js';

const now = () => Date.now();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const clubPublic = Router();
export const clubApi = Router();

/* ================================================================== agenda */

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 72) {
    out.push(rest.slice(0, 72));
    rest = ` ${rest.slice(72)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}
const stamp = (ymd, time) => `${ymd.replace(/-/g, '')}T${(time || '00:00').replace(':', '')}00`;
const utcStamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

function addMinutes(time, min) {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function icsFor(user, origin) {
  const staff = isStaff(user);
  const kids = staff ? [] : childIdsFor(user);
  const today = todayYMD();
  const club = get('SELECT name FROM club WHERE id = 1')?.name ?? 'LevelUp';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LevelUp//Club//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(club)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTIMEZONE];
  const teams = teamIdsFor(user);
  for (const teamId of teams) {
    const cat = get('SELECT category FROM teams WHERE id = ?', teamId)?.category ?? '';
    const teamKids = kids.length ? all('SELECT id, data FROM players WHERE team_id = ?', teamId).map(parse).filter((p) => kids.includes(p.id)) : [];
    for (const r of all('SELECT * FROM events WHERE team_id = ?', teamId)) {
      const e = { ...JSON.parse(r.data), id: r.id, teamId };
      if (!staff && e.parents === false) continue;
      const c = convOf(e);
      for (const date of occurrences(e, ymdAdd(today, -30), ymdAdd(today, 200))) {
        const row = c.enabled ? get('SELECT * FROM convocations WHERE event_id = ? AND date = ?', e.id, date) : null;
        const data = row ? JSON.parse(row.data) : {};
        const meet = e.time || '';
        let status = '';
        if (c.enabled && teamKids.length) {
          status = teamKids
            .map((k) => {
              if (row?.published_at) return (data.selection || []).includes(k.id) ? `✅ ${k.firstName} dans le groupe` : `${k.firstName} pas dans le groupe`;
              const a = get('SELECT status FROM availability WHERE event_id = ? AND date = ? AND player_id = ?', e.id, date, k.id);
              return a ? `${k.firstName} : ${a.status === 'yes' ? 'présent' : a.status === 'no' ? 'absent' : 'incertain'}` : `❓ Répondre pour ${k.firstName}`;
            })
            .join(' · ');
        }
        const prefix = teams.length > 1 ? `[${cat}] ` : '';
        const summary = `${prefix}${evTitle(e)}${status ? ` — ${status}` : ''}`;
        const desc = [
          meet && `Rendez-vous : ${meet.replace(':', 'h')}`,
          c.enabled && !row?.published_at && `Convocation publiée au plus tard le ${new Date(timeline(e, date, c.settings).deadline).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`,
          e.opponent && `Adversaire : ${e.opponent}`,
          `${origin}${c.enabled ? `/matchs/${e.id}/${date}` : '/'}`,
        ].filter(Boolean).join('\n');
        lines.push('BEGIN:VEVENT', `UID:${e.id}-${date}@levelup`, `DTSTAMP:${utcStamp(row?.updated_at ?? r.updated_at)}`);
        if (e.allDay || !e.time) {
          lines.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${ymdAdd(date, 1).replace(/-/g, '')}`);
        } else {
          // Le rendez-vous est le début affiché dans l'agenda : c'est l'heure à laquelle il faut partir.
          const startTime = meet && meet < e.time ? meet : e.time;
          lines.push(`DTSTART;TZID=Europe/Paris:${stamp(date, startTime)}`, `DTEND;TZID=Europe/Paris:${stamp(date, e.endTime && e.endTime > e.time ? e.endTime : addMinutes(e.time, 90))}`);
        }
        lines.push(fold(`SUMMARY:${esc(summary)}`));
        if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
        lines.push(fold(`DESCRIPTION:${esc(desc)}`));
        if (c.enabled && e.time) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(evTitle(e))}`, 'TRIGGER:-PT90M', 'END:VALARM');
        lines.push('END:VEVENT');
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

clubPublic.get('/calendar/:file', (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/, '');
  const row = get('SELECT user_id FROM ics_tokens WHERE token = ?', token);
  const u = row && get(`SELECT id, email, name, role, status FROM users WHERE id = ?`, row.user_id);
  if (!u || u.status !== 'active') throw new HttpError(404, 'Agenda introuvable');
  // Même contrôle d'accès que la session (rôles et permissions actuels).
  const user = { ...u, perms: new Set(all('SELECT perm FROM role_permissions WHERE role = ?', u.role).map((p) => p.perm)) };
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="levelup.ics"' });
  res.send(icsFor(user, `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`));
});

// Le chemin seulement : le navigateur le complète avec son origine (derrière un proxy, l'hôte vu par le serveur peut différer).
const calendarOut = (_req, row) => ({ enabled: !!row, path: row ? `/api/calendar/${row.token}.ics` : null });

clubApi.get('/me/calendar', (req, res) => {
  res.json(calendarOut(req, get('SELECT * FROM ics_tokens WHERE user_id = ?', req.user.id)));
});

clubApi.post('/me/calendar', (req, res) => {
  const token = randomBytes(24).toString('base64url');
  run('INSERT INTO ics_tokens VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at', req.user.id, token, now());
  res.json(calendarOut(req, get('SELECT * FROM ics_tokens WHERE user_id = ?', req.user.id)));
});

clubApi.delete('/me/calendar', (req, res) => {
  run('DELETE FROM ics_tokens WHERE user_id = ?', req.user.id);
  res.json({ enabled: false, url: null });
});

/* ================================================================== tableau de bord */

function needClub(user) {
  if (!can(user, 'club.dashboard') && user.role !== 'admin') throw new HttpError(403, 'Réservé aux responsables du club');
}

clubApi.get('/club/stats', (req, res) => {
  needClub(req.user);
  const today = todayYMD();
  const from = seasonStart();
  const teams = teamIdsFor(req.user).map((id) => get('SELECT * FROM teams WHERE id = ?', id)).filter(Boolean).sort((a, b) => a.category.localeCompare(b.category, 'fr'));
  const out = teams.map((t) => {
    const players = all('SELECT id FROM players WHERE team_id = ?', t.id).map((r) => r.id);
    const trainings = all('SELECT date, data FROM trainings WHERE team_id = ? AND date >= ? ORDER BY date', t.id, from)
      .map((r) => ({ date: r.date.slice(0, 10), att: JSON.parse(r.data).attendance }))
      .filter((x) => Array.isArray(x.att) && x.att.length);
    const rates = trainings.map((x) => (players.length ? x.att.filter((id) => players.includes(id)).length / players.length : 0));
    const convs = all('SELECT * FROM convocations WHERE team_id = ? AND date >= ? AND date <= ?', t.id, from, today);
    let onTime = 0;
    let published = 0;
    let answered = 0;
    let asked = 0;
    let deadlines = 0;
    for (const c of convs) {
      const r = get('SELECT * FROM events WHERE id = ?', c.event_id);
      if (!r) continue;
      const e = { ...JSON.parse(r.data), id: r.id, teamId: r.team_id };
      const cv = convOf(e);
      if (!cv.enabled) continue;
      deadlines++;
      const tl = timeline(e, c.date, cv.settings);
      if (c.published_at) {
        published++;
        if (c.published_at <= tl.deadline) onTime++;
      }
      asked += players.length;
      answered += get('SELECT COUNT(*) n FROM availability WHERE event_id = ? AND date = ?', c.event_id, c.date).n;
    }
    const stats = teamStats(t.id);
    return {
      team: { id: t.id, category: t.category, color: t.color },
      staff: all('SELECT u.name FROM team_staff s JOIN users u ON u.id = s.user_id WHERE s.team_id = ?', t.id).map((u) => u.name),
      players: players.length,
      parents: get('SELECT COUNT(DISTINCT pp.user_id) n FROM player_parents pp JOIN players p ON p.id = pp.player_id WHERE p.team_id = ?', t.id).n,
      attendance: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : null,
      attendanceTrend: rates.slice(-10).map((r) => Math.round(r * 100)),
      trainings: trainings.length,
      matches: stats.matches,
      onTime: deadlines ? Math.round((onTime / deadlines) * 100) : null,
      published,
      responseRate: asked ? Math.round((answered / asked) * 100) : null,
      equity: stats.equity,
      minutesEquity: stats.minutesEquity,
      licences: all('SELECT data FROM players WHERE team_id = ?', t.id).filter((r) => JSON.parse(r.data).info?.licence?.status === 'ok').length,
    };
  });
  res.json(out);
});

/** Effectif complet du club, avec les coordonnées des parents et l'administratif. */
clubApi.get('/club/roster', (req, res) => {
  if (!can(req.user, 'club.dashboard') && !can(req.user, 'members.manage') && req.user.role !== 'admin') throw new HttpError(403, 'Réservé aux responsables du club');
  const teams = teamIdsFor(req.user);
  const rows = teams.length ? all(`SELECT * FROM players WHERE team_id IN (${teams.map(() => '?').join(',')})`, ...teams) : [];
  const teamOf = Object.fromEntries(teams.map((id) => [id, get('SELECT id, category, color FROM teams WHERE id = ?', id)]));
  res.json(
    rows
      .map((r) => {
        const p = parse(r);
        return {
          id: p.id, firstName: p.firstName, lastName: p.lastName ?? '', birthYear: p.birthYear ?? null, number: p.number ?? null,
          team: teamOf[r.team_id], licence: p.info?.licence ?? { number: '', status: 'missing' }, certificate: p.info?.certificate ?? null,
          photoConsent: p.info?.photoConsent ?? '', contacts: p.info?.contacts ?? [], allergies: p.info?.allergies ?? '',
          parents: all(`SELECT u.id, u.name, u.email, u.phone, u.status FROM player_parents pp JOIN users u ON u.id = pp.user_id WHERE pp.player_id = ?`, p.id),
        };
      })
      .sort((a, b) => a.team.category.localeCompare(b.team.category, 'fr') || a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr')),
  );
});

/**
 * Import d'un export SportEasy (ou de tout tableur) : les lignes sont déjà associées aux colonnes côté navigateur.
 * Les parents existants (même e-mail) sont rattachés : une fratrie garde un seul compte.
 */
clubApi.post('/club/import', (req, res) => {
  need(req.user, 'players.manage');
  const teamId = String(req.body.teamId || '');
  needTeam(req.user, teamId, { staff: true });
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
  const canInvite = can(req.user, 'members.manage');
  const summary = { created: 0, updated: 0, linked: 0, invited: 0, skipped: 0 };
  const invites = [];
  tx(() => {
    const existing = all('SELECT * FROM players WHERE team_id = ?', teamId).map((r) => ({ row: r, p: parse(r) }));
    for (const raw of rows) {
      const firstName = str(raw.firstName, 80);
      if (!firstName) {
        summary.skipped++;
        continue;
      }
      const lastName = str(raw.lastName, 80);
      const birthYear = Number(String(raw.birthYear || raw.birthDate || '').match(/(19|20)\d{2}/)?.[0]) || undefined;
      const match = existing.find((x) => x.p.firstName.toLowerCase() === firstName.toLowerCase() && (x.p.lastName ?? '').toLowerCase() === lastName.toLowerCase());
      let pid;
      const data = match ? { ...match.p } : { firstName, lastName, level: 2 };
      delete data.id;
      if (birthYear) data.birthYear = birthYear;
      if (raw.number && Number.isFinite(Number(raw.number))) data.number = Math.round(Number(raw.number));
      const licence = str(raw.licence, 40);
      if (licence) data.info = { ...(data.info || { contacts: [], allergies: '', treatment: '', health: '', certificate: null, photoConsent: '' }), licence: { number: licence, status: 'ok' } };
      const phone = str(raw.parentPhone, 30);
      if (phone && str(raw.parentName, 80)) {
        const info = data.info || { contacts: [], allergies: '', treatment: '', health: '', licence: { number: '', status: 'missing' }, certificate: null, photoConsent: '' };
        if (!info.contacts.some((c) => c.phone === phone)) info.contacts = [...info.contacts, { name: str(raw.parentName, 80), relation: 'Parent', phone }].slice(0, 4);
        data.info = info;
      }
      if (match) {
        pid = match.row.id;
        run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), pid);
        summary.updated++;
      } else {
        pid = newId();
        run('INSERT INTO players VALUES (?, ?, ?, ?, ?)', pid, teamId, JSON.stringify(data), now(), now());
        summary.created++;
      }
      const email = str(raw.parentEmail, 200).toLowerCase();
      if (email.includes('@')) {
        let u = get('SELECT id, role FROM users WHERE email = ?', email);
        if (!u && canInvite) {
          const id = newId();
          run(`INSERT INTO users (id, email, name, role, status, created_at, phone) VALUES (?, ?, ?, 'parent', 'invited', ?, ?)`, id, email, str(raw.parentName, 120) || email.split('@')[0], now(), phone);
          const token = newId(24);
          run('INSERT INTO invites (token, user_id, expires_at, invited_by) VALUES (?, ?, ?, ?)', token, id, now() + 30 * 864e5, req.user.id);
          invites.push({ email, name: str(raw.parentName, 120), token });
          summary.invited++;
          u = { id, role: 'parent' };
        }
        if (u?.role === 'parent') {
          run('INSERT OR IGNORE INTO player_parents VALUES (?, ?)', pid, u.id);
          summary.linked++;
        }
      }
    }
  });
  refreshTeams();
  res.json({ ...summary, invites });
});

