/**
 * Conférence de presse : la convocation annoncée en cinématique 3D.
 * Deux présentateurs (un par catégorie, ex. U8 et U9) assis derrière une table de presse annoncent le groupe,
 * puis chaque joueur convoqué surgit dans un éclair avec sa photo en pied pendant que son prénom est prononcé ;
 * l'écran final montre les cartes des convoqués.
 *
 * Réglages du club (clé `press.settings`) : présentateurs (nom, rôle, catégories, coiffure,
 * voix Fish Audio ou échantillon de leur voix à cloner), textes, durée par joueur.
 * Les voix sont générées par Fish Audio (OpenRouter), une fois par phrase, puis gardées en cache.
 */
import { Router } from 'express';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, run, parse, kvGet, kvSet, UPLOADS, clubLogoUrl } from './db.js';
import { need, needTeam, isStaff, childIdsFor, newId, HttpError } from './auth.js';
import { occ, occPlayers, evTitle, meetOf, bringOf } from './convocations.js';
import { eventGroup, playerGroup, teamInfo } from './groups.js';
import { fullPhotoFile, playerAccess, playerOut } from './players.js';
import { squadCards } from './reveal.js';
import { sign, verify } from './tokens.js';
import { speech, ttsReady, TtsError } from './tts.js';

const now = () => Date.now();
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : def);
/** Couleur « #rrggbb », ou « auto » : prélevée sur la photo. */
const color = (v, def) => (v === 'auto' || /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : def);
const ID = /^[A-Za-z0-9_-]{4,64}$/;

export const DEFAULT_INTRO = 'Nous sommes heureux de vous annoncer notre sélection pour ce match. Alors, voici la convocation des {groupe} !';
export const DEFAULT_OUTRO = 'Rendez-vous {rendezvous}. Allez les {groupe} !';
export const HAIR_STYLES = ['cap', 'fringe', 'short', 'curly', 'long', 'bald'];

/** Voix françaises masculines de la bibliothèque Fish Audio (fish.audio/m/<id>). */
export const FISH_VOICES = [
  { id: '0f1010386ed941d78f7f5857ab7a5296', label: 'Homme français, jeune et dynamique' },
  { id: 'f9aa3a396d79491c8a6a3ed7ec69fd84', label: 'Jeune voix française, naturelle' },
];

/** Identifiant de voix Fish Audio, depuis un identifiant ou un lien fish.audio/…/m/<id>. */
const voiceId = (v) => {
  const m = /([0-9a-f]{32})/i.exec(String(v || ''));
  return m ? m[1].toLowerCase() : '';
};

function presenterDefaults(p = {}, i = 0) {
  return {
    id: typeof p.id === 'string' && ID.test(p.id) ? p.id : newId(),
    name: str(p.name, 40) || `Coach ${i + 1}`,
    role: str(p.role, 60),
    groups: Array.isArray(p.groups) ? [...new Set(p.groups.map((g) => str(g, 12).toUpperCase()).filter(Boolean))].slice(0, 6) : [],
    style: HAIR_STYLES.includes(p.style) ? p.style : 'short',
    hair: color(p.hair, 'auto'),
    cap: color(p.cap, 'auto'),
    voice: {
      id: voiceId(p.voice?.id) || FISH_VOICES[i % FISH_VOICES.length].id,
      sample: p.voice?.sample && Number.isFinite(p.voice.sample.v) ? { v: p.voice.sample.v, type: str(p.voice.sample.type, 60) } : null,
      transcript: str(p.voice?.transcript, 400),
    },
  };
}

/** Réglages par défaut : deux présentateurs, un par catégorie de la première équipe à deux catégories (sinon U8 / U9). */
function defaults() {
  const team = get(`SELECT id FROM teams ORDER BY created_at LIMIT 1`);
  const groups = team ? teamInfo(team.id).groups : [];
  const [a, b] = groups.length >= 2 ? groups : ['U8', 'U9'];
  return {
    enabled: true,
    intro: DEFAULT_INTRO,
    outro: DEFAULT_OUTRO,
    hold: 2,
    presenters: [
      presenterDefaults({ name: 'Mathis', role: `Coach ${a}`, groups: [a], style: 'cap', hair: '#3b2717' }, 0),
      presenterDefaults({ name: 'Lowen', role: `Coach ${b}`, groups: [b], style: 'fringe' }, 1),
    ],
  };
}

export function pressSettings() {
  const raw = kvGet('press.settings');
  if (!raw) {
    // Premier accès : les présentateurs gardent désormais le même identifiant (photos, voix).
    const d = defaults();
    save(d);
    return d;
  }
  try {
    const s = JSON.parse(raw);
    return {
      enabled: s.enabled !== false,
      intro: str(s.intro, 400) || DEFAULT_INTRO,
      outro: typeof s.outro === 'string' ? str(s.outro, 400) : DEFAULT_OUTRO,
      hold: num(s.hold, 1.5, 6, 2),
      presenters: (Array.isArray(s.presenters) ? s.presenters : []).slice(0, 2).map(presenterDefaults),
    };
  } catch {
    return defaults();
  }
}

const save = (s) => kvSet('press.settings', JSON.stringify(s));

/* ------------------------------------------------------------------ fichiers */

// Anciennes photos et points du visage des présentateurs : la tête est désormais entièrement sculptée,
// ces fichiers ne servent plus et partent avec le présentateur.
const presenterPhoto = (id) => join(UPLOADS, `press_${id}.jpg`);
const presenterFace = (id) => join(UPLOADS, `press_${id}.face.json`);
const presenterSample = (id) => join(UPLOADS, `press_${id}_sample.audio`);

/** Enregistrement audio (MediaRecorder : webm/opus, mp4/aac, ogg ; ou fichier mp3/wav importé). */
function decodeAudio(dataUrl, maxBytes = 4_000_000) {
  const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[a-z0-9=.+-]+)*;base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Enregistrement invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, 'Enregistrement trop long');
  if (buf.length < 2000) throw new HttpError(400, 'Enregistrement trop court');
  return { buf, type: m[1].toLowerCase() };
}

function sendFile(res, path, type) {
  if (!existsSync(path)) throw new HttpError(404, 'Fichier introuvable');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(type).send(readFileSync(path));
}

const drop = (path) => existsSync(path) && unlinkSync(path);

/* ------------------------------------------------------------------ textes et voix */

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function dayWords(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 864e5);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff > 1 && diff < 7) return WEEKDAYS[date.getDay()];
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** « 09:15 » : « 9h15 » à l'écran, « 9 heures 15 » à l'oral. */
const hourText = (t, spoken) => {
  const [h, m] = t.split(':').map(Number);
  if (!spoken) return `${h}h${m ? String(m).padStart(2, '0') : ''}`;
  return `${h} heure${h > 1 ? 's' : ''}${m ? ` ${m}` : ''}`;
};

/** Remplace {groupe}, {adversaire}, {rendezvous}, {lieu}, {club}, {match} ; version affichée ou prononcée. */
function fill(text, o, group, spoken) {
  const at = meetOf(o) || (o.e.allDay ? '' : o.e.time);
  const rdv = `${dayWords(o.date)}${at ? ` à ${hourText(at, spoken)}` : ''}`;
  return text
    .replace(/\{groupe\}/gi, spoken ? group.replace(/^U(\d+)$/i, 'U $1') : group)
    .replace(/\{adversaire\}/gi, o.e.opponent || 'nos adversaires')
    .replace(/\{rendezvous\}/gi, rdv)
    .replace(/\{lieu\}/gi, o.e.location || '')
    .replace(/\{club\}/gi, get('SELECT name FROM club WHERE id = 1')?.name ?? '')
    .replace(/\{match\}/gi, evTitle(o.e))
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Consignes de jeu pour Fish Audio S2 (balises entre crochets, non affichées).
const TONE = {
  intro: '[proud, excited, energetic press conference announcement]',
  name: '[announcing a name loudly, enthusiastic]',
  outro: '[warm, motivating, smiling]',
};

/** Voix d'un présentateur : son échantillon (clonage) s'il existe, sinon la voix Fish Audio choisie. */
function voiceOf(p) {
  if (p?.voice.sample && existsSync(presenterSample(p.id)))
    return { reference: { file: presenterSample(p.id), type: p.voice.sample.type, transcript: p.voice.transcript, v: p.voice.sample.v } };
  return { voice: p?.voice.id || FISH_VOICES[0].id };
}

/** Phrases de la conférence d'un match : clé → { texte affiché, texte prononcé }. */
function segments(o, s) {
  const group = eventGroup(o.e) ?? get('SELECT category FROM teams WHERE id = ?', o.e.teamId)?.category ?? '';
  const byId = new Map(occPlayers(o).map((p) => [p.id, p]));
  const out = {
    intro: { text: fill(s.intro, o, group, false), say: `${TONE.intro} ${fill(s.intro, o, group, true)}` },
  };
  if (s.outro) out.outro = { text: fill(s.outro, o, group, false), say: `${TONE.outro} ${fill(s.outro, o, group, true)}` };
  for (const pid of o.data.selection || []) {
    const p = byId.get(pid);
    if (p) out[`p-${pid}`] = { text: p.firstName, say: `${TONE.name} ${p.press?.say || p.firstName} !` };
  }
  return out;
}

function speakerOf(s, group) {
  return s.presenters.find((p) => group && p.groups.includes(group)) ?? s.presenters[0] ?? null;
}

/** Génère (ou retrouve en cache) une phrase de la conférence d'un match. */
async function segmentFile(o, key) {
  const s = pressSettings();
  const seg = segments(o, s)[key];
  if (!seg) throw new HttpError(404, 'Phrase inconnue');
  return speech({ text: seg.say, ...voiceOf(speakerOf(s, eventGroup(o.e))) });
}

/** Prépare toutes les voix d'une conférence en arrière-plan (publication, aperçu) : les familles n'attendent pas. */
export function warmPress(o) {
  if (!ttsReady() || !pressSettings().enabled) return;
  const keys = Object.keys(segments(o, pressSettings()));
  (async () => {
    for (const k of keys) await segmentFile(o, k).catch(() => undefined);
  })();
}

/** Erreur de synthèse → réponse HTTP (503 : pas de clé ; 502 : service indisponible). */
function ttsFail(e) {
  if (e instanceof TtsError) return new HttpError(e.status === 503 ? 503 : 502, e.message);
  return e;
}

async function sendSegment(res, o, key) {
  try {
    const file = await segmentFile(o, key);
    res.set('Cache-Control', 'private, max-age=86400');
    res.type('audio/mpeg').send(readFileSync(file));
  } catch (e) {
    throw ttsFail(e);
  }
}

/* ------------------------------------------------------------------ contenu de la cinématique */

function presentersFor(s, group, base) {
  const list = s.presenters.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    groups: p.groups,
    style: p.style,
    hair: p.hair,
    cap: p.cap,
  }));
  const speaker = Math.max(0, list.findIndex((p) => group && p.groups.includes(group)));
  return { presenters: list, speaker };
}

/**
 * Données de la conférence de presse d'un match.
 * `base` : préfixe des médias (routes connectées ou lien public), `publicLink` : photos seulement avec l'autorisation « oui ».
 */
function pressPayload(o, { base, publicLink = false, user = null }) {
  const s = pressSettings();
  const published = !!o.row?.published_at;
  const sel = o.data.selection || [];
  const group = eventGroup(o.e);
  const team = get('SELECT category, color FROM teams WHERE id = ?', o.e.teamId) ?? { category: '', color: '#c8102e' };
  const kids = user && !isStaff(user) ? childIdsFor(user) : [];
  const byId = new Map(occPlayers(o).map((p) => [p.id, p]));
  const seg = segments(o, s);
  const chosen = sel.map((pid) => byId.get(pid)).filter(Boolean);
  // Photos : seulement avec l'autorisation des parents (« oui » explicite pour le lien public).
  const allowed = (p) => {
    const consent = p.info?.photoConsent ?? '';
    return publicLink ? consent === 'yes' : consent !== 'no';
  };
  const portrait = (p) => (p.photo && allowed(p) ? `${base}/photo/${p.id}?v=${p.photo}` : null);
  const cards = squadCards(chosen.map((p) => ({ p, photo: portrait(p), mine: kids.includes(p.id) })));
  const players = chosen.map((p, i) => {
    const full = !!p.fullPhoto && allowed(p) && existsSync(fullPhotoFile(p.id));
    return {
      id: p.id,
      firstName: p.firstName,
      number: p.number ?? null,
      photo: full ? `${base}/full/${p.id}?v=${p.fullPhoto}` : portrait(p),
      full,
      voice: `${base}/say/p-${p.id}`,
      mine: kids.includes(p.id),
      card: cards[i],
    };
  });
  return {
    eventId: o.e.id,
    date: o.date,
    type: o.e.type,
    title: evTitle(o.e),
    opponent: o.e.opponent || '',
    venue: o.e.venue || '',
    location: o.e.location || '',
    time: o.e.allDay ? '' : o.e.time || '',
    meetTime: meetOf(o),
    bring: bringOf(o),
    message: o.data.message || '',
    group: group ?? team.category,
    team: { category: team.category, color: team.color || '#c8102e' },
    club: { name: get('SELECT name FROM club WHERE id = 1')?.name ?? '', logo: clubLogoUrl() },
    published,
    preview: !published,
    hold: s.hold,
    tts: ttsReady(),
    speech: {
      intro: { text: seg.intro.text, url: `${base}/say/intro` },
      outro: seg.outro ? { text: seg.outro.text, url: `${base}/say/outro` } : null,
    },
    ...presentersFor(s, group, base),
    players,
  };
}

export const pressLink = (eventId, date) => sign('press', eventId, date);

/* ------------------------------------------------------------------ routes publiques (lien partagé) */

export const pressPublic = Router();

function publicOcc(token) {
  const [eventId, date] = verify('press', token);
  const o = occ(eventId, date);
  if (!o.row?.published_at || o.e.parents === false) throw new HttpError(404, 'Convocation pas encore publiée');
  return o;
}

pressPublic.get('/public/press/:token', (req, res) => {
  const o = publicOcc(req.params.token);
  res.json(pressPayload(o, { base: `/api/public/press/${req.params.token}`, publicLink: true }));
});

pressPublic.get('/public/press/:token/photo/:pid', (req, res) => {
  const o = publicOcc(req.params.token);
  const p = selectedPlayer(o, req.params.pid);
  if (p.info?.photoConsent !== 'yes') throw new HttpError(404, 'Photo introuvable');
  sendFile(res, join(UPLOADS, `player_${p.id}.jpg`), 'jpeg');
});

pressPublic.get('/public/press/:token/say/:key', async (req, res) => {
  await sendSegment(res, publicOcc(req.params.token), req.params.key);
});

pressPublic.get('/public/press/:token/full/:pid', (req, res) => {
  const o = publicOcc(req.params.token);
  const p = selectedPlayer(o, req.params.pid);
  if (p.info?.photoConsent !== 'yes') throw new HttpError(404, 'Photo introuvable');
  sendFile(res, fullPhotoFile(p.id), 'jpeg');
});

function selectedPlayer(o, pid) {
  if (!(o.data.selection || []).includes(pid)) throw new HttpError(404, 'Joueur introuvable');
  const row = get('SELECT * FROM players WHERE id = ?', pid);
  if (!row || row.team_id !== o.e.teamId) throw new HttpError(404, 'Joueur introuvable');
  return parse(row);
}

function presenterById(id) {
  const p = pressSettings().presenters.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Présentateur introuvable');
  return p;
}


/* ------------------------------------------------------------------ routes connectées */

export const pressApi = Router();

/** Accès à la conférence d'un match : éducateurs de l'équipe (aperçu avant publication), parents après publication. */
function viewerOcc(req) {
  const o = occ(req.params.eventId, req.params.date);
  if (isStaff(req.user)) {
    needTeam(req.user, o.e.teamId, { staff: true });
    return o;
  }
  needTeam(req.user, o.e.teamId);
  if (!o.row?.published_at || o.e.parents === false) throw new HttpError(404, 'Convocation pas encore publiée');
  const kids = childIdsFor(req.user);
  if (!occPlayers(o).some((p) => kids.includes(p.id))) throw new HttpError(404, 'Match introuvable');
  return o;
}

pressApi.get('/convocations/:eventId/:date/press', (req, res) => {
  const o = viewerOcc(req);
  const base = `/api/convocations/${o.e.id}/${o.date}/press`;
  // Aperçu de l'éducateur : les voix se préparent pendant qu'il regarde l'affiche.
  if (isStaff(req.user)) warmPress(o);
  res.json({ ...pressPayload(o, { base, user: req.user }), shareToken: isStaff(req.user) && o.row?.published_at ? pressLink(o.e.id, o.date) : null });
});

pressApi.get('/convocations/:eventId/:date/press/photo/:pid', (req, res) => {
  const o = viewerOcc(req);
  const p = selectedPlayer(o, req.params.pid);
  if (p.info?.photoConsent === 'no') throw new HttpError(404, 'Photo introuvable');
  sendFile(res, join(UPLOADS, `player_${p.id}.jpg`), 'jpeg');
});

pressApi.get('/convocations/:eventId/:date/press/say/:key', async (req, res) => {
  await sendSegment(res, viewerOcc(req), req.params.key);
});

pressApi.get('/convocations/:eventId/:date/press/full/:pid', (req, res) => {
  const o = viewerOcc(req);
  const p = selectedPlayer(o, req.params.pid);
  if (p.info?.photoConsent === 'no') throw new HttpError(404, 'Photo introuvable');
  sendFile(res, fullPhotoFile(p.id), 'jpeg');
});

/* Réglages (éducateurs qui gèrent les convocations). */

const settingsOut = (s) => ({
  ...s,
  tts: ttsReady(),
  voices: FISH_VOICES,
  presenters: s.presenters.map((p) => ({
    ...p,
    sampleUrl: p.voice.sample ? `/api/press/presenters/${p.id}/sample?v=${p.voice.sample.v}` : null,
  })),
});

pressApi.get('/press/settings', (req, res) => {
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  res.json(settingsOut(pressSettings()));
});

pressApi.put('/press/settings', (req, res) => {
  need(req.user, 'convocations.manage');
  const cur = pressSettings();
  const b = req.body || {};
  const next = {
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    intro: b.intro === undefined ? cur.intro : str(b.intro, 400) || DEFAULT_INTRO,
    outro: b.outro === undefined ? cur.outro : str(b.outro, 400),
    hold: b.hold === undefined ? cur.hold : num(b.hold, 1.5, 6, 2),
    presenters: cur.presenters,
  };
  if (Array.isArray(b.presenters)) {
    // L'échantillon de voix ne change que par sa route dédiée.
    next.presenters = b.presenters.slice(0, 2).map((p, i) => {
      const old = cur.presenters.find((x) => x.id === p.id);
      return presenterDefaults({ ...p, id: old?.id ?? newId(), voice: { ...p.voice, sample: old?.voice.sample ?? null, transcript: old?.voice.transcript ?? '' } }, i);
    });
    for (const old of cur.presenters) {
      if (next.presenters.some((p) => p.id === old.id)) continue;
      for (const f of [presenterPhoto(old.id), presenterFace(old.id), presenterSample(old.id)]) drop(f);
    }
  }
  save(next);
  res.json(settingsOut(next));
});

function editPresenter(req, fn) {
  need(req.user, 'convocations.manage');
  const s = pressSettings();
  const p = s.presenters.find((x) => x.id === req.params.id);
  if (!p) throw new HttpError(404, 'Présentateur introuvable');
  fn(p);
  save(s);
  return settingsOut(s);
}

/** Échantillon de la voix du présentateur (10 à 30 s) et sa transcription : Fish Audio clone sa voix. */
pressApi.post('/press/presenters/:id/sample', (req, res) => {
  const { buf, type } = decodeAudio(req.body.audio);
  res.json(editPresenter(req, (p) => {
    writeFileSync(presenterSample(p.id), buf);
    p.voice.sample = { v: now(), type };
    p.voice.transcript = str(req.body.transcript, 400);
  }));
});

pressApi.delete('/press/presenters/:id/sample', (req, res) => {
  res.json(editPresenter(req, (p) => {
    drop(presenterSample(p.id));
    p.voice.sample = null;
    p.voice.transcript = '';
  }));
});

pressApi.get('/press/presenters/:id/sample', (req, res) => {
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const p = presenterById(req.params.id);
  if (!p.voice.sample) throw new HttpError(404, 'Échantillon introuvable');
  sendFile(res, presenterSample(p.id), p.voice.sample.type || 'audio/webm');
});

/** Essai de la voix d'un présentateur (l'identifiant de voix choisi mais pas encore enregistré peut être passé). */
pressApi.post('/press/presenters/:id/test', async (req, res) => {
  if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux éducateurs');
  const p = presenterById(req.params.id);
  const group = str(req.body.group, 12) || p.groups[0] || 'U8';
  const intro = pressSettings().intro.replace(/\{groupe\}/gi, group.replace(/^U(\d+)$/i, 'U $1')).replace(/\{[a-z]+\}/gi, '');
  const id = voiceId(req.body.voice);
  try {
    const file = await speech({ text: `${TONE.intro} ${intro}`, ...(id && !p.voice.sample ? { voice: id } : voiceOf(p)) });
    res.type('audio/mpeg').send(readFileSync(file));
  } catch (e) {
    throw ttsFail(e);
  }
});

/* Fiche joueur : prononciation du prénom et écoute avec la voix du présentateur de sa catégorie. */

pressApi.put('/players/:id/press', (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  if (isStaff(req.user)) need(req.user, 'players.manage');
  const data = JSON.parse(row.data);
  const say = str(req.body.say, 80);
  if (say) data.press = { say };
  else delete data.press;
  run('UPDATE players SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), row.id);
  res.json(playerOut(get('SELECT * FROM players WHERE id = ?', row.id), req.user, true));
});

pressApi.get('/players/:id/say', async (req, res) => {
  const row = playerAccess(req.user, req.params.id);
  const p = parse(row);
  const say = str(req.query.say, 80) || p.press?.say || p.firstName;
  try {
    const file = await speech({ text: `${TONE.name} ${say} !`, ...voiceOf(speakerOf(pressSettings(), playerGroup(p, row.team_id))) });
    res.type('audio/mpeg').send(readFileSync(file));
  } catch (e) {
    throw ttsFail(e);
  }
});
