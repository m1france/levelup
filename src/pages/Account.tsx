import { CalendarDays, Copy, LogOut, RefreshCw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Field, Seg, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import { playerName, useApp } from '../lib/store';

type Theme = 'auto' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('atelier.theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** Onglet « Profil » des paramètres. */
export function Account() {
  const { me, reload } = useApp();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [phone, setPhone] = useState(me.user.phone ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [theme, setTheme] = useState<Theme>(readTheme);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    try {
      if (t === 'auto') localStorage.removeItem('atelier.theme');
      else localStorage.setItem('atelier.theme', t);
    } catch {
      /* rien */
    }
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="card pad stack">
          <Field label="Nom affiché">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Téléphone" hint="visible des éducateurs de vos équipes">
            <input className="input" type="tel" inputMode="tel" value={phone} placeholder="06 12 34 56 78" onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <p className="small muted">{me.user.email}</p>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={!name.trim() || (name === me.user.name && phone === (me.user.phone ?? ''))}
            onClick={async () => {
              await api.patch('/me', { name, phone });
              await reload();
              toast('Profil mis à jour');
            }}
          >
            Enregistrer
          </button>
        </div>
        {me.user.role === 'parent' && <Family />}
        <CalendarSync />
        <div className="card pad stack">
          <Field label="Apparence">
            <Seg value={theme} onChange={applyTheme} options={[{ value: 'auto', label: 'Automatique' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }]} />
          </Field>
        </div>
        <div className="card pad stack">
          <b>Mot de passe</b>
          <Field label="Mot de passe actuel">
            <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="Nouveau mot de passe" hint="8 caractères minimum">
            <input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={!pw.currentPassword || pw.newPassword.length < 8}
            onClick={async () => {
              try {
                await api.patch('/me', pw);
                setPw({ currentPassword: '', newPassword: '' });
                toast('Mot de passe modifié');
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Changer le mot de passe
          </button>
        </div>
        <button
          className="btn danger lg"
          onClick={async () => {
            await api.post('/logout');
            location.href = '/';
          }}
        >
          <LogOut /> Se déconnecter
        </button>
      </div>
    </div>
  );
}

/** Abonnement agenda : les matchs et entraînements apparaissent dans l'agenda du téléphone et se mettent à jour seuls. */
function CalendarSync() {
  const toast = useToast();
  const q = useAsync(() => api.get<{ enabled: boolean; path: string | null }>('/me/calendar'), []);
  const [busy, setBusy] = useState(false);
  const cal = q.data ? { ...q.data, url: q.data.path ? `${location.origin}${q.data.path}` : null } : null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      q.setData(on ? await api.post('/me/calendar') : await api.del('/me/calendar'));
      if (on) toast('Synchronisation activée');
    } finally {
      setBusy(false);
    }
  };
  const webcal = cal?.url ? cal.url.replace(/^https?:/, 'webcal:') : '';
  return (
    <div className="card pad stack cal-sync">
      <div className="row between" style={{ gap: 12 }}>
        <span className="cal-ic">
          <CalendarDays />
        </span>
        <div className="grow">
          <b>Synchroniser avec mon agenda</b>
          <p className="small muted">Matchs, entraînements et convocations dans l’agenda de votre iPhone ou Google, mis à jour automatiquement.</p>
        </div>
        <label className="switch">
          <input type="checkbox" disabled={busy || !cal} checked={!!cal?.enabled} onChange={(e) => toggle(e.target.checked)} />
          <i />
        </label>
      </div>
      {cal?.enabled && cal.url && (
        <div className="cal-actions">
          <a className="cal-btn apple" href={webcal}>
            <span></span> Ajouter à l’iPhone
          </a>
          <a className="cal-btn google" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">
            <span>G</span> Google Agenda
          </a>
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn sm ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(cal.url!).catch(() => undefined);
                toast('Lien copié (Outlook, autre agenda)');
              }}
            >
              <Copy /> Copier le lien
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={() => toggle(true)} title="Le lien actuel cessera de fonctionner">
              <RefreshCw /> Nouveau lien
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Un seul compte pour la fratrie : tous les enfants, et l'ajout d'un frère ou d'une sœur. */
function Family() {
  const { me } = useApp();
  const nav = useNavigate();
  const [link, setLink] = useState('');
  const token = link.trim().match(/invitation\/([A-Za-z0-9_-]+)/)?.[1] ?? (/^[A-Za-z0-9_-]{20,}$/.test(link.trim()) ? link.trim() : null);
  return (
    <div className="card pad stack">
      <b>Mes enfants</b>
      <div className="family">
        {me.children.map((c) => {
          const team = me.teams.find((t) => t.id === c.teamId);
          return (
            <button key={c.id} className="family-kid" onClick={() => nav(`/joueurs/${c.id}`)}>
              <PlayerAvatar player={c} size={48} />
              <b>{playerName(c)}</b>
              {team && (
                <span className="chip" style={{ background: team.color, borderColor: team.color, color: '#fff', height: 22, fontSize: 11 }}>
                  {team.category}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Field label="Ajouter un frère ou une sœur" hint="collez le lien d’invitation de son équipe">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" value={link} placeholder="https://…/invitation/…" onChange={(e) => setLink(e.target.value)} />
          <button className="btn primary" disabled={!token} onClick={() => token && nav(`/invitation/${token}`)}>
            <UserPlus /> Ajouter
          </button>
        </div>
      </Field>
      <p className="small muted">Un seul compte pour toute la famille : les convocations, le covoiturage et les photos de chaque enfant arrivent au même endroit.</p>
    </div>
  );
}
