import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Field, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { ROLE_LABELS } from '../lib/store';
import type { InviteInfo } from '../lib/types';

function useSubmit(fn: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ clubName: '', name: '', email: '', password: '', demo: true });
  const { error, busy, submit } = useSubmit(async () => {
    await api.post('/setup', f);
    onDone();
  });
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <img className="logo" src="/icon.svg" alt="" />
        <h1>Bienvenue sur Atelier</h1>
        <p className="lead">Créez l’espace de votre club. Vous en serez l’administrateur.</p>
        <div className="stack">
          <Field label="Nom du club">
            <input className="input" required value={f.clubName} onChange={(e) => setF({ ...f, clubName: e.target.value })} placeholder="FC Ma Ville" />
          </Field>
          <Field label="Votre nom">
            <input className="input" required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Mot de passe" hint="8 caractères minimum">
            <input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.demo} onChange={(e) => setF({ ...f, demo: e.target.checked })} />
            <span>
              Ajouter une équipe d’exemple
              <br />
              <small className="muted">U8/U9 · 18 joueurs · une séance avec ateliers tournants</small>
            </span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg full" disabled={busy}>
            {busy ? 'Création…' : 'Créer mon club'}
          </button>
          <p className="muted small" style={{ textAlign: 'center' }}>
            7 exercices animés sont ajoutés à la bibliothèque du club pour démarrer.
          </p>
        </div>
      </form>
    </div>
  );
}

export function Login({ clubName, onDone }: { clubName: string | null; onDone: () => void }) {
  const [f, setF] = useState({ email: '', password: '' });
  const { error, busy, submit } = useSubmit(async () => {
    await api.post('/login', f);
    onDone();
  });
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <img className="logo" src="/icon.svg" alt="" />
        <h1>Connexion</h1>
        <p className="lead">{clubName ? `Espace éducateurs · ${clubName}` : 'Espace éducateurs'}</p>
        <div className="stack">
          <Field label="E-mail">
            <input className="input" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Mot de passe">
            <input className="input" type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg full" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
          <p className="muted small" style={{ textAlign: 'center' }}>
            Pas encore de compte ? Demandez une invitation à l’administrateur du club.
          </p>
        </div>
      </form>
    </div>
  );
}

export function Invite() {
  const { token } = useParams();
  const nav = useNavigate();
  const info = useAsync(() => api.get<InviteInfo>(`/invites/${token}`), [token]);
  const [f, setF] = useState({ name: '', email: '', password: '', playerIds: [] as string[] });
  const { error, busy, submit } = useSubmit(async () => {
    await api.post(`/invites/${token}`, f);
    nav('/', { replace: true });
    location.reload();
  });
  if (info.loading) return <Spinner fill />;
  if (info.error || !info.data)
    return (
      <div className="auth">
        <div className="auth-card">
          <img className="logo" src="/icon.svg" alt="" />
          <h1>Invitation expirée</h1>
          <p className="lead">{info.error}. Demandez un nouveau lien à l’administrateur du club.</p>
        </div>
      </div>
    );
  const inv = info.data;
  const open = inv.kind === 'link';
  const togglePlayer = (id: string) =>
    setF({ ...f, playerIds: f.playerIds.includes(id) ? f.playerIds.filter((x) => x !== id) : [...f.playerIds, id] });
  return (
    <div className="auth invite">
      <aside className="invite-card">
        {inv.invitedBy && <Avatar name={inv.invitedBy} size="lg" />}
        <p>
          <b>{inv.invitedBy ?? inv.clubName}</b> t’a invité à rejoindre l’app en tant que <b>{ROLE_LABELS[inv.role].toLowerCase()}</b>.
        </p>
        {inv.teams.length > 0 && (
          <div className="invite-teams">
            <span className="muted small">{inv.teams.length > 1 ? 'Équipes' : 'Équipe'}</span>
            <div className="chips">
              {inv.teams.map((t) => (
                <span key={t.id} className="chip on" style={{ background: t.color, borderColor: t.color }}>
                  {t.category}
                </span>
              ))}
            </div>
            <span className="muted small">Tu y seras ajouté automatiquement.</span>
          </div>
        )}
      </aside>
      <form className="auth-card" onSubmit={submit}>
        <img className="logo" src="/icon.svg" alt="" />
        <h1>Rejoindre {inv.clubName}</h1>
        <p className="lead">
          {open ? 'Crée ton compte en quelques secondes.' : `Choisis un mot de passe pour activer ton compte (${inv.email}).`}
        </p>
        <div className="stack">
          <Field label="Ton nom">
            <input className="input" required={open} autoComplete="name" placeholder={inv.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          {open && (
            <Field label="E-mail">
              <input className="input" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
          )}
          {open && inv.role === 'parent' && (
            <Field label="Joueur" hint="toi ou ton enfant">
              <div className="chips">
                {inv.players.map((p) => (
                  <button type="button" key={p.id} className={`chip${f.playerIds.includes(p.id) ? ' on' : ''}`} onClick={() => togglePlayer(p.id)}>
                    {[p.firstName, p.lastName].filter(Boolean).join(' ')}
                  </button>
                ))}
                {!inv.players.length && <span className="muted small">L’effectif de l’équipe est vide.</span>}
              </div>
            </Field>
          )}
          <Field label="Mot de passe" hint="8 caractères minimum">
            <input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg full" disabled={busy || (open && inv.role === 'parent' && !f.playerIds.length)}>
            {open ? 'Créer mon compte' : 'Activer mon compte'}
          </button>
        </div>
      </form>
    </div>
  );
}
