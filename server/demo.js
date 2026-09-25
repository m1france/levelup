/**
 * Données de démarrage : une bibliothèque d'exercices animés validés (toujours installée)
 * et, en option, une équipe U8/U9 d'exemple avec effectif, séance, remarques et défi.
 *
 * Modèle d'exercice (voir src/lib/types.ts) : coordonnées en mètres, origine en haut à gauche.
 * frames[0] = position de départ ; chaque frame suivante ne contient que ce qui change.
 */
import { run } from './db.js';
import { newId } from './auth.js';

const now = () => Date.now();

function ex(meta, build) {
  const items = [];
  const paths = [];
  const frames = [{ id: 'f0', dur: 0, pos: {}, owner: {} }];
  let n = 0;
  const api = {
    add(kind, x, y, extra = {}) {
      const id = `${kind[0]}${++n}`;
      items.push({ id, kind, x, y, ...extra });
      return id;
    },
    path(kind, pts) {
      paths.push({ id: `l${++n}`, kind, pts });
    },
    own(ball, player) {
      frames[0].owner[ball] = player;
    },
    frame(dur, pos, owner = {}) {
      frames.push({ id: `f${frames.length}`, dur, pos, owner });
    },
  };
  build(api);
  return { ...meta, items, paths, frames };
}

export const STARTER_EXERCISES = [
  ex({
    title: 'Réveil coordination',
    themes: ['Échauffement', 'Coordination'],
    duration: 10, players: 8,
    objective: 'Activer les appuis et la coordination avant de toucher le ballon.',
    instructions: "Les joueurs passent dans l'échelle (un appui par case), sautent les haies pieds joints puis finissent en slalom entre les piquets.\nRetour en trottinant sur le côté.",
    easier: 'Supprimer les haies, marcher dans l’échelle.',
    harder: 'Deux appuis par case, sauter les haies sur un pied.',
    field: { preset: 'free', w: 26, h: 12 },
  }, (e) => {
    e.add('ladder', 6, 6, { rot: 0 });
    e.add('hurdle', 12, 6); e.add('hurdle', 14, 6); e.add('hurdle', 16, 6);
    for (const x of [19, 21, 23]) e.add('pole', x, 6);
    const p1 = e.add('player', 2, 6, { color: 'blue' });
    e.add('player', 1, 7.4, { color: 'blue' });
    e.add('player', 1, 4.6, { color: 'blue' });
    e.path('run', [[2, 6], [9, 6], [17, 6]]);
    e.path('run', [[17, 6], [19, 5], [21, 7], [23, 5], [25, 6]]);
    e.frame(1400, { [p1]: [8.6, 6] });
    e.frame(1400, { [p1]: [17, 6] });
    e.frame(1500, { [p1]: [22, 7.2] });
    e.frame(900, { [p1]: [25, 6] });
  }),

  ex({
    title: 'Le relais slalom',
    themes: ['Conduite'],
    duration: 12, players: 8,
    objective: 'Conduire le ballon près du pied en changeant de direction.',
    instructions: "Deux équipes en relais. Le premier slalome entre les piquets, contourne la coupelle et revient donner le ballon au suivant.\nLa première équipe dont tous les joueurs sont passés gagne.",
    easier: 'Écarter les piquets et autoriser les deux pieds.',
    harder: 'Pied faible uniquement ou chrono à battre.',
    field: { preset: 'free', w: 24, h: 16 },
  }, (e) => {
    for (const [y, color] of [[5, 'blue'], [11, 'red']]) {
      e.add('cone', 3.5, y - 1.2, { color: 'orange' });
      e.add('cone', 3.5, y + 1.2, { color: 'orange' });
      for (const x of [7, 10, 13, 16]) e.add('pole', x, y);
      e.add('cone', 20, y, { color: 'yellow' });
      const a = e.add('player', 2.5, y, { color });
      const b = e.add('player', 1, y, { color });
      e.add('player', 1, y + (y < 8 ? -1.4 : 1.4), { color });
      const ball = e.add('ball', 3.3, y);
      e.own(ball, a);
      e.path('dribble', [[3, y], [8.5, y - 1.2], [11.5, y + 1.2], [14.5, y - 1.2], [17.5, y + 1.2], [20, y]]);
      Object.assign(e, { [color]: { a, b, ball } });
    }
    const { blue: B, red: R } = e;
    e.frame(1100, { [B.a]: [8.5, 3.8], [R.a]: [8.5, 12.2] });
    e.frame(900, { [B.a]: [11.5, 6.2], [R.a]: [11.5, 9.8] });
    e.frame(900, { [B.a]: [14.5, 3.8], [R.a]: [14.5, 12.2] });
    e.frame(900, { [B.a]: [17.5, 6.2], [R.a]: [17.5, 9.8] });
    e.frame(800, { [B.a]: [21, 5], [R.a]: [21, 11] });
    e.frame(1600, { [B.a]: [4, 6.4], [R.a]: [4, 9.6] });
    e.frame(600, { [B.b]: [2.5, 5], [R.b]: [2.5, 11] }, { [B.ball]: B.b, [R.ball]: R.b });
  }),

  ex({
    title: 'Passe et suis en triangle',
    themes: ['Passe'],
    duration: 12, players: 6,
    objective: "Réaliser une passe précise avec l'intérieur du pied puis se déplacer.",
    instructions: "Trois plots en triangle. Je fais la passe au joueur suivant puis je cours prendre sa place (« je passe et je suis »).\nOn change de sens toutes les 2 minutes.",
    easier: 'Rapprocher les plots, autoriser un contrôle avant la passe.',
    harder: 'Jouer en une touche, passe du pied faible.',
    field: { preset: 'free', w: 16, h: 14 },
  }, (e) => {
    const A = [3, 11], B = [13, 11], C = [8, 3];
    for (const p of [A, B, C]) e.add('marker', p[0], p[1] + 1.1, { color: 'orange' });
    const a1 = e.add('player', A[0], A[1], { color: 'yellow' });
    const a2 = e.add('player', A[0] - 1.6, A[1] + 1.2, { color: 'yellow' });
    const b1 = e.add('player', B[0], B[1], { color: 'yellow' });
    const c1 = e.add('player', C[0], C[1], { color: 'yellow' });
    e.add('player', C[0] + 1.6, C[1] - 0.8, { color: 'yellow' });
    const ball = e.add('ball', A[0] + 0.8, A[1]);
    e.own(ball, a1);
    e.path('pass', [A, B]); e.path('pass', [B, C]); e.path('pass', [C, A]);
    e.path('run', [[3, 12.4], [11.6, 12.4]]);
    e.frame(900, {}, { [ball]: b1 });
    e.frame(1300, { [a1]: [11.6, 12.3] });
    e.frame(900, {}, { [ball]: c1 });
    e.frame(1300, { [b1]: [9.4, 3.8], [a1]: [13, 11] });
    e.frame(900, {}, { [ball]: a2 });
    e.frame(1300, { [c1]: [3.4, 12.2], [a2]: [3, 11] });
  }),

  ex({
    title: 'Conduis et tire !',
    themes: ['Tir', 'Conduite'],
    duration: 12, players: 8,
    objective: 'Enchaîner une conduite rapide et une frappe cadrée.',
    instructions: 'Je conduis jusqu’à la porte de coupelles, j’accélère, puis je tire avant la ligne jaune.\nJe récupère mon ballon et je reviens par le côté.',
    easier: 'Tirer sans gardien, rapprocher la ligne de tir.',
    harder: 'Ajouter un défenseur qui part derrière le tireur.',
    field: { preset: 'free', w: 26, h: 18 },
  }, (e) => {
    e.add('goal', 25, 9, { rot: 0 });
    e.add('cone', 12, 7.4, { color: 'orange' }); e.add('cone', 12, 10.6, { color: 'orange' });
    for (const y of [6, 8, 10, 12]) e.add('cone', 17, y, { color: 'yellow' });
    const p = e.add('player', 3, 9, { color: 'red' });
    e.add('player', 1.5, 9, { color: 'red' }); e.add('player', 1.5, 10.6, { color: 'red' });
    const gk = e.add('player', 24, 9, { color: 'green', label: 'G' });
    const ball = e.add('ball', 3.8, 9);
    e.own(ball, p);
    e.path('dribble', [[3.6, 9], [12, 9], [16, 9]]);
    e.path('shot', [[16.4, 9], [24.6, 7.6]]);
    e.frame(1400, { [p]: [12, 9] });
    e.frame(900, { [p]: [16, 9] });
    e.frame(700, { [ball]: [24.6, 7.6], [gk]: [24, 9.6] }, { [ball]: null });
    e.frame(1800, { [p]: [20, 15], [gk]: [24, 9] });
  }),

  ex({
    title: 'Les déménageurs',
    themes: ['Jeu', 'Conduite'],
    duration: 10, players: 8,
    objective: 'Conduire vite en levant la tête pour prendre des informations.',
    instructions: "Au signal, chacun va chercher un ballon au centre et le ramène en conduite dans sa maison.\nUn seul ballon à la fois. Quand le centre est vide, on peut aller en voler chez l’adversaire !",
    easier: 'Autoriser à ramener le ballon à la main pour les plus jeunes.',
    harder: 'Interdire le pied fort, ou ajouter une troisième maison.',
    field: { preset: 'square', w: 20, h: 20 },
  }, (e) => {
    e.add('zone', 10, 10, { w: 6, h: 6, color: 'white' });
    e.add('zone', 2.5, 10, { w: 4, h: 7, color: 'blue' });
    e.add('zone', 17.5, 10, { w: 4, h: 7, color: 'red' });
    const balls = [[8.5, 8.5], [11.5, 8.5], [10, 10], [8.5, 11.5], [11.5, 11.5], [10, 8]].map(([x, y]) => e.add('ball', x, y));
    const blue = [[2, 7.5], [3, 9.2], [2, 10.8], [3, 12.5]].map(([x, y]) => e.add('player', x, y, { color: 'blue' }));
    const red = [[18, 7.5], [17, 9.2], [18, 10.8], [17, 12.5]].map(([x, y]) => e.add('player', x, y, { color: 'red' }));
    e.path('run', [[3.5, 9.2], [8, 8.6]]);
    e.path('dribble', [[8, 8.6], [3.5, 8.6]]);
    e.frame(1200, { [blue[1]]: [7.9, 8.6], [red[1]]: [12.1, 8.6], [blue[3]]: [7.9, 11.5], [red[3]]: [12.1, 11.5] });
    e.frame(300, {}, { [balls[0]]: blue[1], [balls[1]]: red[1], [balls[3]]: blue[3], [balls[4]]: red[3] });
    e.frame(1600, { [blue[1]]: [3, 8.6], [red[1]]: [17, 8.6], [blue[3]]: [3, 11.8], [red[3]]: [17, 11.8], [blue[0]]: [9.2, 10], [red[0]]: [10.8, 10.2] });
    e.frame(300, {}, { [balls[2]]: blue[0], [balls[5]]: red[0] });
    e.frame(1500, { [blue[0]]: [2.4, 7], [red[0]]: [17.6, 7] });
  }),

  ex({
    title: 'Les éperviers',
    themes: ['Dribble / 1c1', 'Jeu'],
    duration: 10, players: 10,
    objective: 'Protéger son ballon et dribbler pour passer un adversaire.',
    instructions: "Les joueurs doivent traverser le terrain en conduite sans se faire prendre le ballon par les éperviers.\nUn joueur qui perd son ballon devient épervier à son tour.",
    easier: 'Un seul épervier qui n’a le droit que de toucher le ballon avec la main.',
    harder: 'Trois éperviers, ou traversée aller-retour obligatoire.',
    field: { preset: 'square', w: 20, h: 20 },
  }, (e) => {
    for (const y of [2, 7, 13, 18]) { e.add('cone', 1, y, { color: 'orange' }); e.add('cone', 19, y, { color: 'orange' }); }
    const ys = [3, 6, 9, 12, 15, 18];
    const ps = ys.map((y) => e.add('player', 2, y - 0.5, { color: 'blue' }));
    const bs = ys.map((y, i) => { const b = e.add('ball', 2.8, y - 0.5); e.own(b, ps[i]); return b; });
    const h1 = e.add('player', 9, 7, { color: 'red' });
    const h2 = e.add('player', 11, 13, { color: 'red' });
    e.path('dribble', [[2.8, 8.5], [8, 9], [12, 7.5], [18, 8]]);
    e.frame(1500, { [ps[0]]: [8, 3], [ps[1]]: [8.5, 5.5], [ps[2]]: [8, 9], [ps[3]]: [9, 11.5], [ps[4]]: [8.5, 14.5], [ps[5]]: [8, 17], [h1]: [9.5, 8.4], [h2]: [10, 13.5] });
    e.frame(700, { [h2]: [9.6, 14.6] }, { [bs[4]]: h2 });
    e.frame(1500, { [ps[0]]: [18, 2.5], [ps[1]]: [18, 5.5], [ps[2]]: [18, 8], [ps[3]]: [18, 11.5], [ps[5]]: [18, 17.5], [h1]: [12, 9], [h2]: [12, 16], [ps[4]]: [10, 14] });
  }),

  ex({
    title: 'Match 4 contre 4',
    themes: ['Jeu'],
    duration: 15, players: 8,
    objective: 'Réinvestir les gestes travaillés dans le jeu, marquer en équipe.',
    instructions: "Match libre à 4 contre 4 sur petit terrain.\nBut valable seulement si toute l’équipe a passé la ligne médiane (variante à thème).",
    easier: 'Ajouter un joker qui joue toujours avec l’équipe qui a le ballon.',
    harder: 'Maximum trois touches de balle par joueur.',
    field: { preset: 'foot5', w: 35, h: 25 },
  }, (e) => {
    e.add('goal', 34.4, 12.5, { rot: 0 });
    e.add('goal', 0.6, 12.5, { rot: 180 });
    const b = [[6, 7], [6, 18], [13, 10], [15, 16]].map(([x, y]) => e.add('player', x, y, { color: 'blue' }));
    const r = [[28, 8], [28, 17], [21, 12.5], [33, 12.5]].map(([x, y]) => e.add('player', x, y, { color: 'red' }));
    const ball = e.add('ball', 13.8, 10);
    e.own(ball, b[2]);
    e.path('pass', [[13.8, 10.4], [15, 15.4]]);
    e.path('dribble', [[15.8, 16], [24, 17]]);
    e.path('shot', [[24.6, 16.6], [34, 13.4]]);
    e.frame(800, {}, { [ball]: b[3] });
    e.frame(1500, { [b[3]]: [24, 17], [b[2]]: [22, 9], [r[1]]: [27, 15.5], [r[2]]: [22, 13], [b[0]]: [12, 8], [b[1]]: [13, 19] });
    e.frame(600, { [ball]: [34, 13.4], [r[3]]: [33, 13.2] }, { [ball]: null });
  }),
];

/** Bibliothèque du club : sans auteur (« Club »), modifiable par l'administrateur uniquement. */
export function seedStarterLibrary() {
  for (const e of STARTER_EXERCISES) {
    run(`INSERT INTO exercises VALUES (?, NULL, 'club', 1, ?, ?, ?)`, newId(), JSON.stringify(e), now(), now());
  }
}

const NAMES = [
  ['Léo', 2018, 3], ['Inès', 2018, 2], ['Nolan', 2018, 2], ['Jade', 2019, 1], ['Adam', 2018, 3], ['Mila', 2019, 2],
  ['Sacha', 2019, 1], ['Rayan', 2018, 2], ['Louise', 2018, 3], ['Tom', 2019, 2], ['Yanis', 2018, 1], ['Lina', 2019, 2],
  ['Hugo', 2018, 2], ['Noé', 2019, 3], ['Kaïs', 2018, 2], ['Chloé', 2019, 1], ['Malo', 2018, 2], ['Ibrahim', 2019, 1],
];

function nextWednesday() {
  const d = new Date();
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7));
  return `${d.toISOString().slice(0, 10)}T14:00`;
}

export function seedDemoTeam(adminId) {
  const teamId = newId();
  run('INSERT INTO teams VALUES (?, ?, ?, ?, ?, ?)', teamId, 'U8/U9', 'U8/U9', '2026-2027', '#1f6f4a', now());
  run('INSERT INTO team_staff VALUES (?, ?)', teamId, adminId);
  const ids = NAMES.map(([firstName, birthYear, level], i) => {
    const id = newId();
    run('INSERT INTO players VALUES (?, ?, ?, ?, ?)', id, teamId, JSON.stringify({ firstName, birthYear, level, number: i + 1 }), now(), now());
    return id;
  });

  const exIds = Object.fromEntries(
    STARTER_EXERCISES.map((e) => [e.title, newId()]),
  );
  // Copies personnelles pour que la séance d'exemple soit modifiable.
  for (const e of STARTER_EXERCISES) {
    run(`INSERT INTO exercises VALUES (?, ?, 'private', 0, ?, ?, ?)`, exIds[e.title], adminId, JSON.stringify(e), now(), now());
  }
  const block = (kind, title, duration, extra = {}) => ({ id: newId(6), kind, title, duration, ...extra });
  const training = {
    title: 'Conduite de balle & finition',
    theme: 'Conduite',
    notes: 'Pensez aux gourdes et aux protège-tibias 🙂',
    coachNotes: 'Surveiller la conduite pied faible. Rappel : photo d’équipe à la fin.',
    blocks: [
      block('warmup', 'Réveil coordination', 10, { exerciseId: exIds['Réveil coordination'] }),
      block('rotation', 'Ateliers tournants', 27, {
        roundMinutes: 8,
        transition: 30,
        stations: [
          { id: newId(6), title: 'Relais slalom', exerciseId: exIds['Le relais slalom'] },
          { id: newId(6), title: 'Passe et suis', exerciseId: exIds['Passe et suis en triangle'] },
          { id: newId(6), title: 'Conduis et tire', exerciseId: exIds['Conduis et tire !'] },
        ],
      }),
      block('break', 'Pause boisson', 3),
      block('game', 'Match 4 contre 4', 15, { exerciseId: exIds['Match 4 contre 4'] }),
      block('cooldown', 'Retour au calme & bilan', 5, { notes: 'Chacun dit ce qu’il a le mieux réussi aujourd’hui.' }),
    ],
  };
  run('INSERT INTO trainings VALUES (?, ?, ?, 0, NULL, ?, ?, ?)', newId(), teamId, nextWednesday(), JSON.stringify(training), now(), now());

  const note = (i, kind, text, visibility = 'staff') =>
    run('INSERT INTO player_notes VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)', newId(), ids[i], adminId, kind, text, visibility, now(), now());
  note(0, 'force', 'Très bonne conduite de balle, garde le ballon près du pied même en accélérant.');
  note(0, 'faiblesse', 'Ne lève pas assez la tête, oublie ses partenaires démarqués.');
  note(0, 'objectif', 'Faire au moins une passe avant de tirer pendant les matchs.');
  note(3, 'remarque', 'Un peu timide en début de séance, se lâche pendant les jeux. À encourager.');
  note(3, 'force', 'Super attitude, toujours la première à ranger le matériel !', 'parents');
  note(4, 'faiblesse', 'Frappe uniquement du pied droit.');

  // Calendrier : entraînement tous les mercredis et un match le samedi suivant.
  const wed = nextWednesday().slice(0, 10);
  const sat = new Date(`${wed}T12:00`);
  sat.setDate(sat.getDate() + 3);
  const ev = (data) => run('INSERT INTO events VALUES (?, ?, ?, ?, ?)', newId(), teamId, JSON.stringify({
    title: '', allDay: false, endTime: '', meetTime: '', location: '', opponent: '', venue: '', notes: '', color: '',
    parents: true, exdates: [], recurrence: { freq: 'none', interval: 1, days: [], until: null, count: null }, ...data,
  }), now(), now());
  ev({ type: 'training', title: 'Entraînement', start: wed, time: '14:00', endTime: '15:30', location: 'Stade municipal',
    recurrence: { freq: 'weekly', interval: 1, days: [3], until: null, count: null } });
  ev({ type: 'match', start: sat.toISOString().slice(0, 10), time: '10:00', meetTime: '09:15', opponent: 'Teyran', venue: 'away', location: 'Stade de Teyran' });
}
