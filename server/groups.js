/**
 * Catégories d'âge au sein d'une équipe : une équipe « U8/U9 » s'entraîne ensemble,
 * mais ses matchs (convocations, temps de jeu, statistiques) sont séparés entre U8 et U9.
 * La catégorie d'un joueur se déduit de son année de naissance et de la saison.
 */
import { get } from './db.js';

/** Catégories d'une équipe : ['U8', 'U9'] pour « U8/U9 », [] pour une catégorie unique. */
export function groupsOf(category) {
  const found = [...new Set((String(category || '').match(/U\s?\d{1,2}/gi) || []).map((g) => g.replace(/\s/g, '').toUpperCase()))];
  return found.length > 1 ? found.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) : [];
}

/** Année de fin de saison (« 2026-2027 » → 2027 ; sinon la saison en cours, qui change en juillet). */
function seasonEnd(season) {
  const m = /(\d{4})\D+(\d{2,4})/.exec(season || '');
  if (m) return m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2]);
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
}

const teamCache = new Map();
export function teamInfo(teamId) {
  const t = get('SELECT category, season FROM teams WHERE id = ?', teamId);
  const key = `${teamId}|${t?.category}|${t?.season}`;
  if (!teamCache.has(key)) teamCache.set(key, { groups: groupsOf(t?.category), end: seasonEnd(t?.season) });
  return teamCache.get(key);
}

/** Catégorie déduite de l'année de naissance (proposée à la création d'un joueur). */
export function guessGroup(birthYear, teamId) {
  const { groups, end } = teamInfo(teamId);
  if (!groups.length || !birthYear) return null;
  const age = end - Number(birthYear);
  const ages = groups.map((g) => Number(g.slice(1)));
  // Un joueur surclassé ou sous-classé rejoint la catégorie la plus proche.
  const clamped = Math.max(ages[0], Math.min(ages[ages.length - 1], age));
  return `U${clamped}`;
}

/**
 * Catégorie d'un joueur dans son équipe : celle choisie sur sa fiche, sinon celle de son année de naissance
 * (null : équipe à catégorie unique ou catégorie inconnue).
 */
export function playerGroup(p, teamId) {
  const { groups } = teamInfo(teamId);
  if (!groups.length) return null;
  if (groups.includes(p.category)) return p.category;
  return guessGroup(p.birthYear, teamId);
}

/** Catégorie d'un événement, si elle existe dans l'équipe. */
export function eventGroup(e) {
  const g = typeof e?.group === 'string' ? e.group : '';
  return g && teamInfo(e.teamId).groups.includes(g) ? g : null;
}

/** Le joueur est-il concerné par un événement de cette catégorie ? (sans catégorie : tout le monde) */
export const inGroup = (p, teamId, group) => !group || (playerGroup(p, teamId) ?? group) === group;
