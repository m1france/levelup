import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DATABASE_FILE || 'data/atelier.db');
mkdirSync(dirname(file), { recursive: true });
/** Photos de l'album, à côté de la base. */
export const UPLOADS = resolve(dirname(file), 'uploads');
mkdirSync(UPLOADS, { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  perm TEXT NOT NULL,
  PRIMARY KEY (role, perm)
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  season TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#1f6f4a',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_staff (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS player_parents (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (player_id, user_id)
);
CREATE TABLE IF NOT EXISTS player_observations (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  skill TEXT NOT NULL DEFAULT '',
  trend TEXT NOT NULL DEFAULT 'flat',
  text TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'staff',
  training_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_player ON player_observations(player_id, created_at);
CREATE TABLE IF NOT EXISTS player_objectives (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'staff',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_player ON player_objectives(player_id);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  validated INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trainings (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  share_token TEXT UNIQUE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
DROP TABLE IF EXISTS challenge_done;
DROP TABLE IF EXISTS challenges;
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_trainings_team ON trainings(team_id, date);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  caption TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_team ON photos(team_id, taken_at);
CREATE TABLE IF NOT EXISTS perm_seeded (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id);
UPDATE teams SET name = category WHERE name != category;
CREATE TABLE IF NOT EXISTS invite_links (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);
// Qui a envoyé l'invitation personnelle (ajouté après coup).
if (!db.prepare('PRAGMA table_info(invites)').all().some((c) => c.name === 'invited_by')) {
  db.exec('ALTER TABLE invites ADD COLUMN invited_by TEXT REFERENCES users(id) ON DELETE SET NULL');
}

/* Exercices d'équipe : partagés entre tous les éducateurs de l'équipe, consultables par ses joueurs. */
if (!db.prepare('PRAGMA table_info(exercises)').all().some((c) => c.name === 'team_id')) {
  db.exec(`
    ALTER TABLE exercises ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_exercises_team ON exercises(team_id);
  `);
  // Rattache les exercices personnels existants : à l'équipe d'une séance qui les utilise,
  // sinon à l'équipe de leur auteur s'il n'en encadre qu'une.
  const used = new Map();
  for (const t of db.prepare('SELECT team_id, data FROM trainings').all()) {
    for (const b of JSON.parse(t.data).blocks || []) {
      for (const id of [b.exerciseId, ...(b.stations || []).map((s) => s.exerciseId)]) if (id && !used.has(id)) used.set(id, t.team_id);
    }
  }
  for (const e of db.prepare(`SELECT id, owner_id FROM exercises WHERE visibility = 'private'`).all()) {
    let team = used.get(e.id);
    if (!team && e.owner_id) {
      const teams = db.prepare('SELECT team_id FROM team_staff WHERE user_id = ?').all(e.owner_id);
      if (teams.length === 1) team = teams[0].team_id;
    }
    if (team) db.prepare('UPDATE exercises SET team_id = ? WHERE id = ?').run(team, e.id);
  }
}

/* Convocations : réglages prédéfinis, disponibilités, lectures, tâches planifiées, notifications. */
db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conv_presets (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS convocations (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  published_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, date)
);
CREATE INDEX IF NOT EXISTS idx_conv_team ON convocations(team_id, date);
CREATE TABLE IF NOT EXISTS availability (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  by_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, date, player_id)
);
CREATE TABLE IF NOT EXISTS conv_reads (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, date, user_id)
);
CREATE TABLE IF NOT EXISTS conv_jobs (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  job TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (event_id, date, job)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

/* Anciennes remarques libres → observations (point fort / à travailler / remarque) et objectifs. */
if (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_notes'`).get()) {
  const trend = { force: 'up', faiblesse: 'down', remarque: 'flat' };
  db.exec('BEGIN');
  try {
    for (const n of db.prepare('SELECT * FROM player_notes').all()) {
      if (n.kind === 'objectif') {
        const data = { title: n.text.slice(0, 160), domain: '', skill: '', due: null, status: 'active', progress: 0, checkins: [] };
        db.prepare('INSERT OR IGNORE INTO player_objectives VALUES (?, ?, ?, ?, ?, ?, ?)').run(n.id, n.player_id, n.author_id, JSON.stringify(data), n.visibility, n.created_at, n.updated_at);
      } else {
        db.prepare('INSERT OR IGNORE INTO player_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          n.id, n.player_id, n.author_id, '', trend[n.kind] ?? 'flat', n.text, n.visibility, n.training_id, n.created_at, n.updated_at,
        );
      }
    }
    db.exec('DROP TABLE player_notes');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* V4 : cartes de fin de match, album enrichi, bulletins, covoiturage, agenda, annonces, messagerie. */
db.exec(`
CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, player_id)
);
CREATE TABLE IF NOT EXISTS photo_reactions (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id)
);
CREATE TABLE IF NOT EXISTS bulletins (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bulletins_player ON bulletins(player_id);
CREATE TABLE IF NOT EXISTS carpool (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'both',
  seats INTEGER NOT NULL DEFAULT 0,
  place TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_carpool_occ ON carpool(event_id, date);
CREATE TABLE IF NOT EXISTS carpool_bookings (
  offer_id TEXT NOT NULL REFERENCES carpool(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (offer_id, player_id)
);
CREATE TABLE IF NOT EXISTS ics_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_targets (
  ann_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER,
  PRIMARY KEY (ann_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members (
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_msg ON chat_messages(thread_id, created_at);
CREATE TABLE IF NOT EXISTS chat_reactions (
  msg_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (msg_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_votes (
  msg_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  PRIMARY KEY (msg_id, user_id, option_id)
);
CREATE TABLE IF NOT EXISTS chat_claims (
  msg_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (msg_id, item_id)
);
`);
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('photos').includes('event_id')) db.exec('ALTER TABLE photos ADD COLUMN event_id TEXT; ALTER TABLE photos ADD COLUMN event_date TEXT;');
if (!cols('users').includes('phone')) db.exec(`ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);

// Éléments d'exercice : l'ancienne taille 80 % devient la taille normale (100 %), les motifs de maillot disparaissent.
if (!db.prepare(`SELECT 1 FROM kv WHERE key = 'migr.itemScale80'`).get()) {
  const upd = db.prepare('UPDATE exercises SET data = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const row of db.prepare('SELECT id, data FROM exercises').all()) {
    const d = JSON.parse(row.data);
    let changed = false;
    for (const it of d.items ?? []) {
      if ('kit' in it) {
        delete it.kit;
        changed = true;
      }
      if (typeof it.scale === 'number' && it.kind !== 'zone' && it.kind !== 'measure') {
        const sc = Math.round((it.scale / 0.8) * 100) / 100;
        if (Math.abs(sc - 1) < 0.01) delete it.scale;
        else it.scale = sc;
        changed = true;
      }
    }
    if (changed) upd.run(JSON.stringify(d), row.id);
  }
  db.prepare(`INSERT INTO kv VALUES ('migr.itemScale80', '1')`).run();
  db.exec('COMMIT');
}

// Bibliothèque du club supprimée : ses exercices disparaissent, ceux d'un éducateur ou d'une équipe redeviennent privés.
if (!db.prepare(`SELECT 1 FROM kv WHERE key = 'migr.noClubLibrary'`).get()) {
  db.exec(`BEGIN;
    DELETE FROM exercises WHERE visibility = 'club' AND owner_id IS NULL AND team_id IS NULL;
    UPDATE exercises SET visibility = 'private', validated = 0 WHERE visibility = 'club';
    INSERT INTO kv VALUES ('migr.noClubLibrary', '1');
    COMMIT;`);
}

// Équipes U8/U9 : la catégorie de chaque joueur est enregistrée sur sa fiche (déduite de son année de naissance).
if (!db.prepare(`SELECT 1 FROM kv WHERE key = 'migr.playerCategory'`).get()) {
  const upd = db.prepare('UPDATE players SET data = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const t of db.prepare('SELECT id, category, season FROM teams').all()) {
    const groups = [...new Set((t.category.match(/U\s?\d{1,2}/gi) || []).map((g) => g.replace(/\s/g, '').toUpperCase()))];
    if (groups.length < 2) continue;
    const ages = groups.map((g) => Number(g.slice(1))).sort((a, b) => a - b);
    const m = /(\d{4})\D+(\d{4})/.exec(t.season || '');
    const end = m ? Number(m[2]) : new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    for (const r of db.prepare('SELECT id, data FROM players WHERE team_id = ?').all(t.id)) {
      const d = JSON.parse(r.data);
      if (d.category || !d.birthYear) continue;
      d.category = `U${Math.max(ages[0], Math.min(ages[ages.length - 1], end - d.birthYear))}`;
      upd.run(JSON.stringify(d), r.id);
    }
  }
  db.prepare(`INSERT INTO kv VALUES ('migr.playerCategory', '1')`).run();
  db.exec('COMMIT');
}

export const kvGet = (key) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
export const kvSet = (key, value) => db.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

/* Messagerie : salons (annonces, groupes) avec icône et permissions, discussions supprimées par un membre. */
if (!cols('chat_threads').includes('data')) db.exec(`ALTER TABLE chat_threads ADD COLUMN data TEXT NOT NULL DEFAULT '{}'`);
if (!cols('chat_members').includes('cleared_at')) {
  db.exec(`ALTER TABLE chat_members ADD COLUMN cleared_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE chat_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);
}

/** Adresse du logo du club (versionnée), ou null. */
export const clubLogoUrl = () => {
  const v = kvGet('club.logo');
  return v ? `/api/club/logo?v=${v}` : null;
};

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const parse = (row) => (row ? { ...JSON.parse(row.data), id: row.id } : null);
