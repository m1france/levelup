import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { Field, Seg, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

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
          <p className="small muted">{me.user.email}</p>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={!name.trim() || name === me.user.name}
            onClick={async () => {
              await api.patch('/me', { name });
              await reload();
              toast('Profil mis à jour');
            }}
          >
            Enregistrer
          </button>
        </div>
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
