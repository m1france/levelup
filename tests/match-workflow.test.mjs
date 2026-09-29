import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A disposable club and database: never use the club's working data or send notifications.
let child, dir, cookie, team, players;
const port = 18000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}/api`;
const call = async (path, method = 'GET', body, authenticated = true) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return response;
};
const json = async (path, method, body) => {
  const r = await call(path, method, body); const data = await r.json();
  assert.ok(r.ok, `${path}: ${JSON.stringify(data)}`); return data;
};
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'levelup-matches-'));
  child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, DATABASE_FILE: join(dir, 'test.db'), API_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Test server did not start')), 10000);
    child.stdout.on('data', (b) => { if (String(b).includes('API prête')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Server exited: ${code}`)); });
  });
  const setup = await call('/setup', 'POST', { clubName: 'Test', name: 'Coach', email: 'test@example.invalid', password: 'local-test-only', demo: true });
  assert.equal(setup.status, 200);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  team = (await json('/me')).teams[0];
  players = await json(`/teams/${team.id}/players`);
});
after(async () => { child?.kill(); if (child && child.exitCode === null) await new Promise((r) => child.once('exit', r)); if (dir) await rm(dir, { recursive: true, force: true }); });

const event = async (id, date) => json(`/events/${id}`, 'PUT', {
  teamId: team.id, type: 'plateau', title: 'Plateau test', start: date, time: '10:00', meetTime: '09:30', recurrence: { freq: 'none' },
  games: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((opponent, i) => ({ id: `fixture${i}`, opponent, time: `10:${i}0`, minutes: 12 })),
});
const state = () => ({ formation: '1-2-1', field: players.slice(0, 5).map((p) => p.id), absent: [], starters: [], period: 2, running: false, since: null, elapsed: 0, seconds: {}, events: [], score: { us: 0, them: 0 }, results: [{ us: 2, them: 1 }], gameOrder: ['fixture0', 'fixture2', 'fixture1', 'fixture3'], halftimeNotified: [1], started: true, finished: false });

test('single start time; persisted fixture order keeps completed scores attached', async () => {
  const id = 'testorder', date = '2030-10-03';
  await event(id, date);
  await json(`/convocations/${id}/${date}`, 'PUT', { selection: players.slice(0, 8).map((p) => p.id) });
  await json(`/convocations/${id}/${date}/match`, 'PUT', state());
  const detail = await json(`/convocations/${id}/${date}`);
  assert.equal(detail.time, '10:00');
  assert.equal(detail.meetTime, '10:00');
  assert.deepEqual(detail.games.map((g) => g.opponent), ['Alpha', 'Charlie', 'Bravo', 'Delta']);
  assert.ok(detail.games.every((g) => g.time === ''));
  assert.deepEqual(detail.match.halftimeNotified, [1]);
  assert.deepEqual(detail.score.games.map((g) => [g.opponent, g.us]), [['Alpha', 2], ['Charlie', 0], ['Bravo', null], ['Delta', null]]);
  await json(`/convocations/${id}/${date}/finish`, 'POST', { publish: false, match: { ...state(), finished: true, results: [{ us: 2, them: 1 }, { us: 3, them: 0 }], score: { us: 5, them: 1 } } });
  const finished = await json(`/convocations/${id}/${date}`);
  assert.equal(finished.phase, 'played');
  const reveal = await json(`/convocations/${id}/${date}/reveal`);
  assert.equal(reveal.games[1].opponent, 'Charlie');
  assert.equal(reveal.games[1].us, 3);
});

test('availability requests are rejected after the response cutoff', async () => {
  await event('testexpired', '2020-01-01');
  const r = await call('/convocations/testexpired/2020-01-01/request', 'POST', {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /date limite de dispos/);
});

test('profile and card photos are independent, legacy card is preserved, access stays protected', async () => {
  const id = players[0].id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lVQAAAAASUVORK5CYII=', 'base64');
  const photo = (suffix) => `data:image/png;base64,${Buffer.concat([png, Buffer.from(suffix)]).toString('base64')}`;
  await json(`/players/${id}/photo`, 'POST', { image: photo('original') });
  await json(`/players/${id}/photo`, 'POST', { image: photo('new profile') });
  const readImage = async (path) => { const r = await call(path); assert.equal(r.status, 200); return Buffer.from(await r.arrayBuffer()); };
  assert.deepEqual(await readImage(`/players/${id}/card-photo`), Buffer.concat([png, Buffer.from('original')]));
  await json(`/players/${id}/card-photo`, 'POST', { image: photo('card') });
  assert.deepEqual(await readImage(`/players/${id}/photo`), Buffer.concat([png, Buffer.from('new profile')]));
  assert.deepEqual(await readImage(`/players/${id}/card-photo`), Buffer.concat([png, Buffer.from('card')]));
  assert.equal((await call(`/players/${id}/card-photo`, 'GET', undefined, false)).status, 401);
  const reveal = await json('/convocations/testorder/2030-10-03/reveal');
  assert.match(reveal.cards.find((p) => p.id === id).photo, /card-photo/);
});
