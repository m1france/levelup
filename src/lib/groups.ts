import type { Player, Team } from './types';

/**
 * Catégories d'une équipe : ['U8', 'U9'] pour « U8/U9 », [] pour une catégorie unique.
 * Les matchs, convocations et statistiques sont séparés par catégorie (même logique que server/groups.js).
 */
export function groupsOf(category: string | undefined): string[] {
  const found = [...new Set((category ?? '').match(/U\s?\d{1,2}/gi)?.map((g) => g.replace(/\s/g, '').toUpperCase()) ?? [])];
  return found.length > 1 ? found.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) : [];
}

function seasonEnd(season: string | undefined) {
  const m = /(\d{4})\D+(\d{2,4})/.exec(season ?? '');
  if (m) return m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2]);
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
}

/** Catégorie d'un joueur (null : équipe à catégorie unique ou année de naissance inconnue). */
export function playerGroup(p: Pick<Player, 'birthYear'>, team: Pick<Team, 'category' | 'season'> | null | undefined): string | null {
  const groups = groupsOf(team?.category);
  if (!groups.length || !p.birthYear) return null;
  const ages = groups.map((g) => Number(g.slice(1)));
  const age = seasonEnd(team?.season) - p.birthYear;
  return `U${Math.max(ages[0], Math.min(ages[ages.length - 1], age))}`;
}
