import {
  ArrowLeft, ArrowUp, BarChart3, Car, Check, CheckCheck, ChevronRight, ImagePlus, ListChecks, Lock, LogOut, MapPin, Megaphone, MessageCircle, MoreHorizontal, Navigation, PenSquare, Plus,
  RotateCcw, Search, Settings2, Trash2, Trophy, Users, X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CarpoolPanel, DIRECTION } from '../components/Carpool';
import { TeamBadge } from '../components/Layout';
import { Avatar, Empty, Field, Menu, Seg, Sheet, Spinner, useAsync, useConfirm, useContextMenu, useToast } from '../components/ui';
import { api } from '../lib/api';
import { mapsUrl, matchPath } from '../lib/convocations';
import { formatTime } from '../lib/events';
import { preparePhoto, preparePortrait } from '../lib/images';
import { useLive } from '../lib/live';
import { ROLE_LABELS, useApp } from '../lib/store';
import type { Carpool, ChannelPerm, ChannelSettings, ChatContact, ChatMessage, ChatThread } from '../lib/types';

const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓', '⚽', '👏'];

/** Nombre de messages non lus (pastille du dock). */
export function useChatUnread() {
  const [n, setN] = useState(0);
  const load = useCallback(() => void api.get<{ unread: number }>('/chat/unread').then((r) => setN(r.unread)).catch(() => undefined), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useLive((m) => (m.t === 'chat' || m.t === 'chat-read') && load());
  return n;
}

const time = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function listTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time(ts);
  const diff = (now.getTime() - ts) / 864e5;
  if (diff < 6) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function dayLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Aujourd’hui';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function ThreadAvatar({ t, size = 46 }: { t: Pick<ChatThread, 'kind' | 'teamId' | 'title' | 'icon' | 'color'>; size?: number }) {
  const { me } = useApp();
  if (t.kind === 'announce') {
    return (
      <span className="thread-av ann" style={{ width: size, height: size }}>
        <Megaphone size={size * 0.43} />
      </span>
    );
  }
  if (t.kind === 'group') {
    if (t.icon?.image) return <img className="thread-av img" src={t.icon.image} alt="" style={{ width: size, height: size }} />;
    return (
      <span className="thread-av group" style={{ width: size, height: size, background: t.color ?? '#5e5ce6', fontSize: size * 0.46 }}>
        {t.icon?.emoji || <Users size={size * 0.45} />}
      </span>
    );
  }
  if (t.kind === 'team') {
    const team = me.teams.find((x) => x.id === t.teamId) ?? null;
    return <TeamBadge team={team} size={size} />;
  }
  if (t.kind === 'staff') {
    return (
      <span className="thread-av staff" style={{ width: size, height: size }}>
        <Trophy size={size * 0.45} />
      </span>
    );
  }
  return (
    <span style={{ width: size, height: size, display: 'inline-grid' }} className="thread-av-wrap">
      <Avatar name={t.title} />
    </span>
  );
}

export function Messages() {
  const { threadId } = useParams();
  const nav = useNavigate();
  const q = useAsync(() => api.get<ChatThread[]>('/chat/threads'), []);
  useLive((m) => {
    if (m.t === 'chat' || m.t === 'chat-read') q.reload();
  });
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState(false);
  // Le salon des annonces reste épinglé en tête.
  const threads = (q.data ?? [])
    .filter((t) => !search || t.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.kind === 'announce') - Number(a.kind === 'announce'));
  const removeThread = useRemoveThread((id) => {
    q.setData((q.data ?? []).filter((t) => t.id !== id));
    if (id === threadId) nav('/messages');
  });

  return (
    <div className={`chat-app${threadId ? ' has-thread' : ''}`}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <h1>Messages</h1>
          <button className="btn icon ghost" onClick={() => setCompose(true)} aria-label="Nouveau message">
            <PenSquare />
          </button>
        </div>
        <label className="chat-search">
          <Search size={16} />
          <input placeholder="Rechercher" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {q.loading && !q.data ? (
          <Spinner />
        ) : (
          threads.map((t) => <ThreadRow key={t.id} t={t} on={t.id === threadId} onOpen={() => nav(`/messages/${t.id}`)} onRemove={removeThread} />)
        )}
      </aside>
      <section className="chat-main">
        {threadId ? (
          <Thread key={threadId} id={threadId} onBack={() => nav('/messages')} onRead={q.reload} onRemove={removeThread} />
        ) : (
          <div className="chat-empty">
            <Empty icon={<PenSquare />} title="Choisissez une discussion" text="L’équipe, les éducateurs ou un parent : tout le monde est ici, sans groupe WhatsApp à gérer." />
          </div>
        )}
      </section>
      {compose && <NewMessage onClose={() => setCompose(false)} onOpen={(id) => (setCompose(false), nav(`/messages/${id}`))} />}
    </div>
  );
}

/** Suppression d'une discussion : privée (de ma liste), groupe (le quitter, ou le supprimer pour tous s'il est à moi). */
function useRemoveThread(onDone: (id: string) => void) {
  const confirm = useConfirm();
  const toast = useToast();
  return async (t: ChatThread, forAll = false) => {
    const text =
      t.kind === 'direct'
        ? 'La discussion et son historique disparaissent de votre liste. L’autre personne la garde.'
        : forAll
          ? 'Le groupe et tous ses messages sont supprimés pour tous les membres.'
          : 'Vous ne recevrez plus les messages de ce groupe.';
    const title = t.kind === 'direct' ? 'Supprimer la discussion ?' : forAll ? `Supprimer « ${t.title} » ?` : `Quitter « ${t.title} » ?`;
    if (!(await confirm({ title, text, confirm: t.kind === 'group' && !forAll && !t.owner ? 'Quitter' : 'Supprimer', danger: true }))) return;
    try {
      await api.del(`/chat/threads/${t.id}${forAll ? '?all=1' : ''}`);
      toast(t.kind === 'direct' || forAll ? 'Discussion supprimée' : 'Vous avez quitté le groupe');
      onDone(t.id);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
}

function ThreadRow({ t, on, onOpen, onRemove }: { t: ChatThread; on: boolean; onOpen: () => void; onRemove: (t: ChatThread, forAll?: boolean) => void }) {
  const { bind, menu } = useContextMenu();
  return (
    <>
      {t.canDelete &&
        menu((close) => (
          <>
            <button onClick={() => (close(), onOpen())}>
              <MessageCircle size={16} /> Ouvrir
            </button>
            {t.kind === 'group' && t.owner && (
              <button className="danger" onClick={() => (close(), onRemove(t, true))}>
                <Trash2 size={16} /> Supprimer le groupe
              </button>
            )}
            <button className="danger" onClick={() => (close(), onRemove(t))}>
              {t.kind === 'group' && !t.owner ? <LogOut size={16} /> : <Trash2 size={16} />}
              {t.kind === 'group' ? (t.owner ? 'Retirer de ma liste' : 'Quitter le groupe') : 'Supprimer la discussion'}
            </button>
          </>
        ))}
      <div className={`thread-row-wrap${t.kind === 'announce' ? ' pinned' : ''}`}>
        <button className={`thread-row${on ? ' on' : ''}${t.unread ? ' has-unread' : ''}${t.kind === 'announce' ? ' ann' : ''}`} onClick={onOpen} {...(t.canDelete ? bind : {})}>
          <ThreadAvatar t={t} />
          <span className="grow">
            <span className="row between" style={{ gap: 8 }}>
              <b className="ellipsis">
                {t.title}
                {!t.perms.send && <Lock size={12} className="ro-lock" aria-label="Lecture seule" />}
              </b>
              {t.last && <time>{listTime(t.last.at)}</time>}
            </span>
            <small className="ellipsis">
              {t.last
                ? `${t.last.mine ? 'Vous' : t.kind === 'direct' ? '' : t.last.author ?? ''}${t.last.mine || t.kind !== 'direct' ? ' : ' : ''}${t.last.preview}`
                : t.kind === 'announce'
                  ? 'Les informations officielles du club'
                  : 'Dites bonjour 👋'}
            </small>
          </span>
          {t.unread > 0 && <span className="unread">{t.unread}</span>}
        </button>
        {t.canDelete && (
          <button className="thread-del" onClick={() => onRemove(t)} aria-label={t.kind === 'group' && !t.owner ? 'Quitter le groupe' : 'Supprimer la discussion'}>
            {t.kind === 'group' && !t.owner ? <LogOut size={16} /> : <Trash2 size={16} />}
          </button>
        )}
      </div>
    </>
  );
}

const GROUP_EMOJIS = ['⚽', '🏆', '🥅', '👟', '🧤', '🎉', '🍕', '🚗', '📣', '🌟', '💪', '🎂', '🏕️', '📸', '🧃', '❤️'];
const GROUP_COLORS = ['#5e5ce6', '#0a84ff', '#30b0c7', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#8e8e93'];

/** Icône d'un groupe : emoji sur une couleur, ou photo. */
function IconPicker({ value, onChange }: { value: { emoji: string; color: string; image: string | null }; onChange: (v: { emoji: string; color: string; image: string | null }) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  return (
    <div className="icon-picker">
      <div className="ip-preview">
        {value.image ? (
          <img src={value.image} alt="" />
        ) : (
          <span style={{ background: value.color }}>{value.emoji || <Users size={30} />}</span>
        )}
        <button type="button" className="btn sm" onClick={() => file.current?.click()}>
          <ImagePlus /> {value.image ? 'Changer' : 'Photo'}
        </button>
        {value.image && (
          <button type="button" className="btn sm ghost" onClick={() => onChange({ ...value, image: null })}>
            Retirer
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              onChange({ ...value, image: await preparePortrait(f, 256) });
            } catch {
              toast('Image illisible', true);
            }
          }}
        />
      </div>
      {!value.image && (
        <>
          <div className="ip-emojis">
            {GROUP_EMOJIS.map((e) => (
              <button key={e} type="button" className={value.emoji === e ? 'on' : ''} onClick={() => onChange({ ...value, emoji: e })}>
                {e}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {GROUP_COLORS.map((c) => (
              <button key={c} type="button" className={`swatch${value.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onChange({ ...value, color: c })} aria-label={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ContactPicker({ contacts, value, onChange, exclude = [] }: { contacts: ChatContact[]; value: string[]; onChange: (v: string[]) => void; exclude?: string[] }) {
  const [s, setS] = useState('');
  const list = contacts.filter((c) => !exclude.includes(c.id) && (!s || `${c.name} ${c.kids.join(' ')}`.toLowerCase().includes(s.toLowerCase())));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" placeholder="Rechercher un parent, un éducateur, un enfant…" value={s} onChange={(e) => setS(e.target.value)} />
      {value.length > 0 && (
        <div className="chips">
          {value.map((id) => (
            <button key={id} type="button" className="chip on" onClick={() => onChange(value.filter((x) => x !== id))}>
              {contacts.find((c) => c.id === id)?.name ?? 'Membre'} <X size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="contact-list">
        {list.map((c) => {
          const on = value.includes(c.id);
          return (
            <button key={c.id} type="button" className={`thread-row${on ? ' picked' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}>
              <Avatar name={c.name} />
              <span className="grow">
                <b>{c.name}</b>
                <small>{c.coach ? `Éducateur · ${c.team}` : `Parent de ${c.kids.join(', ')}`}</small>
              </span>
              <span className={`pick-box${on ? ' on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewMessage({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const q = useAsync(() => api.get<ChatContact[]>('/chat/contacts'), []);
  const toast = useToast();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [s, setS] = useState('');
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState({ emoji: '⚽', color: GROUP_COLORS[0], image: null as string | null });
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = (q.data ?? []).filter((c) => !s || `${c.name} ${c.kids.join(' ')}`.toLowerCase().includes(s.toLowerCase()));
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/chat/groups', { title, members, emoji: icon.emoji, color: icon.color, image: icon.image ?? undefined });
      toast('Groupe créé');
      onOpen(r.id);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Nouvelle discussion"
      onClose={onClose}
      footer={
        mode === 'group' ? (
          <button className="btn primary" disabled={busy || !title.trim() || !members.length} onClick={create}>
            <Users /> Créer le groupe{members.length ? ` (${members.length + 1})` : ''}
          </button>
        ) : undefined
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Seg<'direct' | 'group'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'direct', label: <><MessageCircle /> Message privé</> },
            { value: 'group', label: <><Users /> Groupe</> },
          ]}
        />
        {mode === 'direct' ? (
          <>
            <input className="input" autoFocus placeholder="Nom d’un parent, d’un éducateur ou d’un enfant…" value={s} onChange={(e) => setS(e.target.value)} />
            <div className="contact-list">
              {list.map((c) => (
                <button key={c.id} className="thread-row" onClick={async () => onOpen((await api.post<{ id: string }>('/chat/direct', { userId: c.id })).id)}>
                  <Avatar name={c.name} />
                  <span className="grow">
                    <b>{c.name}</b>
                    <small>{c.coach ? `Éducateur · ${c.team}` : `Parent de ${c.kids.join(', ')}`}</small>
                  </span>
                  <ChevronRight size={16} className="muted" />
                </button>
              ))}
              {q.data && !list.length && <p className="muted small" style={{ padding: 16 }}>Personne trouvé.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="group-head">
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <Field label="Titre du groupe">
              <input className="input" autoFocus maxLength={60} value={title} placeholder="Ex. Parents du covoiturage, Goûter de Noël…" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div>
              <span className="lbl">Membres</span>
              <ContactPicker contacts={q.data ?? []} value={members} onChange={setMembers} />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

const ROLE_NAMES: Record<string, string> = { parent: 'Parents', coach: 'Éducateurs', dirigeant: 'Dirigeants' };

/** Réglages d'un salon : titre, icône et membres (groupe), permissions par rôle (autoriser / par défaut / refuser). */
function ChannelSettingsSheet({ t, onClose, onSaved }: { t: ChatThread; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const q = useAsync(() => api.get<ChannelSettings>(`/chat/threads/${t.id}/settings`), [t.id]);
  const contacts = useAsync(() => (t.kind === 'group' ? api.get<ChatContact[]>('/chat/contacts') : Promise.resolve([] as ChatContact[])), [t.id]);
  const [tab, setTab] = useState<'general' | 'perms'>(t.kind === 'group' ? 'general' : 'perms');
  const [over, setOver] = useState<Record<string, Partial<Record<ChannelPerm, boolean>>> | null>(null);
  const [title, setTitle] = useState(t.title);
  const [icon, setIcon] = useState({ emoji: t.icon?.emoji ?? '⚽', color: t.color ?? GROUP_COLORS[0], image: t.icon?.image ?? null });
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setOver(Object.fromEntries(q.data.roles.map((r) => [r.role, { ...r.overrides }])));
  }, [q.data]);

  const setPerm = (role: string, k: ChannelPerm, next: boolean | undefined) =>
    setOver((o) => {
      const r = { ...(o?.[role] ?? {}) };
      if (next === undefined) delete r[k];
      else r[k] = next;
      return { ...(o ?? {}), [role]: r };
    });

  const save = async () => {
    setBusy(true);
    try {
      if (t.kind === 'group') {
        const iconChanged = icon.image !== (t.icon?.image ?? null);
        await api.patch(`/chat/threads/${t.id}`, {
          title,
          emoji: icon.emoji,
          color: icon.color,
          ...(iconChanged ? { image: icon.image && icon.image.startsWith('data:') ? icon.image : null } : {}),
          add,
          remove,
        });
      }
      if (over && t.kind !== 'direct') await api.put(`/chat/threads/${t.id}/permissions`, { perms: over });
      toast('Salon mis à jour');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const members = (q.data?.members ?? []).filter((m) => !remove.includes(m.id));
  return (
    <Sheet
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <ThreadAvatar t={t} size={30} /> {t.title}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !q.data || (t.kind === 'group' && !title.trim())} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {t.kind === 'group' && (
            <Seg<'general' | 'perms'> value={tab} onChange={setTab} options={[{ value: 'general', label: 'Groupe' }, { value: 'perms', label: 'Permissions' }]} />
          )}
          {tab === 'general' && t.kind === 'group' ? (
            <>
              <div className="group-head">
                <IconPicker value={icon} onChange={setIcon} />
              </div>
              <Field label="Titre du groupe">
                <input className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <div>
                <span className="lbl">Membres · {members.length + add.length}</span>
                <div className="contact-list">
                  {members.map((m) => (
                    <div key={m.id} className="thread-row" style={{ cursor: 'default' }}>
                      <Avatar name={m.name} size="sm" />
                      <span className="grow">
                        <b>{m.name}</b>
                        <small>{m.owner ? 'Créateur du groupe' : ROLE_LABELS[m.role]}</small>
                      </span>
                      {!m.owner && (
                        <button className="btn sm ghost" onClick={() => setRemove([...remove, m.id])}>
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="lbl">Ajouter des membres</span>
                <ContactPicker contacts={contacts.data ?? []} value={add} onChange={setAdd} exclude={members.map((m) => m.id)} />
              </div>
            </>
          ) : (
            <>
              <p className="small muted">
                Pour chaque rôle, une permission peut être <b>autorisée</b> (✓), <b>refusée</b> (✕) ou suivre la <b>valeur par défaut</b> du salon (/). L’administrateur{t.kind === 'group' ? ' et le créateur du groupe gardent' : ' garde'} toujours tous les droits.
              </p>
              <div className="perm-table" role="table">
                <div className="perm-row head" role="row">
                  <span role="columnheader" />
                  {q.data.roles.map((r) => (
                    <b key={r.role} role="columnheader">
                      {ROLE_NAMES[r.role]}
                    </b>
                  ))}
                </div>
                {q.data.catalog.map((p) => (
                  <div key={p.key} className="perm-row" role="row">
                    <span role="rowheader">
                      <b>{p.label}</b>
                      {p.hint && <small>{p.hint}</small>}
                    </span>
                    {q.data!.roles.map((r) => {
                      const o = over?.[r.role]?.[p.key];
                      const eff = o ?? r.defaults[p.key];
                      return (
                        <div
                          key={r.role}
                          role="radiogroup"
                          className={`perm-cell ${o === true ? 'allow' : o === false ? 'deny' : 'inherit'}${eff ? ' eff' : ''}`}
                          title={o === undefined ? `Par défaut : ${r.defaults[p.key] ? 'autorisé' : 'refusé'}` : o ? 'Autorisé' : 'Refusé'}
                          aria-label={`${ROLE_NAMES[r.role]} · ${p.label}`}
                        >
                          <button type="button" role="radio" aria-checked={o === false} className="pc-seg x" onClick={() => setPerm(r.role, p.key, false)} aria-label="Refuser">
                            <X size={13} strokeWidth={3} />
                          </button>
                          <button type="button" role="radio" aria-checked={o === undefined} className="pc-seg i" onClick={() => setPerm(r.role, p.key, undefined)} aria-label="Par défaut">
                            /
                          </button>
                          <button type="button" role="radio" aria-checked={o === true} className="pc-seg v" onClick={() => setPerm(r.role, p.key, true)} aria-label="Autoriser">
                            <Check size={13} strokeWidth={3} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOver(Object.fromEntries(q.data!.roles.map((r) => [r.role, {}])))}>
                <RotateCcw /> Tout remettre par défaut
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ discussion */

interface ThreadPayload { thread: ChatThread; members: { id: string; name: string; readAt: number }[]; messages: ChatMessage[]; more: boolean }

function Thread({ id, onBack, onRead, onRemove }: { id: string; onBack: () => void; onRead: () => void; onRemove: (t: ChatThread, forAll?: boolean) => void }) {
  const { me } = useApp();
  const toast = useToast();
  const [data, setData] = useState<ThreadPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [drawer, setDrawer] = useState<null | 'apps' | 'poll' | 'tasks' | 'match' | 'carpool' | 'location'>(null);
  const [readers, setReaders] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const photo = useRef<HTMLInputElement>(null);

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const load = useCallback(
    async (markRead = true) => {
      try {
        const payload = await api.get<ThreadPayload>(`/chat/threads/${id}/messages`);
        setData(payload);
        if (markRead && (payload.thread.unread > 0 || !payload.messages.length)) {
          await api.post(`/chat/threads/${id}/read`);
          onReadRef.current();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLive((m) => {
    if (m.t === 'chat' && m.threadId === id) void load(true);
    if (m.t === 'chat-read' && m.threadId === id) void load(false);
    if (m.t === 'carpool') void load(false);
  });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [data]);

  const send = async (kind: string, body: string, d?: unknown) => {
    try {
      atBottom.current = true;
      const msg = await api.post<ChatMessage>(`/chat/threads/${id}/messages`, { kind, body, data: d });
      setData((x) => (x ? { ...x, messages: [...x.messages, msg] } : x));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const replace = (m: ChatMessage) => setData((x) => (x ? { ...x, messages: x.messages.map((y) => (y.id === m.id ? m : y)) } : x));

  if (error) return <Empty title="Discussion introuvable" text={error} />;
  if (!data) return <Spinner fill />;
  const t = data.thread;
  const others = data.members.filter((m) => m.id !== me.user.id);
  const lastMine = [...data.messages].reverse().find((m) => m.mine && m.kind !== 'deleted');

  // Regroupement : jour, puis messages consécutifs d'une même personne.
  const rows: ReactNode[] = [];
  let lastDay = '';
  data.messages.forEach((m, i) => {
    const day = new Date(m.at).toDateString();
    if (day !== lastDay) {
      rows.push(
        <div key={`d${m.id}`} className="day-sep">
          {dayLabel(m.at)}
        </div>,
      );
      lastDay = day;
    }
    const prev = data.messages[i - 1];
    const next = data.messages[i + 1];
    const first = !prev || prev.userId !== m.userId || new Date(prev.at).toDateString() !== day || m.at - prev.at > 8 * 60e3;
    const last = !next || next.userId !== m.userId || m.at - next.at < -8 * 60e3 || new Date(next.at).toDateString() !== day;
    const readBy = m.mine ? others.filter((o) => o.readAt >= m.at) : [];
    rows.push(
      <Bubble
        key={m.id}
        m={m}
        first={first}
        last={last}
        showAuthor={t.kind !== 'direct'}
        canReact={t.perms.react}
        canManage={t.perms.manage}
        menu={menu === m.id}
        onMenu={(open) => setMenu(open ? m.id : null)}
        onChange={replace}
        onDelete={() => setData((x) => (x ? { ...x, messages: x.messages.map((y) => (y.id === m.id ? { ...y, kind: 'deleted', body: '' } : y)) } : x))}
        receipt={
          m.id === lastMine?.id ? (
            <button className="receipt" onClick={() => t.kind !== 'direct' && setReaders(m)}>
              {readBy.length ? (
                t.kind === 'direct' ? (
                  <>
                    <CheckCheck size={13} /> Lu {listTime(readBy[0].readAt)}
                  </>
                ) : (
                  <>
                    <span className="read-stack">
                      {readBy.slice(0, 3).map((r) => (
                        <Avatar key={r.id} name={r.name} size="sm" />
                      ))}
                    </span>
                    Lu par {readBy.length}
                  </>
                )
              ) : (
                <>
                  <Check size={13} /> Distribué
                </>
              )}
            </button>
          ) : null
        }
      />,
    );
  });

  return (
    <div className="thread">
      <header className="thread-head">
        <button className="btn icon ghost only-mobile-chat" onClick={onBack} aria-label="Retour">
          <ArrowLeft />
        </button>
        <ThreadAvatar t={t} size={38} />
        <div className="grow">
          <b>{t.title}</b>
          <small>
            {t.kind === 'direct' ? (t.otherRole === 'parent' ? 'Parent' : 'Éducateur') : `${data.members.length} membres`}
            {!t.perms.send ? ' · lecture seule' : ''}
          </small>
        </div>
        {(t.canConfigure || t.canDelete) && (
          <Menu
            trigger={(open) => (
              <button className="btn icon ghost" onClick={open} aria-label="Options de la discussion">
                <MoreHorizontal />
              </button>
            )}
          >
            {(close) => (
              <>
                {t.canConfigure && t.kind !== 'direct' && (
                  <button onClick={() => (close(), setSettings(true))}>
                    <Settings2 size={16} /> {t.kind === 'group' ? 'Modifier le groupe' : 'Permissions du salon'}
                  </button>
                )}
                {t.kind === 'group' && t.owner && (
                  <button className="danger" onClick={() => (close(), onRemove(t, true))}>
                    <Trash2 size={16} /> Supprimer le groupe pour tous
                  </button>
                )}
                {t.canDelete && (
                  <button className="danger" onClick={() => (close(), onRemove(t))}>
                    {t.kind === 'group' && !t.owner ? <LogOut size={16} /> : <Trash2 size={16} />}
                    {t.kind === 'group' ? (t.owner ? 'Retirer de ma liste' : 'Quitter le groupe') : 'Supprimer la discussion'}
                  </button>
                )}
              </>
            )}
          </Menu>
        )}
      </header>
      <div
        className="thread-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (menu) setMenu(null);
        }}
      >
        {!data.messages.length && (
          <div className="thread-hello">
            <ThreadAvatar t={t} size={72} />
            <b>{t.title}</b>
            <p>
              {t.kind === 'team'
                ? 'La discussion de toute l’équipe : parents et éducateurs. Essayez le + pour un sondage ou un covoiturage.'
                : t.kind === 'announce'
                  ? 'Les informations officielles du club. Les parents les lisent ici, sans pouvoir répondre.'
                  : t.kind === 'group'
                    ? 'Le groupe est créé : dites bonjour 👋'
                    : 'Début de la discussion.'}
            </p>
          </div>
        )}
        {rows}
      </div>
      {!t.perms.send ? (
        <div className="composer-ro">
          <Lock size={15} />
          {t.kind === 'announce' ? 'Salon d’annonces : seuls les responsables du club y publient.' : 'Vous ne pouvez pas écrire dans ce salon.'}
        </div>
      ) : (
      <form
        className="composer-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void send('text', text.trim());
          setText('');
        }}
      >
        {t.perms.media && (
          <button type="button" className={`plus${drawer ? ' on' : ''}`} onClick={() => setDrawer(drawer ? null : 'apps')} aria-label="Plus d’options">
            <Plus />
          </button>
        )}
        <textarea
          rows={1}
          placeholder="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <button type="submit" className="send" disabled={!text.trim()} aria-label="Envoyer">
          <ArrowUp />
        </button>
        <input
          ref={photo}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const p = await preparePhoto(f);
              atBottom.current = true;
              const msg = await api.post<ChatMessage>(`/chat/threads/${id}/image`, { image: p.image, width: p.width, height: p.height });
              setData((x) => (x ? { ...x, messages: [...x.messages, msg] } : x));
            } catch (err) {
              toast((err as Error).message, true);
            }
          }}
        />
      </form>
      )}
      {settings && (
        <ChannelSettingsSheet
          t={t}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false);
            void load(false);
            onRead();
          }}
        />
      )}
      {drawer === 'apps' && (
        <div className="apps-drawer">
          {[
            { k: 'photo', label: 'Photo', icon: <ImagePlus />, c: '#34c759', fn: () => (setDrawer(null), photo.current?.click()) },
            ...(t.kind === 'team' ? [{ k: 'carpool', label: 'Covoiturage', icon: <Car />, c: '#0a84ff', fn: () => setDrawer('carpool') }] : []),
            { k: 'poll', label: 'Sondage', icon: <BarChart3 />, c: '#ff9500', fn: () => setDrawer('poll') },
            { k: 'tasks', label: 'Qui apporte quoi ?', icon: <ListChecks />, c: '#af52de', fn: () => setDrawer('tasks') },
            { k: 'match', label: 'Match', icon: <Trophy />, c: '#ff2d55', fn: () => setDrawer('match') },
            { k: 'location', label: 'Lieu', icon: <MapPin />, c: '#5e5ce6', fn: () => setDrawer('location') },
          ].map((a) => (
            <button key={a.k} onClick={a.fn}>
              <span style={{ background: a.c }}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {drawer === 'poll' && <PollSheet onClose={() => setDrawer(null)} onSend={(d) => (setDrawer(null), send('poll', '', d))} />}
      {drawer === 'tasks' && <TasksSheet onClose={() => setDrawer(null)} onSend={(d) => (setDrawer(null), send('tasks', '', d))} />}
      {drawer === 'location' && <LocationSheet onClose={() => setDrawer(null)} onSend={(d) => (setDrawer(null), send('location', '', d))} />}
      {drawer === 'match' && <MatchPicker teamId={t.teamId} onClose={() => setDrawer(null)} onPick={(c) => (setDrawer(null), send('match', '', { eventId: c.eventId, date: c.date }))} />}
      {drawer === 'carpool' && <CarpoolSheet teamId={t.teamId} onClose={() => (setDrawer(null), void load())} />}
      {readers && (
        <Sheet title="Lu par" onClose={() => setReaders(null)}>
          <div className="contact-list">
            {others.map((o) => (
              <div key={o.id} className="thread-row" style={{ cursor: 'default' }}>
                <Avatar name={o.name} size="sm" />
                <span className="grow">
                  <b>{o.name}</b>
                </span>
                <small className={o.readAt >= readers.at ? 'read-yes' : 'muted'}>{o.readAt >= readers.at ? `Lu ${listTime(o.readAt)}` : 'Pas encore lu'}</small>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bulles */

function Bubble({
  m, first, last, showAuthor, canReact, canManage, receipt, menu, onMenu, onChange, onDelete,
}: {
  m: ChatMessage; first: boolean; last: boolean; showAuthor: boolean; canReact: boolean; canManage: boolean; receipt: ReactNode; menu: boolean;
  onMenu: (open: boolean) => void; onChange: (m: ChatMessage) => void; onDelete: () => void;
}) {
  const confirm = useConfirm();
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoom, setZoom] = useState(false);
  const react = async (emoji: string) => {
    onMenu(false);
    if (!canReact) return;
    onChange(await api.post<ChatMessage>(`/chat/messages/${m.id}/react`, { emoji }));
  };
  const counts = useMemo(() => {
    const c: Record<string, { n: number; mine: boolean; names: string[] }> = {};
    for (const r of m.reactions) {
      c[r.emoji] = c[r.emoji] ?? { n: 0, mine: false, names: [] };
      c[r.emoji].n++;
      c[r.emoji].names.push(r.name);
      if (r.mine) c[r.emoji].mine = true;
    }
    return Object.entries(c);
  }, [m.reactions]);
  const rich = !['text', 'deleted'].includes(m.kind);
  return (
    <div className={`msg${m.mine ? ' mine' : ''}${first ? ' first' : ''}${last ? ' last' : ''}${rich ? ' rich' : ''}`}>
      {!m.mine && showAuthor && first && <span className="msg-author">{m.author}</span>}
      <div className="msg-line">
        {!m.mine && showAuthor && <span className="msg-av">{last && <Avatar name={m.author ?? '?'} size="sm" />}</span>}
        <div
          className="msg-wrap"
          onContextMenu={(e) => (e.preventDefault(), (canReact || m.mine || canManage) && onMenu(true))}
          onTouchStart={() => (press.current = setTimeout(() => (canReact || m.mine || canManage) && onMenu(true), 420))}
          onTouchEnd={() => press.current && clearTimeout(press.current)}
          onTouchMove={() => press.current && clearTimeout(press.current)}
          onDoubleClick={() => react('❤️')}
        >
          {menu && (
            <div className="tapback" onClick={(e) => e.stopPropagation()}>
              {canReact && TAPBACKS.map((e) => (
                <button key={e} className={m.reactions.some((r) => r.mine && r.emoji === e) ? 'on' : ''} onClick={() => react(e)}>
                  {e}
                </button>
              ))}
              {(m.mine || canManage) && m.kind !== 'deleted' && (
                <button
                  className="del"
                  onClick={async () => {
                    onMenu(false);
                    if (await confirm({ title: 'Supprimer ce message ?', confirm: 'Supprimer', danger: true })) {
                      await api.del(`/chat/messages/${m.id}`);
                      onDelete();
                    }
                  }}
                  aria-label="Supprimer"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
          {m.kind === 'text' && <div className="bubble">{m.body}</div>}
          {m.kind === 'deleted' && <div className="bubble deleted">Message supprimé</div>}
          {m.kind === 'image' && (
            <>
              <img className="bubble-img" src={`/api/chat/images/${m.id}`} alt="" style={{ aspectRatio: `${m.data?.w ?? 4} / ${m.data?.h ?? 3}` }} onClick={() => setZoom(true)} />
              {zoom &&
                createPortal(
                  <div className="lightbox" onClick={() => setZoom(false)}>
                    <div className="lb-top">
                      <span className="grow" />
                      <button className="lb-btn" aria-label="Fermer">
                        <X />
                      </button>
                    </div>
                    <div className="lb-stage">
                      <img src={`/api/chat/images/${m.id}`} alt="" />
                    </div>
                  </div>,
                  document.body,
                )}
            </>
          )}
          {m.kind === 'poll' && <PollCard m={m} onChange={onChange} />}
          {m.kind === 'tasks' && <TasksCard m={m} onChange={onChange} />}
          {m.kind === 'match' && <MatchCard m={m} />}
          {m.kind === 'location' && <LocationCard m={m} />}
          {m.kind === 'carpool' && <CarpoolCard m={m} onChange={onChange} />}
          {counts.length > 0 && (
            <div className="msg-reacts">
              {counts.map(([e, c]) => (
                <button key={e} className={c.mine ? 'mine' : ''} title={c.names.join(', ')} onClick={() => react(e)}>
                  {e}
                  {c.n > 1 && <small>{c.n}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {last && (
        <span className="msg-meta">
          {time(m.at)}
          {receipt}
        </span>
      )}
      {menu && <div className="tapback-backdrop" onClick={() => onMenu(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ cartes interactives */

function PollCard({ m, onChange }: { m: ChatMessage; onChange: (m: ChatMessage) => void }) {
  const d = m.data;
  const max = Math.max(1, ...d.options.map((o: { votes: number }) => o.votes));
  return (
    <div className="card-msg poll">
      <div className="card-msg-head" style={{ background: 'linear-gradient(135deg,#ff9500,#ff5e3a)' }}>
        <BarChart3 size={16} /> Sondage
      </div>
      <b className="card-msg-title">{d.question}</b>
      <div className="poll-opts">
        {d.options.map((o: { id: string; label: string; votes: number; mine: boolean; voters: string[] }) => (
          <button key={o.id} className={`poll-opt${o.mine ? ' mine' : ''}`} title={o.voters.join(', ')} onClick={async () => onChange(await api.post<ChatMessage>(`/chat/messages/${m.id}/vote`, { optionId: o.id }))}>
            <i style={{ width: `${(o.votes / max) * 100}%` }} />
            <span className="check">{o.mine ? <Check size={13} strokeWidth={3} /> : null}</span>
            <span className="grow">{o.label}</span>
            <b>{o.votes || ''}</b>
          </button>
        ))}
      </div>
      <small className="card-msg-foot">
        {d.total} vote{d.total > 1 ? 's' : ''}
        {d.multi ? ' · plusieurs choix possibles' : ''}
      </small>
    </div>
  );
}

function TasksCard({ m, onChange }: { m: ChatMessage; onChange: (m: ChatMessage) => void }) {
  const toast = useToast();
  const d = m.data;
  const done = d.items.filter((i: { by: unknown }) => i.by).length;
  return (
    <div className="card-msg tasks">
      <div className="card-msg-head" style={{ background: 'linear-gradient(135deg,#af52de,#5e5ce6)' }}>
        <ListChecks size={16} /> Qui apporte quoi ?
      </div>
      <b className="card-msg-title">
        {d.title}
        {d.date && <small> · {new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</small>}
      </b>
      <div className="task-list">
        {d.items.map((it: { id: string; label: string; by: { name: string; mine: boolean } | null }) => (
          <div key={it.id} className={`task${it.by ? ' taken' : ''}`}>
            <span className="task-check">{it.by ? <Check size={14} strokeWidth={3} /> : null}</span>
            <span className="grow">
              <b>{it.label}</b>
              {it.by && <small>{it.by.mine ? 'Vous' : it.by.name}</small>}
            </span>
            {(!it.by || it.by.mine) && (
              <button
                className={`btn sm${it.by ? ' ghost' : ' primary'}`}
                onClick={async () => {
                  try {
                    onChange(await api.post<ChatMessage>(`/chat/messages/${m.id}/claim`, { itemId: it.id }));
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                {it.by ? 'Annuler' : 'Je m’en charge'}
              </button>
            )}
          </div>
        ))}
      </div>
      <small className="card-msg-foot">
        {done}/{d.items.length} pris en charge
      </small>
    </div>
  );
}

function MatchCard({ m }: { m: ChatMessage }) {
  const d = m.data;
  if (d.gone) return <div className="bubble deleted">Match supprimé</div>;
  const date = new Date(`${d.date}T12:00`);
  return (
    <Link to={matchPath(d.eventId, d.date)} className="card-msg match">
      <div className="card-msg-head" style={{ background: 'linear-gradient(135deg,#ff2d55,#c9184a)' }}>
        <Trophy size={16} /> {d.type === 'plateau' ? 'Plateau' : d.type === 'tournament' ? 'Tournoi' : 'Match'}
      </div>
      <div className="match-card-body">
        <span className="tk-date">
          <small>{date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '').toUpperCase()}</small>
          <b>{date.getDate()}</b>
          <small>{date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '').toUpperCase()}</small>
        </span>
        <span className="grow">
          <b>{d.title}</b>
          <small>
            {d.meetTime ? `RDV ${formatTime(d.meetTime)} · ` : ''}
            {d.time ? `coup d’envoi ${formatTime(d.time)}` : ''}
          </small>
          {d.location && <small>📍 {d.location}</small>}
        </span>
        <ChevronRight size={18} className="muted" />
      </div>
    </Link>
  );
}

function LocationCard({ m }: { m: ChatMessage }) {
  const d = m.data;
  return (
    <a href={mapsUrl(d.address || d.label)} target="_blank" rel="noreferrer" className="card-msg location">
      <div className="map-art">
        <i />
        <i />
        <i />
        <span className="pin">
          <MapPin size={22} />
        </span>
      </div>
      <div className="loc-body">
        <b>{d.label}</b>
        {d.address && <small>{d.address}</small>}
        <span className="tk-go">
          <Navigation size={13} /> Itinéraire
        </span>
      </div>
    </a>
  );
}

function CarpoolCard({ m, onChange }: { m: ChatMessage; onChange: (m: ChatMessage) => void }) {
  const toast = useToast();
  const d = m.data;
  if (d.gone) return <div className="bubble deleted">🚗 Trajet retiré</div>;
  const date = new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (d.request) {
    const r = d.request;
    return (
      <div className="card-msg carpool-msg need">
        <div className="card-msg-head" style={{ background: 'linear-gradient(135deg,#ff9500,#f97316)' }}>
          🙋 Cherche une place
        </div>
        <b className="card-msg-title">
          {r.firstName} cherche une place {r.direction === 'both' ? '' : `(${DIRECTION[r.direction as 'aller'].label.toLowerCase()})`}
        </b>
        <small className="card-msg-sub">
          {d.title} · {date}
        </small>
        {r.solved ? (
          <span className="badge green" style={{ margin: '0 14px 12px', alignSelf: 'flex-start' }}>
            <Check /> Place trouvée
          </span>
        ) : (
          <Link className="btn sm primary" style={{ margin: '0 14px 12px', alignSelf: 'flex-start' }} to={`${matchPath(d.eventId, d.date)}?covoiturage=1`}>
            <Car /> Je propose une place
          </Link>
        )}
      </div>
    );
  }
  const o = d.offer;
  const kids = (d.kids as { id: string; firstName: string; booked: boolean }[]).filter((k) => !k.booked);
  return (
    <div className="card-msg carpool-msg">
      <div className="card-msg-head" style={{ background: 'linear-gradient(135deg,#0a84ff,#1d4ed8)' }}>
        <Car size={16} /> Covoiturage
      </div>
      <b className="card-msg-title">{o.mine ? 'Vous proposez des places' : `${o.driver.name} propose des places`}</b>
      <small className="card-msg-sub">
        {d.title} · {date}
      </small>
      <div className="carpool-msg-row">
        <span className="grow small">
          {DIRECTION[o.direction as 'aller'].label}
          {o.time && ` · départ ${formatTime(o.time)}`}
          {o.place && <><br />📍 {o.place}</>}
        </span>
        <span className="seats">
          {Array.from({ length: o.seats }, (_, i) => (
            <i key={i} className={o.bookings[i] ? 'taken' : ''}>
              {o.bookings[i]?.firstName[0] ?? ''}
            </i>
          ))}
        </span>
      </div>
      <div className="carpool-msg-actions">
        {o.free === 0 ? (
          <span className="small muted">Voiture complète 🎉</span>
        ) : (
          !o.mine &&
          kids.map((k) => (
            <button
              key={k.id}
              className="btn sm primary"
              onClick={async () => {
                try {
                  await api.post<Carpool>(`/carpool/offer/${o.id}/book`, { playerId: k.id });
                  toast(`Place réservée pour ${k.firstName} 🚗`);
                  onChange({ ...m, data: { ...d, offer: { ...o, free: o.free - 1, bookings: [...o.bookings, { playerId: k.id, firstName: k.firstName, mine: true }] }, kids: d.kids.map((x: { id: string }) => (x.id === k.id ? { ...x, booked: true } : x)) } });
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              Réserver pour {k.firstName}
            </button>
          ))
        )}
        {o.mine && <span className="small muted">{o.free} place{o.free > 1 ? 's' : ''} encore libre{o.free > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ création de cartes */

function PollSheet({ onClose, onSend }: { onClose: () => void; onSend: (d: unknown) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <Sheet
      title="Sondage"
      onClose={onClose}
      footer={
        <button className="btn primary block" disabled={!valid} onClick={() => onSend({ question, options: options.filter((o) => o.trim()), multi })}>
          Envoyer le sondage
        </button>
      }
    >
      <div className="stack">
        <input className="input" autoFocus placeholder="Votre question (ex. : maillot vert ou blanc pour la photo ?)" value={question} onChange={(e) => setQuestion(e.target.value)} />
        {options.map((o, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <input className="input" placeholder={`Réponse ${i + 1}`} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            {options.length > 2 && (
              <button className="btn icon ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Retirer">
                <X />
              </button>
            )}
          </div>
        ))}
        {options.length < 8 && (
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, ''])}>
            <Plus /> Réponse
          </button>
        )}
        <label className="check small">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          <span>Plusieurs réponses possibles</span>
        </label>
      </div>
    </Sheet>
  );
}

const TASK_IDEAS = ['🍪 Goûter', '💧 Bouteilles d’eau', '👕 Laver les maillots', '⚽ Ballons', '🩹 Trousse de secours', '🟧 Chasubles', '📸 Photos du match'];

function TasksSheet({ onClose, onSend }: { onClose: () => void; onSend: (d: unknown) => void }) {
  const [title, setTitle] = useState('Match de samedi');
  const [date, setDate] = useState('');
  const [items, setItems] = useState<string[]>(['🍪 Goûter', '💧 Bouteilles d’eau', '👕 Laver les maillots']);
  const [add, setAdd] = useState('');
  return (
    <Sheet
      title="Qui apporte quoi ?"
      onClose={onClose}
      footer={
        <button className="btn primary block" disabled={!items.length} onClick={() => onSend({ title, date, items })}>
          Envoyer la liste
        </button>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="chips">
          {TASK_IDEAS.map((t) => (
            <button key={t} className={`chip${items.includes(t) ? ' on' : ''}`} onClick={() => setItems(items.includes(t) ? items.filter((x) => x !== t) : [...items, t])}>
              {t}
            </button>
          ))}
        </div>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (add.trim()) setItems([...items, add.trim()]);
            setAdd('');
          }}
        >
          <input className="input" placeholder="Autre chose…" value={add} onChange={(e) => setAdd(e.target.value)} />
          <button className="btn" disabled={!add.trim()}>
            Ajouter
          </button>
        </form>
      </div>
    </Sheet>
  );
}

function LocationSheet({ onClose, onSend }: { onClose: () => void; onSend: (d: unknown) => void }) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  return (
    <Sheet
      title="Partager un lieu"
      onClose={onClose}
      footer={
        <button className="btn primary block" disabled={!label.trim()} onClick={() => onSend({ label, address })}>
          Envoyer
        </button>
      }
    >
      <div className="stack">
        <Field label="Nom">
          <input className="input" autoFocus placeholder="Stade de Teyran, parking de l’école…" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Adresse" hint="facultatif">
          <input className="input" placeholder="12 avenue du Stade, Teyran" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function useUpcoming(teamId: string | null) {
  return useAsync(async () => (await api.get<Carpool[]>('/carpool-upcoming')).filter((c) => !teamId || c.teamId === teamId), [teamId]);
}

function MatchPicker({ teamId, onClose, onPick }: { teamId: string | null; onClose: () => void; onPick: (c: Carpool) => void }) {
  const q = useUpcoming(teamId);
  return (
    <Sheet title="Partager un match" onClose={onClose}>
      <div className="contact-list">
        {(q.data ?? []).map((c) => (
          <button key={c.eventId + c.date} className="thread-row" onClick={() => onPick(c)}>
            <span className="thread-av" style={{ width: 40, height: 40, background: '#ff2d55' }}>
              <Trophy size={18} />
            </span>
            <span className="grow">
              <b>{c.title}</b>
              <small>{new Date(`${c.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</small>
            </span>
          </button>
        ))}
        {q.data && !q.data.length && <p className="muted small" style={{ padding: 12 }}>Pas de match dans les prochains jours.</p>}
      </div>
    </Sheet>
  );
}

function CarpoolSheet({ teamId, onClose }: { teamId: string | null; onClose: () => void }) {
  const q = useUpcoming(teamId);
  const [pick, setPick] = useState<Carpool | null>(null);
  return (
    <Sheet title={pick ? pick.title : 'Covoiturage'} onClose={onClose}>
      {pick ? (
        <CarpoolPanel eventId={pick.eventId} date={pick.date} />
      ) : (
        <div className="contact-list">
          {(q.data ?? []).map((c) => (
            <button key={c.eventId + c.date} className="thread-row" onClick={() => setPick(c)}>
              <span className="thread-av" style={{ width: 40, height: 40, background: '#0a84ff' }}>
                <Car size={18} />
              </span>
              <span className="grow">
                <b>{c.title}</b>
                <small>
                  {new Date(`${c.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {c.free} place{c.free > 1 ? 's' : ''} libre{c.free > 1 ? 's' : ''}
                </small>
              </span>
              <ChevronRight size={16} className="muted" />
            </button>
          ))}
          {q.data && !q.data.length && <p className="muted small" style={{ padding: 12 }}>Pas de match dans les prochains jours.</p>}
        </div>
      )}
    </Sheet>
  );
}
