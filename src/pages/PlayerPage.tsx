import { ArrowLeft, Eye, EyeOff, Flag, Lock, MessageCircle, Pencil, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Empty, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { formatDate, playerName, relative, useApp } from '../lib/store';
import type { NoteKind, Player, PlayerNote } from '../lib/types';
import { LevelDots, PlayerForm } from './Players';

export const NOTE_KINDS: { value: NoteKind; label: string; plural: string; icon: React.ReactNode }[] = [
  { value: 'force', label: 'Point fort', plural: 'Points forts', icon: <Sparkles size={14} /> },
  { value: 'faiblesse', label: 'À travailler', plural: 'À travailler', icon: <TrendingUp size={14} /> },
  { value: 'objectif', label: 'Objectif', plural: 'Objectifs', icon: <Flag size={14} /> },
  { value: 'remarque', label: 'Remarque', plural: 'Remarques', icon: <MessageCircle size={14} /> },
];
const KIND = Object.fromEntries(NOTE_KINDS.map((k) => [k.value, k])) as Record<NoteKind, (typeof NOTE_KINDS)[number]>;

interface PlayerPayload {
  player: Player;
  notes: PlayerNote[];
  attendance: { present: number; total: number; history: { id: string; date: string; title: string; present: boolean }[] };
  parents: { id: string; name: string; email: string }[];
}

export function PlayerPage() {
  const { id } = useParams();
  const { me, can, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useAsync(() => api.get<PlayerPayload>(`/players/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [filter, setFilter] = useState<NoteKind | null>(null);

  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Joueur introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/joueurs">Retour</Link>} />
      </div>
    );

  const { player: p, notes, attendance, parents } = q.data;
  const team = me.teams.find((t) => t.id === p.teamId);
  const canNotes = isStaff && can('notes.write');
  const rate = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : null;
  const shown = filter ? notes.filter((n) => n.kind === filter) : notes;

  const removePlayer = async () => {
    if (!(await confirm({ title: `Retirer ${p.firstName} de l’effectif ?`, text: 'Sa page et toutes les remarques seront supprimées.', confirm: 'Retirer', danger: true }))) return;
    await api.del(`/players/${p.id}`);
    toast('Joueur retiré');
    nav('/joueurs', { replace: true });
  };

  return (
    <div className="page">
      <Link to={isStaff ? '/joueurs' : '/'} className="back">
        <ArrowLeft size={15} /> {isStaff ? 'Joueurs' : 'Accueil'}
      </Link>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={playerName(p)} size="lg" />
          <div>
            <h1>{playerName(p)}</h1>
            <div className="sub row wrap" style={{ gap: 8 }}>
              {team && <span>{team.category}</span>}
              {p.birthYear && <span>· né(e) en {p.birthYear}</span>}
              {p.number !== undefined && <span>· n° {p.number}</span>}
              {p.foot && <span>· {p.foot === 'deux' ? 'deux pieds' : `pied ${p.foot}`}</span>}
              {p.position && <span>· {p.position}</span>}
              {isStaff && <LevelDots level={p.level} />}
            </div>
          </div>
        </div>
        {isStaff && can('players.manage') && (
          <div className="actions">
            <button className="btn" onClick={() => setEdit(true)}>
              <Pencil /> Modifier
            </button>
            <button className="btn icon ghost danger" onClick={removePlayer} aria-label="Retirer le joueur">
              <Trash2 />
            </button>
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="v">{rate === null ? '—' : `${rate} %`}</div>
          <div className="l">
            Présence · {attendance.present}/{attendance.total} séances
          </div>
          {attendance.history.length > 0 && (
            <div className="att-strip" style={{ marginTop: 10 }}>
              {[...attendance.history].reverse().map((h) => (
                <i key={h.id} className={h.present ? 'on' : ''} title={`${formatDate(h.date, false)} · ${h.title} · ${h.present ? 'présent' : 'absent'}`} />
              ))}
            </div>
          )}
        </div>
        <div className="card stat">
          <div className="v">{notes.length}</div>
          <div className="l">{isStaff ? 'Remarques des éducateurs' : 'Messages des éducateurs'}</div>
        </div>
      </div>

      {isStaff && !can('notes.view') ? (
        <div className="card">
          <Empty icon={<Lock />} title="Pages joueurs réservées" text="Votre rôle ne permet pas de consulter les remarques." />
        </div>
      ) : (
        <>
          {isStaff && (
            <div className="grid cols-3" style={{ marginBottom: 20 }}>
              {NOTE_KINDS.slice(0, 3).map((k) => {
                const items = notes.filter((n) => n.kind === k.value).slice(0, 3);
                return (
                  <div key={k.value} className={`card pad note-${k.value}`} style={{ padding: 16 }}>
                    <div className="row" style={{ marginBottom: 8, gap: 8 }}>
                      <span className="ic" style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center' }}>
                        {k.icon}
                      </span>
                      <b className="small">{k.plural}</b>
                    </div>
                    {items.length ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
                        {items.map((n) => (
                          <li key={n.id} style={{ marginBottom: 4 }}>
                            {n.text.length > 110 ? `${n.text.slice(0, 110)}…` : n.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small muted">Rien pour l’instant.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h3>{isStaff ? 'Journal' : 'Les messages des éducateurs'}</h3>
              {isStaff && (
                <div className="chips">
                  <button className={`chip${!filter ? ' on' : ''}`} onClick={() => setFilter(null)}>
                    Tout
                  </button>
                  {NOTE_KINDS.map((k) => (
                    <button key={k.value} className={`chip${filter === k.value ? ' on' : ''} hide-mobile`} onClick={() => setFilter(filter === k.value ? null : k.value)}>
                      {k.plural}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canNotes && <Composer playerId={p.id} onSaved={q.reload} />}
            <div className="list" style={{ borderTop: canNotes ? '1px solid var(--line)' : undefined, marginTop: canNotes ? 0 : 10 }}>
              {shown.map((n) => (
                <NoteRow key={n.id} note={n} editable={isStaff && (n.authorId === me.user.id || me.user.role === 'admin')} onChanged={q.reload} />
              ))}
              {!shown.length && (
                <div className="empty" style={{ padding: 28 }}>
                  {isStaff ? 'Aucune remarque. Notez librement ce que vous observez : forces, axes de progrès, objectifs…' : 'Pas encore de message.'}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {isStaff && parents.length > 0 && (
        <>
          <div className="section-title">Parents</div>
          <div className="card list">
            {parents.map((u) => (
              <div key={u.id} className="list-item" style={{ cursor: 'default' }}>
                <Avatar name={u.name} size="sm" />
                <div className="t">
                  <b>{u.name}</b>
                  <small>{u.email}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {edit && <PlayerForm player={p} teamId={p.teamId} onClose={() => setEdit(false)} onSaved={() => q.reload()} />}
    </div>
  );
}

function Composer({ playerId, onSaved, note, onCancel }: { playerId: string; onSaved: () => void; note?: PlayerNote; onCancel?: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<NoteKind>(note?.kind ?? 'remarque');
  const [text, setText] = useState(note?.text ?? '');
  const [visibility, setVisibility] = useState<'staff' | 'parents'>(note?.visibility ?? 'staff');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.put(`/notes/${note?.id ?? uid()}`, { playerId, kind, text, visibility });
      if (!note) setText('');
      onSaved();
      onCancel?.();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer">
      <div className="chips">
        {NOTE_KINDS.map((k) => (
          <button key={k.value} className={`chip${kind === k.value ? ' on' : ''}`} onClick={() => setKind(k.value)}>
            {k.icon} {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        placeholder="Une force, un axe de progrès, un objectif, une anecdote…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && save()}
      />
      <div className="row between wrap">
        <button className="btn sm ghost" onClick={() => setVisibility(visibility === 'staff' ? 'parents' : 'staff')} title="Qui peut lire cette remarque ?">
          {visibility === 'staff' ? <EyeOff /> : <Eye />}
          {visibility === 'staff' ? 'Éducateurs uniquement' : 'Partagée avec les parents'}
        </button>
        <div className="row" style={{ gap: 6 }}>
          {onCancel && (
            <button className="btn sm ghost" onClick={onCancel}>
              Annuler
            </button>
          )}
          <button className="btn sm primary" disabled={!text.trim() || busy} onClick={save}>
            {note ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteRow({ note: n, editable, onChanged }: { note: PlayerNote; editable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  if (editing) return <Composer playerId={n.playerId} note={n} onSaved={onChanged} onCancel={() => setEditing(false)} />;
  const k = KIND[n.kind];
  return (
    <div className={`note note-${n.kind}`}>
      <span className="ic">{k.icon}</span>
      <div className="grow">
        <div className="txt">{n.text}</div>
        <div className="by">
          <span>
            {k.label} · {n.authorName ?? 'Éducateur'} · {relative(n.createdAt)}
          </span>
          {n.visibility === 'parents' && (
            <span className="badge blue">
              <Eye /> Parents
            </span>
          )}
          {n.trainingId && <span className="badge">Pendant la séance</span>}
        </div>
      </div>
      {editable && (
        <div className="row" style={{ gap: 0, alignSelf: 'flex-start' }}>
          <button className="btn icon sm ghost" onClick={() => setEditing(true)} aria-label="Modifier">
            <Pencil />
          </button>
          <button
            className="btn icon sm ghost danger"
            onClick={async () => {
              if (await confirm({ title: 'Supprimer cette remarque ?', confirm: 'Supprimer', danger: true })) {
                await api.del(`/notes/${n.id}`);
                onChanged();
              }
            }}
            aria-label="Supprimer"
          >
            <Trash2 />
          </button>
        </div>
      )}
    </div>
  );
}
