import { ArrowLeft, BellRing, Check, ChevronRight, Eye, Megaphone, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TeamBadge } from '../components/Layout';
import { Avatar, Empty, Field, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { ROLE_LABELS, relative, useApp } from '../lib/store';
import type { Announcement } from '../lib/types';

const EMOJIS = ['📣', '⚠️', '🎉', '🏆', '🗓️', '🌧️', '💶', '📸', '🍕', '👕'];

function ReadRing({ read, total, size = 44 }: { read: number; total: number; size?: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const v = total ? read / total : 0;
  return (
    <span className="read-ring" style={{ width: size, height: size }} title={`${read} lu${read > 1 ? 's' : ''} sur ${total}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4.5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={v >= 0.8 ? '#34c759' : v >= 0.5 ? '#ff9500' : '#ff3b30'} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <b>{Math.round(v * 100)}%</b>
    </span>
  );
}

/** Carte d'annonce (liste et bandeau d'accueil). */
export function AnnouncementCard({ a, onOpen }: { a: Announcement; onOpen: () => void }) {
  return (
    <button className={`ann-card${a.target && !a.read ? ' unread' : ''}${a.important ? ' important' : ''}`} onClick={onOpen}>
      <span className="ann-emoji">{a.emoji}</span>
      <span className="grow">
        <span className="row" style={{ gap: 6 }}>
          <b className="ellipsis">{a.title}</b>
          {a.important && <span className="badge red">Important</span>}
        </span>
        <small className="ann-body">{a.body}</small>
        <small className="ann-meta">
          {a.author.name} · {relative(a.createdAt)}
          {a.teams.length > 0 && ` · ${a.teams.map((t) => t.category).join(', ')}`}
        </small>
      </span>
      {a.stats ? <ReadRing read={a.stats.read} total={a.stats.total} /> : a.target && !a.read ? <span className="dot-new" /> : <ChevronRight size={16} className="muted" />}
    </button>
  );
}

export function Announcements() {
  const { can } = useApp();
  const nav = useNavigate();
  const q = useAsync(() => api.get<Announcement[]>('/announcements'), []);
  useLive((m) => (m.t === 'announcement' || m.t === 'notif') && q.reload());
  const [compose, setCompose] = useState(false);
  const list = q.data ?? [];
  return (
    <div className="page narrow">
      <Link to="/messages" className="back">
        <ArrowLeft size={15} /> Messages
      </Link>
      <div className="page-head">
        <div>
          <h1>Annonces du club</h1>
          <div className="sub">Les informations officielles, avec accusé de lecture.</div>
        </div>
        {can('announcements.send') && (
          <button className="btn primary" onClick={() => setCompose(true)}>
            <Plus /> Nouvelle annonce
          </button>
        )}
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : list.length ? (
        <div className="stack" style={{ gap: 10 }}>
          {list.map((a) => (
            <AnnouncementCard key={a.id} a={a} onOpen={() => nav(`/annonces/${a.id}`)} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Megaphone />} title="Aucune annonce" text="Les annonces du club arrivent ici et sur votre téléphone." />
        </div>
      )}
      {compose && <Compose onClose={() => setCompose(false)} onSent={(a) => nav(`/annonces/${a.id}`)} />}
    </div>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (a: Announcement) => void }) {
  const { me, can, isAdmin } = useApp();
  const toast = useToast();
  const club = can('club.dashboard') || isAdmin;
  const [f, setF] = useState({ emoji: '📣', title: '', body: '', teamIds: club ? [] : me.teams.slice(0, 1).map((t) => t.id), roles: ['parent', 'coach'], important: false });
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const send = async () => {
    setBusy(true);
    try {
      const a = await api.post<Announcement>('/announcements', f);
      toast(`Annonce envoyée à ${a.stats?.total ?? 0} personne${(a.stats?.total ?? 0) > 1 ? 's' : ''}`);
      onSent(a);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Nouvelle annonce"
      onClose={onClose}
      footer={
        <button className="btn primary lg block" disabled={busy || !f.title.trim() || !f.body.trim() || !f.roles.length || (!club && !f.teamIds.length)} onClick={send}>
          <Megaphone /> Envoyer
        </button>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="emoji-pick">
          {EMOJIS.map((e) => (
            <button key={e} className={f.emoji === e ? 'on' : ''} onClick={() => setF({ ...f, emoji: e })}>
              {e}
            </button>
          ))}
        </div>
        <input className="input title" style={{ fontSize: 20 }} autoFocus placeholder="Titre (ex. : Terrain fermé samedi)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="textarea" rows={5} placeholder="Votre message…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <Field label="Équipes">
          <div className="chips">
            {club && (
              <button className={`chip${!f.teamIds.length ? ' on' : ''}`} onClick={() => setF({ ...f, teamIds: [] })}>
                Tout le club
              </button>
            )}
            {me.teams.map((t) => (
              <button key={t.id} className={`chip${f.teamIds.includes(t.id) ? ' on' : ''}`} onClick={() => setF({ ...f, teamIds: toggle(f.teamIds, t.id) })}>
                {t.category}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Destinataires">
          <div className="chips">
            <button className={`chip${f.roles.includes('parent') ? ' on' : ''}`} onClick={() => setF({ ...f, roles: toggle(f.roles, 'parent') })}>
              Parents
            </button>
            <button className={`chip${f.roles.includes('coach') ? ' on' : ''}`} onClick={() => setF({ ...f, roles: toggle(f.roles, 'coach') })}>
              Éducateurs
            </button>
          </div>
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} />
          <span>Marquer comme importante (mise en avant sur l’accueil)</span>
        </label>
      </div>
    </Sheet>
  );
}

export function AnnouncementPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useAsync(() => api.get<Announcement>(`/announcements/${id}`), [id]);
  useLive((m) => m.t === 'announcement' && m.id === id && q.reload());
  useEffect(() => {
    if (q.data?.target && !q.data.read) void api.post(`/announcements/${id}/read`).catch(() => undefined);
  }, [q.data, id]);
  if (q.loading && !q.data) return <Spinner fill />;
  if (!q.data) return <div className="page">{q.error}</div>;
  const a = q.data;
  const read = (a.recipients ?? []).filter((r) => r.readAt);
  const unread = (a.recipients ?? []).filter((r) => !r.readAt);
  return (
    <div className="page narrow">
      <Link to="/annonces" className="back">
        <ArrowLeft size={15} /> Annonces
      </Link>
      <article className={`ann-full${a.important ? ' important' : ''}`}>
        <span className="ann-emoji big">{a.emoji}</span>
        <h1>{a.title}</h1>
        <div className="ann-by">
          <Avatar name={a.author.name} size="sm" />
          <span>
            <b>{a.author.name}</b> · {relative(a.createdAt)}
          </span>
          <span className="grow" />
          {a.teams.map((t) => (
            <TeamBadge key={t.id} team={{ ...t, name: t.category, season: '', staff: [], playerCount: 0 }} size={24} />
          ))}
        </div>
        <p className="ann-text">{a.body}</p>
        {a.target && (
          <p className="ann-read">
            <Check size={14} /> Lu, merci !
          </p>
        )}
      </article>

      {a.recipients && (
        <div className="card pad" style={{ marginTop: 18 }}>
          <div className="row between" style={{ marginBottom: 12, gap: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <ReadRing read={read.length} total={a.recipients.length} size={56} />
              <div>
                <b>
                  Lue par {read.length} sur {a.recipients.length}
                </b>
                <p className="small muted">Accusés de lecture en temps réel</p>
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {a.mine && unread.length > 0 && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    const r = await api.post<{ sent: number }>(`/announcements/${a.id}/remind`);
                    toast(`Rappel envoyé à ${r.sent} personne${r.sent > 1 ? 's' : ''}`);
                  }}
                >
                  <BellRing /> Relancer ({unread.length})
                </button>
              )}
              {a.mine && (
                <button
                  className="btn icon sm ghost danger"
                  onClick={async () => {
                    if (await confirm({ title: 'Supprimer cette annonce ?', confirm: 'Supprimer', danger: true })) {
                      await api.del(`/announcements/${a.id}`);
                      nav('/annonces', { replace: true });
                    }
                  }}
                  aria-label="Supprimer"
                >
                  <Trash2 />
                </button>
              )}
            </div>
          </div>
          {[
            { title: `Pas encore lu (${unread.length})`, list: unread },
            { title: `Ont lu (${read.length})`, list: read },
          ].map((g) =>
            g.list.length ? (
              <div key={g.title}>
                <div className="section-title" style={{ margin: '14px 0 6px' }}>
                  {g.title}
                </div>
                <div className="list">
                  {g.list.map((r) => (
                    <div key={r.id} className="list-item" style={{ cursor: 'default', padding: '8px 4px', minHeight: 0 }}>
                      <Avatar name={r.name} size="sm" />
                      <div className="t">
                        <b>{r.name}</b>
                        <small>{r.role === 'parent' ? `Parent de ${r.kids.join(', ')}` : ROLE_LABELS[r.role]}</small>
                      </div>
                      {r.readAt ? (
                        <small className="read-yes">
                          <Eye size={12} /> {relative(r.readAt)}
                        </small>
                      ) : (
                        <small className="muted">—</small>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
