import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Me, Perm, Team } from './types';

interface AppState {
  me: Me;
  team: Team | null;
  setTeamId: (id: string) => void;
  can: (p: Perm) => boolean;
  isStaff: boolean;
  isAdmin: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp hors du fournisseur');
  return v;
}

const TEAM_KEY = 'atelier.team';
const readTeam = () => {
  try {
    return localStorage.getItem(TEAM_KEY);
  } catch {
    return null;
  }
};

export function AppProvider({ initial, children }: { initial: Me; children: ReactNode }) {
  const [me, setMe] = useState(initial);
  const [teamId, setTeamIdState] = useState<string | null>(readTeam);

  const reload = useCallback(async () => {
    setMe(await api.get<Me>('/me'));
  }, []);

  const setTeamId = useCallback((id: string) => {
    setTeamIdState(id);
    try {
      localStorage.setItem(TEAM_KEY, id);
    } catch {
      /* rien */
    }
  }, []);

  const team = me.teams.find((t) => t.id === teamId) ?? me.teams[0] ?? null;

  useEffect(() => {
    document.title = me.club?.name ? `Atelier · ${me.club.name}` : 'Atelier';
  }, [me.club?.name]);

  const value = useMemo<AppState>(
    () => ({
      me,
      team,
      setTeamId,
      can: (p) => me.user.role === 'admin' || me.perms.includes(p),
      isStaff: me.user.role !== 'parent',
      isAdmin: me.user.role === 'admin',
      reload,
    }),
    [me, team, setTeamId, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  dirigeant: 'Dirigeant',
  coach: 'Éducateur',
  parent: 'Joueur / parent',
};

export const CATEGORIES = [
  'U6', 'U7', 'U6/U7', 'U8', 'U9', 'U8/U9', 'U10', 'U11', 'U10/U11', 'U12', 'U13', 'U12/U13',
  'U14', 'U15', 'U16', 'U17', 'U18', 'U19', 'Seniors', 'Vétérans', 'Féminines', 'Futsal', 'Gardiens',
];

const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function parseDate(s: string) {
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0);
}

export function formatDate(s: string, withTime = true) {
  const d = parseDate(s);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withTime && s.includes('T') ? `${base} · ${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}` : base;
}

export function dateTile(s: string) {
  const d = parseDate(s);
  return { day: d.getDate(), month: MONTHS[d.getMonth()], weekday: WEEKDAYS[d.getDay()] };
}

export function relative(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const playerName = (p: { firstName: string; lastName?: string }) => [p.firstName, p.lastName].filter(Boolean).join(' ');
