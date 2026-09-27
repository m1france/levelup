export type Role = 'admin' | 'dirigeant' | 'coach' | 'parent';

export type Perm =
  | 'members.manage' | 'teams.manage' | 'teams.all' | 'players.manage' | 'notes.view' | 'notes.write'
  | 'exercises.create' | 'library.share' | 'library.validate' | 'trainings.manage' | 'trainings.publish'
  | 'events.manage' | 'album.manage' | 'convocations.manage' | 'club.dashboard' | 'announcements.send';

export interface User { id: string; name: string; email: string; role: Role; phone?: string }

export interface Team {
  id: string;
  name: string;
  category: string;
  season: string;
  color: string;
  staff: { id: string; name: string }[];
  playerCount: number;
}

export interface Me {
  user: User;
  perms: Perm[];
  club: { name: string } | null;
  teams: Team[];
  children: Player[];
}

export interface Member extends User {
  status: 'invited' | 'active' | 'disabled';
  createdAt: number;
  teamIds: string[];
  playerIds: string[];
  inviteToken: string | null;
}

export interface InviteLink {
  token: string;
  role: Exclude<Role, 'admin'>;
  teamId: string | null;
  createdBy: string | null;
  uses: number;
  expiresAt: number;
}

export interface InviteInfo {
  kind: 'personal' | 'link';
  role: Role;
  name?: string;
  email?: string;
  teams: { id: string; category: string; color: string }[];
  players: { id: string; firstName: string; lastName: string }[];
  invitedBy: string | null;
  clubName: string;
}

export type Foot = '' | 'droit' | 'gauche' | 'deux';
export type DomainKey = 'tech' | 'phys' | 'tact' | 'mental' | 'behav';

/** Évaluations et profil sportif (réservés aux éducateurs, sauf postes et pied). */
export interface PlayerProfile {
  ratings?: Record<string, number>;
  /** Moyennes par domaine à chaque jour d'évaluation. */
  history?: { at: string; d: Partial<Record<DomainKey, number>> }[];
  domains?: Partial<Record<DomainKey, number>>;
  foot?: Foot;
  weakFoot?: number;
  positions?: string[];
  /** Tests mesurés : valeurs successives par test. */
  tests?: Record<string, { at: string; v: number }[]>;
}

export interface EmergencyContact { name: string; relation: string; phone: string }

/** Infos pratiques, remplies par les éducateurs ou les parents. */
export interface PlayerInfo {
  contacts: EmergencyContact[];
  allergies: string;
  treatment: string;
  health: string;
  licence: { number: string; status: 'ok' | 'pending' | 'missing' };
  certificate: string | null;
  photoConsent: '' | 'yes' | 'no';
}

export interface FollowUp {
  lastObservation: number | null;
  quietDays: number;
  activeGoals: number;
  overdueGoals: number;
  doneGoals: number;
  rated: number;
  certificate: 'missing' | 'expired' | 'soon' | 'ok';
}

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName?: string;
  birthYear?: number;
  number?: number;
  /** 1 = en progression, 2 = à l'aise, 3 = très à l'aise — déduit des évaluations, sert à équilibrer les groupes. */
  level?: 1 | 2 | 3;
  /** Version de la photo (horodatage), absente sans photo. */
  photo?: number;
  profile?: PlayerProfile;
  info?: PlayerInfo;
  followUp?: FollowUp;
  createdAt?: number;
  updatedAt?: number;
}

export type Trend = 'up' | 'flat' | 'down';

export interface Observation {
  id: string;
  playerId: string;
  authorId: string | null;
  authorName?: string | null;
  skill: string;
  trend: Trend;
  text: string;
  visibility: 'staff' | 'parents';
  trainingId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Objective {
  id: string;
  playerId: string;
  authorId: string | null;
  authorName?: string | null;
  title: string;
  domain: DomainKey | '';
  skill: string;
  due: string | null;
  status: 'active' | 'done' | 'dropped';
  progress: number;
  checkins: { at: number; note: string; progress: number; by: string; trainingId?: string | null }[];
  doneAt: number | null;
  visibility: 'staff' | 'parents';
  createdAt: number;
  updatedAt: number;
}

export interface PlayerMatch {
  eventId: string;
  date: string;
  title: string;
  type: EventType;
  status: 'played' | 'noShow' | 'notSelected' | 'unavailable' | 'upcoming';
  minutes: number | null;
  goals: number;
  starter: boolean;
  score: { us: number; them: number } | null;
  award?: Award | null;
}

/* ------------------------------------------------------------------ exercices */

export type ItemKind =
  | 'player' | 'coach' | 'ball' | 'cone' | 'marker' | 'pole' | 'hoop' | 'hurdle'
  | 'ladder' | 'minigoal' | 'goal' | 'dummy' | 'zone'
  | 'flag' | 'rebounder' | 'wall' | 'ballbag' | 'text' | 'measure';

/** Tenue d'un joueur. */
export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'halves';

export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  /** Rotation en degrés. */
  rot?: number;
  /** Facteur de taille (1 = taille normale). */
  scale?: number;
  color?: string;
  label?: string;
  /** Zones : largeur et hauteur ; mesure : longueur (mètres). */
  w?: number;
  h?: number;
  /** Joueurs : motif du maillot. */
  kit?: KitPattern;
  /** Joueurs : gardien de but (manches longues, gants). */
  keeper?: boolean;
}

export type PathKind = 'pass' | 'dribble' | 'run' | 'shot';

export interface Path {
  id: string;
  kind: PathKind;
  pts: [number, number][];
  color?: string;
}

export interface Frame {
  id: string;
  /** Durée de la transition depuis l'étape précédente (ms). */
  dur: number;
  pos: Record<string, [number, number]>;
  /** Porteur du ballon : id du joueur, ou null si le ballon est libre. */
  owner: Record<string, string | null>;
  /** Trajectoires enregistrées au doigt : [x, y, t∈0..1]. */
  track?: Record<string, [number, number, number][]>;
}

export type FieldPreset = 'foot5' | 'foot8' | 'full' | 'half' | 'square' | 'free';

export interface ExerciseData {
  title: string;
  objective: string;
  instructions: string;
  easier: string;
  harder: string;
  themes: string[];
  duration: number;
  players: number;
  field: { preset: FieldPreset; w: number; h: number };
  items: Item[];
  paths: Path[];
  frames: Frame[];
}

export interface Exercise extends ExerciseData {
  id: string;
  ownerId?: string | null;
  ownerName?: string;
  /** Équipe de l'exercice : partagé entre ses éducateurs, consultable par ses joueurs. */
  teamId?: string | null;
  /** Calculé par le serveur pour l'utilisateur connecté. */
  canEdit?: boolean;
  visibility: 'private' | 'club';
  validated: boolean;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ séances */

export type BlockKind = 'warmup' | 'exercise' | 'rotation' | 'game' | 'break' | 'cooldown';

export interface Station { id: string; title: string; exerciseId?: string | null; coach?: string }

export interface Block {
  id: string;
  kind: BlockKind;
  title: string;
  /** Minutes. Pour une rotation, calculé à partir des ateliers. */
  duration: number;
  exerciseId?: string | null;
  notes?: string;
  stations?: Station[];
  roundMinutes?: number;
  /** Secondes de changement d'atelier. */
  transition?: number;
}

export interface Group { id: string; name: string; color: string; playerIds: string[] }

export interface Training {
  id: string;
  teamId: string;
  date: string;
  title: string;
  theme?: string;
  notes?: string;
  coachNotes?: string;
  blocks: Block[];
  attendance?: string[];
  groups?: Group[];
  published: boolean;
  shareToken?: string | null;
  updatedAt?: number;
  team?: { name: string; category: string };
  club?: string;
  cover?: Cover | null;
}

export interface TrainingPayload { training: Training; exercises: Record<string, Exercise> }

export interface Photo {
  id: string;
  teamId: string;
  authorId: string | null;
  authorName: string | null;
  caption: string;
  width: number;
  height: number;
  takenAt: number;
  createdAt: number;
  tags: { id: string; firstName: string }[];
  reactions: Record<string, number>;
  myReaction: string | null;
  event: { id: string; date: string; title: string; type: EventType; score: { us: number; them: number } | null } | null;
}

/** Exercice de couverture renvoyé avec la liste des séances. */
export type Cover = Pick<Exercise, 'id' | 'title' | 'field' | 'items' | 'paths' | 'frames'>;

export type EventType = 'training' | 'match' | 'plateau' | 'tournament' | 'meeting' | 'other';

export interface Recurrence {
  freq: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** Jours de la semaine (0 = dimanche) pour une récurrence hebdomadaire. */
  days: number[];
  until: string | null;
  count: number | null;
}

export interface TeamEvent {
  id: string;
  teamId: string;
  type: EventType;
  title: string;
  /** Première date (AAAA-MM-JJ). */
  start: string;
  allDay: boolean;
  time: string;
  endTime: string;
  /** Heure de rendez-vous / convocation. */
  meetTime: string;
  location: string;
  opponent: string;
  venue: '' | 'home' | 'away' | 'neutral';
  notes?: string;
  color: string;
  parents: boolean;
  recurrence: Recurrence;
  /** Occurrences annulées. */
  exdates: string[];
  conv?: EventConv;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ convocations */

export interface When { on: boolean; days: number; time: string }

export interface ConvSettings {
  /** Demande des disponibilités aux parents (J-days à time). */
  request: When;
  /** Relances aux parents qui n'ont pas répondu. */
  reminders: { days: number; time: string }[];
  /** Réponse souhaitée avant. */
  answerBy: When;
  /** Date limite de publication de la convocation. */
  deadline: { days: number; time: string };
  /** Alerte à l'éducateur N heures avant la date limite. */
  coachAlert: number;
  /** Prévenir les responsables du club si la date limite est dépassée. */
  escalate: boolean;
  /** Rappel la veille aux parents des convoqués. */
  eve: When;
  squad: number;
  onField: number;
  periods: number;
  periodMinutes: number;
  /** Buts et passes décisives individuels (à désactiver chez les plus jeunes). */
  stats: boolean;
  bring: string;
}

export interface EventConv { enabled?: boolean; presetId?: string | null; custom?: ConvSettings | null }

export interface ConvPreset { id: string; teamId: string | null; name: string; isDefault: boolean; settings: ConvSettings }

export type Availability = 'yes' | 'no' | 'maybe';
export type ConvPhase = 'upcoming' | 'collecting' | 'late' | 'published' | 'played' | 'missed';

export interface ConvTimeline {
  request: number | null;
  reminders: number[];
  answerBy: number | null;
  deadline: number;
  coachAlert: number;
  eve: number | null;
  start: number;
}

export interface ConvEventInfo {
  eventId: string;
  date: string;
  teamId: string;
  type: EventType;
  title: string;
  time: string;
  endTime: string;
  meetTime: string;
  location: string;
  opponent: string;
  venue: TeamEvent['venue'];
  color: string;
  bring: string;
  message: string;
}

export interface ConvSnapshot extends ConvEventInfo {
  phase: ConvPhase;
  timeline: ConvTimeline;
  squad: number;
  selected: number;
  counts: { yes: number; maybe: number; no: number; none: number };
  total: number;
  publishedAt: number | null;
  publishedLate: boolean | null;
  reads: number;
  readers: number;
  score: { us: number; them: number; finished: boolean } | null;
  presetName: string | null;
}

export interface PlayerMetrics {
  matches: number;
  convoked: number;
  played: number;
  notSelected: number;
  unavailable: number;
  noShow: number;
  minutes: number;
  starts: number;
  goals: number;
  assists: number;
  upcoming: number;
  lastPlayed: string | null;
  lastNotSelected: string | null;
  streakOut: number;
  opportunities: number;
  share: number | null;
  minutesPerMatch: number | null;
  delta: number;
}

export interface ConvPlayer {
  id: string;
  firstName: string;
  lastName: string;
  number?: number;
  positions: string[];
  availability: { status: Availability; note: string; at: number; by: string | null } | null;
  selected: boolean;
  notified: 'in' | 'out' | null;
  metrics: PlayerMetrics;
  reasons: { tone: 'up' | 'down'; text: string }[];
  rank: number;
  answerToken: string;
  parents: { id: string; name: string; readAt: number | null; push: boolean }[];
}

export interface MatchEvent { id: string; t: 'goal' | 'against' | 'sub' | 'period'; pid?: string; assist?: string; out?: string; period: number; sec: number }

export interface MatchState {
  formation: string;
  /** Joueur par poste de la formation (null = poste vide). */
  field: (string | null)[];
  absent: string[];
  starters: string[];
  period: number;
  running: boolean;
  /** Horodatage du dernier démarrage du chrono. */
  since: number | null;
  /** Secondes écoulées dans la période en cours. */
  elapsed: number;
  /** Secondes jouées par joueur. */
  seconds: Record<string, number>;
  /** Secondes par poste et par joueur (poste le plus joué sur la carte). */
  roles?: Record<string, Record<string, number>>;
  events: MatchEvent[];
  score: { us: number; them: number };
  started: boolean;
  finished: boolean;
}

export interface ConvDetail extends ConvSnapshot {
  settings: ConvSettings;
  custom: boolean;
  presetId: string | null;
  selection: string[];
  suggestion: string[];
  stats: { matches: number; mean: number; equity: number | null; minutesEquity: number | null; avgMinutes: number | null };
  match: MatchState | null;
  summary: { text: string; at: number } | null;
  awards?: Record<string, string> | null;
  requestSent: boolean;
  players: ConvPlayer[];
}

export type TicketStatus = 'convoked' | 'not_selected' | 'answered' | 'to_answer' | 'past';

export interface Ticket extends ConvEventInfo {
  key: string;
  child: { id: string; firstName: string };
  status: TicketStatus;
  phase: ConvPhase;
  availability: { status: Availability; note: string; at: number; by: string | null } | null;
  timeline: { request: number | null; answerBy: number | null; deadline: number; start: number };
  publishedAt: number | null;
  read: boolean;
  squad: { id: string; firstName: string; number?: number }[];
  result: { us: number; them: number; minutes: number | null; goals: number | null; summary: string } | null;
}

export interface TeamStats {
  matches: number;
  mean: number;
  equity: number | null;
  minutesEquity: number | null;
  avgMinutes: number | null;
  players: (PlayerMetrics & { id: string; firstName: string; lastName: string; number?: number })[];
}

export interface ClubTeamOverview {
  team: { id: string; category: string; color: string };
  staff: string[];
  players: number;
  past: number;
  onTime: number;
  equity: number | null;
  upcoming: ConvSnapshot[];
}

export interface AppNotification { id: string; kind: string; title: string; body: string; url: string; createdAt: number; read: boolean }

/* ------------------------------------------------------------------ cartes de fin de match */

export interface Award { key: string; label: string; emoji: string; tier: 'totw' | 'red' | 'blue' | 'green' | 'silver' | 'gold' | 'pink' }

export interface PlayerCard {
  id: string;
  firstName: string;
  number?: number;
  photo: string | null;
  position: string;
  ovr: number;
  stats: [string, number][];
  award: Award;
  minutes: number;
  goals: number;
  assists: number;
  mine: boolean;
}

export interface Reveal {
  eventId: string;
  date: string;
  title: string;
  opponent: string;
  venue: TeamEvent['venue'];
  team: { category: string; color: string };
  club: string;
  score: { us: number; them: number };
  summary: string;
  cards: PlayerCard[];
  shareToken?: string | null;
}

/* ------------------------------------------------------------------ bulletins */

export interface BulletinSnapshot {
  progress: { domain: DomainKey; before: number | null; now: number | null }[];
  strengths: { skill: string; v: number }[];
  attendance: { present: number; total: number };
  matches: { played: number; opportunities: number; minutes: number; goals: number; assists: number };
  awards: (Award & { date: string; title: string })[];
  goals: { done: { title: string; domain: DomainKey | '' }[]; active: { title: string; domain: DomainKey | ''; progress: number }[] };
  records: { key: string; best: number; first: number; count: number }[];
  positions: string[];
}

export interface Bulletin {
  id: string;
  playerId: string;
  period: string;
  from: string;
  to: string;
  message: string;
  authorName: string | null;
  publishedAt: number | null;
  createdAt: number;
  snapshot: BulletinSnapshot;
  player?: { id: string; firstName: string; lastName: string; number?: number; birthYear?: number; photo: string | null };
  team?: { category: string; color: string };
  club?: string;
}

/* ------------------------------------------------------------------ covoiturage */

export type Direction = 'aller' | 'retour' | 'both';

export interface CarpoolOffer {
  id: string;
  driver: { id: string; name: string };
  mine: boolean;
  direction: Direction;
  seats: number;
  free: number;
  place: string;
  time: string;
  note: string;
  bookings: { playerId: string; firstName: string; mine: boolean }[];
}

export interface CarpoolRequest {
  id: string;
  parent: { id: string; name: string };
  mine: boolean;
  direction: Direction;
  note: string;
  playerId: string;
  firstName: string;
  solved: boolean;
}

export interface Carpool {
  eventId: string;
  date: string;
  title: string;
  time: string;
  meetTime: string;
  location: string;
  offers: CarpoolOffer[];
  requests: CarpoolRequest[];
  free: number;
  needs: number;
  kids: { id: string; firstName: string; booked: boolean }[];
  teamId?: string;
  iDrive?: boolean;
  iNeed?: boolean;
}

/* ------------------------------------------------------------------ messagerie */

export interface ChatThread {
  id: string;
  kind: 'team' | 'staff' | 'direct';
  teamId: string | null;
  title: string;
  color: string | null;
  category: string | null;
  otherId?: string | null;
  otherRole?: Role | null;
  unread: number;
  last: { preview: string; author: string | null; mine: boolean; at: number } | null;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  userId: string | null;
  author: string | null;
  mine: boolean;
  kind: 'text' | 'image' | 'carpool' | 'poll' | 'tasks' | 'match' | 'location' | 'deleted';
  body: string;
  at: number;
  reactions: { emoji: string; mine: boolean; name: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

export interface ChatContact { id: string; name: string; kids: string[]; team: string; coach?: boolean }

/* ------------------------------------------------------------------ club */

export interface Announcement {
  id: string;
  title: string;
  body: string;
  important: boolean;
  emoji: string;
  teams: { id: string; category: string; color: string }[];
  roles: string[];
  createdAt: number;
  author: { id: string | null; name: string };
  mine: boolean;
  target: boolean;
  read: boolean;
  stats: { total: number; read: number } | null;
  recipients?: { id: string; name: string; role: Role; readAt: number | null; kids: string[] }[] | null;
}

export interface ClubTeamStats {
  team: { id: string; category: string; color: string };
  staff: string[];
  players: number;
  parents: number;
  attendance: number | null;
  attendanceTrend: number[];
  trainings: number;
  matches: number;
  onTime: number | null;
  published: number;
  responseRate: number | null;
  equity: number | null;
  minutesEquity: number | null;
  licences: number;
}

export interface RosterRow {
  id: string;
  firstName: string;
  lastName: string;
  birthYear: number | null;
  number: number | null;
  team: { id: string; category: string; color: string };
  licence: { number: string; status: 'ok' | 'pending' | 'missing' };
  certificate: string | null;
  photoConsent: '' | 'yes' | 'no';
  contacts: EmergencyContact[];
  allergies: string;
  parents: { id: string; name: string; email: string; phone: string; status: string }[];
}
