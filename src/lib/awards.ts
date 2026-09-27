import type { Award, MatchState } from './types';

/** Même catalogue que le serveur (server/reveal.js). */
export const AWARDS: Record<string, Omit<Award, 'key'>> = {
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
const DEF = new Set(['DG', 'DC', 'DD', 'MDC']);
const count = (m: MatchState, t: string, key: 'pid' | 'assist', pid: string) => m.events.filter((e) => e.t === t && e[key] === pid).length;

/** Une récompense par enfant, comme le serveur la calculerait. */
export function autoAwards(m: MatchState, present: string[]) {
  const out: Record<string, string> = {};
  const free = () => present.filter((pid) => !out[pid]);
  const best = (score: (pid: string) => number, key: string) => {
    const list = free().map((pid) => [pid, score(pid)] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (list[0]) out[list[0][0]] = key;
  };
  best((pid) => count(m, 'goal', 'pid', pid), 'scorer');
  best((pid) => count(m, 'goal', 'assist', pid), 'assist');
  best((pid) => m.roles?.[pid]?.GB ?? 0, 'keeper');
  best((pid) => Object.entries(m.roles?.[pid] ?? {}).filter(([k]) => DEF.has(k)).reduce((a, [, v]) => a + v, 0), 'wall');
  best((pid) => m.seconds[pid] ?? 0, 'engine');
  let i = 0;
  for (const pid of free()) {
    const used = new Set(Object.values(out));
    out[pid] = FILLERS.find((k) => !used.has(k)) ?? FILLERS[i++ % FILLERS.length];
  }
  return out;
}

/** Poste d'un emplacement de la formation, d'après sa place sur le terrain (notre but en bas). */
export function slotPosition(s: { x: number; y: number; gk: boolean }) {
  if (s.gk) return 'GB';
  const side = s.x < 34 ? 'G' : s.x > 66 ? 'D' : 'C';
  if (s.y > 60) return side === 'C' ? 'DC' : `D${side}`;
  if (s.y > 30) return side === 'C' ? 'MC' : `M${side}`;
  return side === 'C' ? 'BU' : `A${side}`;
}
