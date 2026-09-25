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
CREATE TABLE IF NOT EXISTS player_notes (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'staff',
  training_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
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
CREATE INDEX IF NOT EXISTS idx_notes_player ON player_notes(player_id);
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
