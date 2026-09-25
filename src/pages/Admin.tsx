import { Copy, Link2, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, Empty, Field, Seg, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { Account } from './Account';
import { api, uid } from '../lib/api';
import { CATEGORIES, ROLE_LABELS, playerName, useApp } from '../lib/store';
import type { InviteLink, Member, Player, Role, Team } from '../lib/types';

type Tab = 'profil' | 'membres' | 'equipes' | 'permissions' | 'club';

/** Paramètres : profil de l'utilisateur et, selon ses droits, l'administration du club. */
export function Settings() {
  const { can, isAdmin, me } = useApp();
  const [params, setParams] = useSearchParams();
  const tabs: { value: Tab; label: string }[] = [
    { value: 'profil', label: 'Profil' },
    ...(can('members.manage') ? [{ value: 'membres' as Tab, label: 'Membres' }] : []),
    ...(can('teams.manage') ? [{ value: 'equipes' as Tab, label: 'Équipes' }] : []),
    ...(isAdmin ? [{ value: 'permissions' as Tab, label: 'Permissions' }, { value: 'club' as Tab, label: 'Club' }] : []),
  ];
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? 'profil';
  return (
    <div className="page">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={me.user.name} size="lg" />
          <div>
            <h1>Paramètres</h1>
            <div className="sub">
              {me.user.name} · {ROLE_LABELS[me.user.role]}
            </div>
          </div>
        </div>
      </div>
      {tabs.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <Seg value={tab} onChange={(v) => setParams(v === 'profil' ? {} : { tab: v })} options={tabs} />
        </div>
      )}
      {tab === 'profil' && <Account />}
      {tab === 'membres' && <Members />}
      {tab === 'equipes' && <Teams />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'club' && <Club />}
    </div>
  );
}

const inviteUrl = (token: string) => `${location.origin}/invitation/${token}`;

function CopyLink({ token }: { token: string }) {
  return (
    <div className="copy-box">
      <Link2 size={15} color="var(--ink-3)" />
      <code>{inviteUrl(token)}</code>
      <CopyButton token={token} />
    </div>
  );
}

function CopyButton({ token }: { token: string }) {
  const toast = useToast();
  const url = inviteUrl(token);
  return (
    <button
      className="btn sm"
      onClick={async () => {
        const nav = navigator as Navigator;
        if (nav.share && /Mobi/.test(navigator.userAgent)) await nav.share({ url, title: 'Invitation Atelier' }).catch(() => {});
        else {
          await navigator.clipboard.writeText(url);
          toast('Lien copié');
        }
      }}
    >
      <Copy /> Copier
    </button>
  );
}

function useAllPlayers() {
  return useAsync(async () => {
    const teams = await api.get<Team[]>('/teams');
    const lists = await Promise.all(teams.map((t) => api.get<Player[]>(`/teams/${t.id}/players`)));
    return teams.map((t, i) => ({ team: t, players: lists[i] }));
  }, []);
}

/* ------------------------------------------------------------------ membres */

function Members() {
  const q = useAsync(() => api.get<Member[]>('/users'), []);
  const all = useAllPlayers();
  const [edit, setEdit] = useState<Member | 'new' | null>(null);
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [linkOpen, setLinkOpen] = useState(false);
  const list = (q.data ?? []).filter((m) => filter === 'all' || m.role === filter);
  const teamName = (id: string) => all.data?.find((x) => x.team.id === id)?.team.category;
  const childName = (id: string) => {
    for (const x of all.data ?? []) {
      const p = x.players.find((pl) => pl.id === id);
      if (p) return p.firstName;
    }
    return null;
  };

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <div className="chips">
          {(['all', 'admin', 'dirigeant', 'coach', 'parent'] as const).map((r) => (
            <button key={r} className={`chip${filter === r ? ' on' : ''}`} onClick={() => setFilter(r)}>
              {r === 'all' ? 'Tous' : ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={() => setLinkOpen(true)}>
            <Link2 /> Lien d’invitation
          </button>
          <button className="btn primary" onClick={() => setEdit('new')}>
            <UserPlus /> Inviter
          </button>
        </div>
      </div>
      <InviteLinks teams={all.data?.map((x) => x.team) ?? []} open={linkOpen} onOpenChange={setLinkOpen} />
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : (
        <div className="card list">
          {list.map((m) => (
            <div key={m.id} className="list-item" onClick={() => setEdit(m)}>
              <Avatar name={m.name} />
              <div className="t">
                <b>{m.name}</b>
                <small>
                  {m.email}
                  {m.role === 'parent'
                    ? m.playerIds.length ? ` · parent de ${m.playerIds.map(childName).filter(Boolean).join(', ')}` : ''
                    : m.teamIds.length ? ` · ${m.teamIds.map(teamName).filter(Boolean).join(', ')}` : ''}
                </small>
              </div>
              {m.status === 'invited' && <span className="badge warn">Invitation envoyée</span>}
              {m.status === 'disabled' && <span className="badge red">Désactivé</span>}
              <span className={`badge ${m.role === 'admin' ? 'green' : ''}`}>{ROLE_LABELS[m.role]}</span>
            </div>
          ))}
          {!list.length && <div className="empty">Aucun membre.</div>}
        </div>
      )}
      {edit && <MemberForm member={edit === 'new' ? undefined : edit} all={all.data ?? []} onClose={() => setEdit(null)} onSaved={q.reload} />}
    </>
  );
}

const LINK_ROLES = ['coach', 'dirigeant', 'parent'] as const;

/** Liens partageables : rôle et équipe attribués automatiquement à l'inscription. */
function InviteLinks({ teams, open, onOpenChange }: { teams: Team[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const q = useAsync(() => api.get<InviteLink[]>('/invite-links'), []);
  const [f, setF] = useState<{ role: InviteLink['role']; teamId: string | null }>({ role: 'parent', teamId: null });
  const [created, setCreated] = useState<InviteLink | null>(null);
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.category;
  const close = () => {
    onOpenChange(false);
    setCreated(null);
  };
  const create = async () => {
    try {
      setCreated(await api.post<InviteLink>('/invite-links', f));
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const links = q.data ?? [];

  return (
    <>
      {links.length > 0 && (
        <div className="card list" style={{ marginBottom: 14 }}>
          {links.map((l) => (
            <div key={l.token} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <Link2 size={18} color="var(--ink-3)" />
              <div className="t">
                <b>
                  {ROLE_LABELS[l.role]}
                  {l.teamId && teamName(l.teamId) ? ` · ${teamName(l.teamId)}` : ''}
                </b>
                <small>
                  {l.uses} inscription{l.uses > 1 ? 's' : ''} · expire le {new Date(l.expiresAt).toLocaleDateString('fr-FR')}
                </small>
              </div>
              <CopyButton token={l.token} />
              <button
                className="btn ghost icon sm"
                aria-label="Désactiver le lien"
                onClick={async () => {
                  await api.del(`/invite-links/${l.token}`);
                  q.reload();
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <Sheet
          title={created ? 'Lien créé' : 'Lien d’invitation'}
          onClose={close}
          footer={
            created ? (
              <button className="btn primary" onClick={close}>Terminé</button>
            ) : (
              <>
                <button className="btn ghost" onClick={close}>Annuler</button>
                <button className="btn primary" disabled={f.role === 'parent' && !f.teamId} onClick={create}>
                  Créer le lien
                </button>
              </>
            )
          }
        >
          {created ? (
            <div className="stack">
              <p>
                Partagez ce lien (SportEasy, SMS, WhatsApp…). Chaque personne qui s’inscrit devient <b>{ROLE_LABELS[created.role].toLowerCase()}</b>
                {created.teamId ? <> et rejoint l’équipe <b>{teamName(created.teamId)}</b></> : null}. Valable 30 jours.
              </p>
              <CopyLink token={created.token} />
            </div>
          ) : (
            <div className="stack">
              <Field label="Rôle attribué">
                <Seg<InviteLink['role']>
                  value={f.role}
                  onChange={(role) => setF({ ...f, role })}
                  options={LINK_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                />
              </Field>
              <Field label="Équipe" hint={f.role === 'parent' ? 'obligatoire' : 'facultatif'}>
                <div className="chips">
                  {f.role !== 'parent' && (
                    <button className={`chip${!f.teamId ? ' on' : ''}`} onClick={() => setF({ ...f, teamId: null })}>
                      Aucune
                    </button>
                  )}
                  {teams.map((t) => (
                    <button key={t.id} className={`chip${f.teamId === t.id ? ' on' : ''}`} onClick={() => setF({ ...f, teamId: t.id })}>
                      {t.category}
                    </button>
                  ))}
                  {!teams.length && <span className="muted small">Aucune équipe créée.</span>}
                </div>
              </Field>
              {f.role === 'parent' && <p className="muted small">À l’inscription, la personne choisit son enfant dans l’effectif de l’équipe.</p>}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

function MemberForm({ member, all, onClose, onSaved }: { member?: Member; all: { team: Team; players: Player[] }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useApp();
  const [f, setF] = useState({
    name: member?.name ?? '',
    email: member?.email ?? '',
    role: (member?.role ?? 'coach') as Role,
    teamIds: new Set(member?.teamIds ?? []),
    playerIds: new Set(member?.playerIds ?? []),
  });
  const [created, setCreated] = useState<Member | null>(null);
  const isAdminRow = member?.role === 'admin';
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const body = { name: f.name, role: f.role, teamIds: [...f.teamIds], playerIds: [...f.playerIds] };

  const save = async () => {
    try {
      if (member) {
        await api.patch(`/users/${member.id}`, body);
        toast('Membre mis à jour');
        onSaved();
        onClose();
      } else {
        const m = await api.post<Member>('/users', { ...body, email: f.email });
        setCreated(m);
        onSaved();
      }
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (created)
    return (
      <Sheet title="Invitation créée" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Terminé</button>}>
        <div className="stack">
          <p>
            Envoyez ce lien à <b>{created.name}</b> (par SportEasy, SMS ou WhatsApp). Il permet de choisir un mot de passe et reste valable 30 jours.
          </p>
          {created.inviteToken && <CopyLink token={created.inviteToken} />}
        </div>
      </Sheet>
    );

  return (
    <Sheet
      title={member ? member.name : 'Inviter un membre'}
      onClose={onClose}
      footer={
        <>
          {member && !isAdminRow && member.id !== me.user.id && (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (await confirm({ title: `Supprimer ${member.name} ?`, text: 'Son accès sera immédiatement retiré. Ses exercices resteront dans la bibliothèque.', confirm: 'Supprimer', danger: true })) {
                  await api.del(`/users/${member.id}`);
                  onSaved();
                  onClose();
                }
              }}
            >
              <Trash2 />
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={!f.name.trim() || (!member && !f.email.includes('@'))} onClick={save}>
            {member ? 'Enregistrer' : 'Créer l’invitation'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nom">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        {!member ? (
          <Field label="E-mail">
            <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
        ) : (
          <p className="muted small">{member.email}</p>
        )}
        {isAdminRow ? (
          <p className="badge green" style={{ alignSelf: 'flex-start' }}>
            <ShieldCheck /> Administrateur du club (unique)
          </p>
        ) : (
          <Field label="Rôle">
            <Seg<Role>
              value={f.role}
              onChange={(role) => setF({ ...f, role })}
              options={(['dirigeant', 'coach', 'parent'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          </Field>
        )}
        {f.role !== 'parent' && (
          <Field label="Équipes encadrées">
            <div className="chips">
              {all.map(({ team }) => (
                <button key={team.id} className={`chip${f.teamIds.has(team.id) ? ' on' : ''}`} onClick={() => setF({ ...f, teamIds: toggle(f.teamIds, team.id) })}>
                  {team.category}
                </button>
              ))}
              {!all.length && <span className="muted small">Aucune équipe créée.</span>}
            </div>
          </Field>
        )}
        {f.role === 'parent' && (
          <Field label="Enfant(s)" hint="le parent ne voit que ses enfants">
            <div className="stack" style={{ gap: 10, maxHeight: 260, overflowY: 'auto' }}>
              {all.map(({ team, players }) => (
                <div key={team.id}>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    {team.category}
                  </div>
                  <div className="chips">
                    {players.map((p) => (
                      <button key={p.id} className={`chip${f.playerIds.has(p.id) ? ' on' : ''}`} onClick={() => setF({ ...f, playerIds: toggle(f.playerIds, p.id) })}>
                        {playerName(p)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Field>
        )}
        {member?.status === 'invited' && (
          <Field label="Lien d’invitation">
            {member.inviteToken ? (
              <CopyLink token={member.inviteToken} />
            ) : (
              <button
                className="btn sm"
                onClick={async () => {
                  await api.post(`/users/${member.id}/invite`);
                  onSaved();
                  onClose();
                  toast('Nouveau lien créé');
                }}
              >
                Générer un nouveau lien
              </button>
            )}
          </Field>
        )}
        {member && !isAdminRow && member.status !== 'invited' && (
          <label className="check">
            <input
              type="checkbox"
              checked={member.status === 'disabled'}
              onChange={async (e) => {
                await api.patch(`/users/${member.id}`, { status: e.target.checked ? 'disabled' : 'active' });
                onSaved();
                onClose();
              }}
            />
            <span>Désactiver l’accès (sans supprimer le compte)</span>
          </label>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ équipes */

const TEAM_COLORS = ['#1f6f4a', '#3653c4', '#c0392b', '#a86b12', '#7c3aed', '#0e7490', '#be185d', '#25262b'];

function Teams() {
  const { reload, setTeamId } = useApp();
  const q = useAsync(() => api.get<Team[]>('/teams'), []);
  const [edit, setEdit] = useState<Team | 'new' | null>(null);
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <span />
        <button className="btn primary" onClick={() => setEdit('new')}>
          <Plus /> Nouvelle équipe
        </button>
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : q.data?.length ? (
        <div className="card list">
          {q.data.map((t) => (
            <div key={t.id} className="list-item" onClick={() => setEdit(t)}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: t.color, flex: 'none' }} />
              <div className="t">
                <b>
                  {t.category}
                </b>
                <small>
                  {t.playerCount} joueurs · {t.staff.length ? t.staff.map((s) => s.name).join(', ') : 'aucun éducateur'}
                  {t.season ? ` · ${t.season}` : ''}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty title="Aucune équipe" text="Créez votre première équipe : choisissez sa catégorie et ses éducateurs." />
        </div>
      )}
      {edit && (
        <TeamForm
          team={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(null)}
          onSaved={async (id) => {
            q.reload();
            await reload();
            if (id) setTeamId(id);
          }}
        />
      )}
    </>
  );
}

function TeamForm({ team, onClose, onSaved }: { team?: Team; onClose: () => void; onSaved: (id?: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const staff = useAsync(() => api.get<{ id: string; name: string; role: Role }[]>('/staff'), []);
  const [f, setF] = useState({
    category: team?.category ?? 'U8/U9',
    season: team?.season ?? seasonNow(),
    color: team?.color ?? TEAM_COLORS[0],
    staffIds: new Set(team?.staff.map((s) => s.id) ?? []),
  });
  const cats = useMemo(() => (CATEGORIES.includes(f.category) ? CATEGORIES : [f.category, ...CATEGORIES]), [f.category]);
  const save = async () => {
    try {
      const id = team?.id ?? uid();
      await api.put(`/teams/${id}`, { ...f, name: f.category, staffIds: [...f.staffIds] });
      toast(team ? 'Équipe mise à jour' : 'Équipe créée');
      onSaved(team ? undefined : id);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Sheet
      title={team ? team.category : 'Nouvelle équipe'}
      onClose={onClose}
      footer={
        <>
          {team && (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (await confirm({ title: `Supprimer l’équipe ${team.category} ?`, text: 'L’effectif, les séances, remarques et événements de l’équipe seront supprimés définitivement.', confirm: 'Supprimer', danger: true })) {
                  await api.del(`/teams/${team.id}`);
                  onSaved();
                  onClose();
                }
              }}
            >
              <Trash2 />
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" disabled={!f.category} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <Field label="Catégorie" hint="c’est aussi le nom de l’équipe">
            <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Saison">
          <input className="input" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} />
        </Field>
        <Field label="Couleur">
          <div className="row" style={{ gap: 8 }}>
            {TEAM_COLORS.map((c) => (
              <button key={c} className={`swatch${f.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Éducateurs">
          <div className="chips">
            {(staff.data ?? []).map((s) => (
              <button
                key={s.id}
                className={`chip${f.staffIds.has(s.id) ? ' on' : ''}`}
                onClick={() => {
                  const n = new Set(f.staffIds);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  setF({ ...f, staffIds: n });
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

function seasonNow() {
  const d = new Date();
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/* ------------------------------------------------------------------ permissions */

interface PermPayload { catalog: { key: string; label: string; group: string }[]; roles: Record<string, string[]> }

function Permissions() {
  const toast = useToast();
  const { reload } = useApp();
  const q = useAsync(() => api.get<PermPayload>('/permissions'), []);
  const [roles, setRoles] = useState<Record<string, Set<string>> | null>(null);
  const cur = roles ?? (q.data ? Object.fromEntries(Object.entries(q.data.roles).map(([r, p]) => [r, new Set(p)])) : null);
  if (!q.data || !cur) return <Spinner fill />;
  const cols = ['dirigeant', 'coach', 'parent'];
  const groups = [...new Set(q.data.catalog.map((c) => c.group))];
  const toggle = (role: string, key: string) => {
    const next = Object.fromEntries(Object.entries(cur).map(([r, s]) => [r, new Set(s)]));
    if (next[role].has(key)) next[role].delete(key);
    else next[role].add(key);
    setRoles(next);
  };
  return (
    <>
      <div className="card table-scroll">
        <table className="perm-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th>Admin</th>
              {cols.map((c) => (
                <th key={c}>{ROLE_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="group">
                  <td colSpan={2 + cols.length}>{g}</td>
                </tr>
                {q.data!.catalog
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td>
                        <input type="checkbox" checked disabled />
                      </td>
                      {cols.map((r) => (
                        <td key={r}>
                          <input type="checkbox" checked={cur[r]?.has(c.key) ?? false} onChange={() => toggle(r, c.key)} aria-label={`${c.label} — ${ROLE_LABELS[r]}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row between wrap" style={{ marginTop: 14 }}>
        <p className="small muted" style={{ maxWidth: 560 }}>
          Les comptes « Joueur / parent » ne voient jamais l’effectif ni les remarques des autres enfants, quelles que soient ces cases : seulement leurs enfants, les séances publiées et les défis.
        </p>
        <button
          className="btn primary"
          disabled={!roles}
          onClick={async () => {
            await api.put('/permissions', { roles: Object.fromEntries(Object.entries(cur).map(([r, s]) => [r, [...s]])) });
            toast('Permissions enregistrées');
            setRoles(null);
            q.reload();
            await reload();
          }}
        >
          Enregistrer
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ club */

function Club() {
  const { me, reload } = useApp();
  const toast = useToast();
  const [name, setName] = useState(me.club?.name ?? '');
  return (
    <div className="card pad stack" style={{ maxWidth: 520 }}>
      <Field label="Nom du club">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button
        className="btn primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={!name.trim() || name === me.club?.name}
        onClick={async () => {
          await api.patch('/club', { name });
          await reload();
          toast('Club mis à jour');
        }}
      >
        Enregistrer
      </button>
      <div className="divider" />
      <p className="small muted">
        Atelier complète SportEasy : le calendrier, les convocations et la messagerie restent dans SportEasy. Ici, on prépare et on anime le terrain.
      </p>
    </div>
  );
}
