import { Compass, Flame, HeartHandshake, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DomainKey, Trend } from './types';

/** Crampon : l'icône de l'échelle technique (à la place des étoiles). */
export function Boot({ size = 20, filled = false, className }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path
        d="M3.2 15.6c0-1.3 1-2.3 2.3-2.3h3.2l1.6-7.1h5.1l.6 4.6c2.9.6 4.9 2.3 4.9 4.7v.9c0 .8-.7 1.5-1.5 1.5H4.7c-.8 0-1.5-.7-1.5-1.5z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <path d="M6.5 18v1.8M10.5 18v1.8M14.5 18v1.8M18.5 18v1.8" />
      {filled && <path d="M11 9.2h4.2" stroke="var(--surface)" strokeWidth={1.3} />}
    </svg>
  );
}

export interface Domain {
  key: DomainKey;
  label: string;
  short: string;
  color: string;
  icon: (p: { size?: number; filled?: boolean; className?: string }) => ReactNode;
  skills: { key: string; label: string; hint: string }[];
}

const lucide = (C: typeof Zap) =>
  function Icon({ size = 20, filled, className }: { size?: number; filled?: boolean; className?: string }) {
    return <C size={size} className={className} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.3 : 0} strokeWidth={filled ? 2 : 1.7} />;
  };

export const DOMAINS: Domain[] = [
  {
    key: 'tech', label: 'Technique', short: 'Tech.', color: '#2f9e44', icon: Boot,
    skills: [
      { key: 'conduite', label: 'Conduite de balle', hint: 'Garde le ballon près du pied, même en accélérant' },
      { key: 'passe', label: 'Passe', hint: 'Précision et dosage, des deux pieds' },
      { key: 'controle', label: 'Contrôle', hint: 'Premier contact propre, orienté vers le jeu' },
      { key: 'frappe', label: 'Frappe', hint: 'Cadre, puissance, bonne surface de pied' },
      { key: 'dribble', label: 'Dribble / 1 contre 1', hint: 'Ose provoquer et élimine son adversaire' },
    ],
  },
  {
    key: 'phys', label: 'Physique', short: 'Phys.', color: '#f08c00', icon: lucide(Zap),
    skills: [
      { key: 'vitesse', label: 'Vitesse', hint: 'Démarrage et course' },
      { key: 'endurance', label: 'Endurance', hint: 'Tient l’effort jusqu’à la fin' },
      { key: 'coordination', label: 'Coordination', hint: 'Appuis, agilité, changements de direction' },
      { key: 'equilibre', label: 'Équilibre', hint: 'Reste debout au contact, gainage' },
    ],
  },
  {
    key: 'tact', label: 'Tactique', short: 'Tact.', color: '#1c7ed6', icon: lucide(Compass),
    skills: [
      { key: 'placement', label: 'Placement', hint: 'Occupe son espace, ne suit pas le ballon en grappe' },
      { key: 'vision', label: 'Vision du jeu', hint: 'Lève la tête, voit le partenaire libre' },
      { key: 'repli', label: 'Repli défensif', hint: 'Revient défendre à la perte du ballon' },
      { key: 'demarquage', label: 'Démarquage', hint: 'Se rend disponible, fait des appels' },
    ],
  },
  {
    key: 'mental', label: 'Mental', short: 'Mental', color: '#e03131', icon: lucide(Flame),
    skills: [
      { key: 'concentration', label: 'Concentration', hint: 'Reste attentif pendant les consignes et le jeu' },
      { key: 'confiance', label: 'Confiance', hint: 'Ose tenter, demande le ballon' },
      { key: 'combativite', label: 'Combativité', hint: 'Ne lâche rien, va au duel' },
      { key: 'frustration', label: 'Gestion de l’échec', hint: 'Rebondit après une erreur ou une défaite' },
    ],
  },
  {
    key: 'behav', label: 'Comportement', short: 'Comp.', color: '#7048e8', icon: lucide(HeartHandshake),
    skills: [
      { key: 'ecoute', label: 'Écoute', hint: 'Écoute et applique les consignes' },
      { key: 'equipe', label: 'Esprit d’équipe', hint: 'Encourage, partage le ballon' },
      { key: 'respect', label: 'Respect', hint: 'Adversaires, arbitre, matériel' },
      { key: 'assiduite', label: 'Assiduité', hint: 'Présent, à l’heure, prévient en cas d’absence' },
    ],
  },
];

export const DOMAIN = Object.fromEntries(DOMAINS.map((d) => [d.key, d])) as Record<DomainKey, Domain>;
export const SKILL: Record<string, { key: string; label: string; hint: string; domain: Domain }> = Object.fromEntries(
  DOMAINS.flatMap((d) => d.skills.map((s) => [s.key, { ...s, domain: d }])),
);

export const RATING_WORDS = ['', 'Débute', 'En progrès', 'Correct', 'Bien', 'Excellent'];

/** Postes sur un terrain vu de haut (notre but en bas), coordonnées en % de la largeur / hauteur. */
export const POSITIONS: { key: string; label: string; x: number; y: number }[] = [
  { key: 'BU', label: 'Buteur', x: 50, y: 12 },
  { key: 'AG', label: 'Ailier gauche', x: 17, y: 20 },
  { key: 'AD', label: 'Ailier droit', x: 83, y: 20 },
  { key: 'MOC', label: 'Meneur de jeu', x: 50, y: 33 },
  { key: 'MG', label: 'Milieu gauche', x: 17, y: 46 },
  { key: 'MC', label: 'Milieu central', x: 50, y: 50 },
  { key: 'MD', label: 'Milieu droit', x: 83, y: 46 },
  { key: 'MDC', label: 'Milieu défensif', x: 50, y: 64 },
  { key: 'DG', label: 'Latéral gauche', x: 17, y: 72 },
  { key: 'DC', label: 'Défenseur central', x: 50, y: 77 },
  { key: 'DD', label: 'Latéral droit', x: 83, y: 72 },
  { key: 'GB', label: 'Gardien', x: 50, y: 92 },
];
export const POSITION = Object.fromEntries(POSITIONS.map((p) => [p.key, p]));

export const TRENDS: Record<Trend, { label: string; short: string; tone: string }> = {
  up: { label: 'Progrès / réussite', short: 'Progrès', tone: 'green' },
  flat: { label: 'Observation', short: 'Observé', tone: '' },
  down: { label: 'À travailler', short: 'À travailler', tone: 'warn' },
};

export const FOOT_LABEL = { droit: 'Pied droit', gauche: 'Pied gauche', deux: 'Deux pieds', '': 'Non renseigné' } as const;

/** Suggestions de titres d'objectifs par compétence. */
export const GOAL_IDEAS: Record<string, string[]> = {
  conduite: ['Conduire le ballon tête levée', 'Changer de rythme en conduite'],
  passe: ['Réussir ses passes du pied faible', 'Faire une passe avant de tirer en match'],
  controle: ['Contrôler en orientant vers l’avant'],
  frappe: ['Cadrer 3 frappes sur 5 à l’entraînement', 'Frapper du cou-de-pied'],
  dribble: ['Oser le 1 contre 1 en match'],
  vitesse: ['Démarrer plus vite sur les signaux'],
  endurance: ['Tenir un match entier au même rythme'],
  coordination: ['Passer l’échelle de rythme sans erreur'],
  equilibre: ['Rester debout au contact'],
  placement: ['Garder son poste sans suivre le ballon'],
  vision: ['Lever la tête avant de recevoir'],
  repli: ['Revenir défendre à chaque perte de balle'],
  demarquage: ['Se rendre disponible pour le porteur'],
  concentration: ['Écouter les consignes jusqu’au bout'],
  confiance: ['Demander le ballon en match'],
  combativite: ['Aller au duel sans hésiter'],
  frustration: ['Repartir tout de suite après une erreur'],
  ecoute: ['Appliquer la consigne du jour'],
  equipe: ['Encourager un partenaire à chaque séance'],
  respect: ['Serrer la main de l’adversaire et de l’arbitre'],
  assiduite: ['Prévenir en cas d’absence'],
};

export const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

/** Tests concrets, mesurés en séance (même catalogue que server/players.js). */
export const TESTS: { key: string; label: string; unit: string; lower: boolean; emoji: string; step: number; max: number; hint: string }[] = [
  { key: 'sprint20', label: 'Sprint 20 m', unit: 's', lower: true, emoji: '⚡', step: 0.1, max: 20, hint: 'Départ arrêté, chrono à la main' },
  { key: 'slalom', label: 'Slalom balle au pied', unit: 's', lower: true, emoji: '🌀', step: 0.1, max: 60, hint: '6 plots espacés de 2 m, aller-retour' },
  { key: 'jongles', label: 'Jongles', unit: '', lower: false, emoji: '🦶', step: 1, max: 999, hint: 'Meilleure série sur 3 essais' },
  { key: 'tirs', label: 'Tirs cadrés', unit: '/10', lower: false, emoji: '🎯', step: 1, max: 10, hint: '10 frappes à 9 m, but de foot à 5' },
  { key: 'passes', label: 'Passes réussies', unit: '/10', lower: false, emoji: '🔁', step: 1, max: 10, hint: '10 passes dans une porte à 8 m' },
  { key: 'endurance', label: 'Endurance', unit: 'paliers', lower: false, emoji: '🔋', step: 1, max: 20, hint: 'Test navette, palier atteint' },
];
export const TEST = Object.fromEntries(TESTS.map((t) => [t.key, t]));

export const ALLERGY_PICKS = ['Arachides', 'Fruits à coque', 'Gluten', 'Lactose', 'Œufs', 'Pollen', 'Piqûres d’insectes'];
export const HEALTH_PICKS = ['Asthme (Ventoline)', 'Lunettes', 'Lentilles', 'Diabète', 'Épilepsie', 'Appareil dentaire'];
