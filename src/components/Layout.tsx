import { Check, CalendarDays, CloudOff, Images, LayoutGrid, LogOut, Settings, UserRound, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, onOutboxChange } from '../lib/api';
import { ROLE_LABELS, useApp } from '../lib/store';
import type { Team } from '../lib/types';
import { Avatar } from './ui';

function useNetwork() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const off = onOutboxChange(setPending);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      off();
    };
  }, []);
  return { online, pending };
}

export function NetworkPill() {
  const { online, pending } = useNetwork();
  if (online && !pending) return null;
  return (
    <span className="offline-pill net-float" title="Les modifications seront envoyées au retour du réseau">
      <CloudOff size={13} />
      {online ? `${pending} en attente` : 'Hors ligne'}
    </span>
  );
}

/** Pastille d'équipe : sa couleur et sa catégorie. */
export function TeamBadge({ team, size = 36 }: { team: Team | null; size?: number }) {
  const label = team ? team.category.replace(/\s+/g, '') : '·';
  return (
    <span
      className="team-badge"
      style={{ width: size, height: size, background: team?.color ?? 'var(--line-strong)', fontSize: label.length > 3 ? size * 0.26 : size * 0.33 }}
    >
      {label}
    </span>
  );
}

function TeamMenu({ onClose }: { onClose: () => void }) {
  const { me, team, setTeamId } = useApp();
  const links: { to: string; label: string; icon: ReactNode }[] = [
    { to: '/parametres', label: 'Paramètres', icon: <Settings /> },
  ];
  return (
    <div className="dock-pop" role="menu">
      <div className="dock-pop-head">
        <Avatar name={me.user.name} size="sm" />
        <div className="grow">
          <b className="ellipsis" style={{ display: 'block' }}>{me.user.name}</b>
          <small className="muted">
            {ROLE_LABELS[me.user.role]} · {me.club?.name}
          </small>
        </div>
      </div>
      <div className="dock-pop-list">
        {me.teams.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTeamId(t.id);
              onClose();
            }}
          >
            <TeamBadge team={t} size={28} />
            <span className="grow ellipsis">{t.category}</span>
            {t.id === team?.id && <Check size={16} color="var(--accent)" />}
          </button>
        ))}
      </div>
      <div className="dock-pop-list">
        {links.map((l) => (
          <Link key={l.to} to={l.to} onClick={onClose}>
            {l.icon}
            {l.label}
          </Link>
        ))}
        <button
          onClick={async () => {
            await api.post('/logout');
            location.href = '/';
          }}
        >
          <LogOut />
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function DockLink({ to, tip, icon, active }: { to: string; tip: string; icon: ReactNode; active?: boolean }) {
  return (
    <NavLink to={to} end className={({ isActive }) => `dock-btn${isActive || active ? ' active' : ''}`} data-tip={tip} aria-label={tip}>
      {icon}
    </NavLink>
  );
}

/** Barre d'outils flottante : Équipe | Séances · Exercices · Joueurs | Album souvenir. */
function Dock() {
  const { me, team, isStaff } = useApp();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onSessions = loc.pathname === '/' || loc.pathname.startsWith('/seances');
  const child = me.children.find((c) => c.teamId === team?.id) ?? me.children[0];

  return (
    <nav className="dock" aria-label="Navigation" ref={ref}>
      <div className="dock-group">
        <button className={`dock-btn team${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} data-tip={team ? team.category : 'Équipe'} aria-label="Équipe et compte">
          <TeamBadge team={team} />
        </button>
      </div>
      {open && <TeamMenu onClose={() => setOpen(false)} />}
      <div className="dock-group">
        <DockLink to="/" tip="Séances" icon={<CalendarDays />} active={onSessions} />
        {isStaff ? (
          <>
            <DockLink to="/exercices" tip="Exercices" icon={<LayoutGrid />} active={loc.pathname.startsWith('/exercices')} />
            <DockLink to="/joueurs" tip="Joueurs" icon={<Users />} active={loc.pathname.startsWith('/joueurs')} />
          </>
        ) : (
          <>
            <DockLink to="/exercices" tip="Exercices" icon={<LayoutGrid />} active={loc.pathname.startsWith('/exercices')} />
            {child && <DockLink to={`/joueurs/${child.id}`} tip={child.firstName} icon={<UserRound />} />}
          </>
        )}
      </div>
      <div className="dock-group">
        <DockLink to="/album" tip="Album souvenir" icon={<Images />} />
      </div>
    </nav>
  );
}

export function Layout() {
  return (
    <div className="app">
      <Dock />
      <main className="main">
        <Outlet />
      </main>
      <NetworkPill />
    </div>
  );
}
