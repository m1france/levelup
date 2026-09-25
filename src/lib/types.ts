export type Role = 'admin' | 'dirigeant' | 'coach' | 'parent';

export type Perm =
  | 'members.manage' | 'teams.manage' | 'teams.all' | 'players.manage' | 'notes.view' | 'notes.write'
  | 'exercises.create' | 'library.share' | 'library.validate' | 'trainings.manage' | 'trainings.publish'
  | 'events.manage' | 'album.manage';

export interface User { id: string; name: string; email: string; role: Role }

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

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName?: string;
  birthYear?: number;
  number?: number;
  /** 1 = en progression, 2 = à l'aise, 3 = très à l'aise — sert à équilibrer les groupes. */
  level?: 1 | 2 | 3;
  foot?: 'droit' | 'gauche' | 'deux';
  position?: string;
  updatedAt?: number;
}

export type NoteKind = 'force' | 'faiblesse' | 'objectif' | 'remarque';

export interface PlayerNote {
  id: string;
  playerId: string;
  authorId: string | null;
  authorName?: string;
  kind: NoteKind;
  text: string;
  visibility: 'staff' | 'parents';
  trainingId?: string | null;
  createdAt: number;
  updatedAt: number;
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
  updatedAt?: number;
}
