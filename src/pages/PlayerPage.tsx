import { ArrowLeft, CalendarCheck, CalendarX, Check, Eye, EyeOff, Mail, MapPin, MessageSquare, Pencil, Phone, ShieldCheck, Trash2, UserX, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Avatar, Empty, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { MONTHS_LONG, fromYMD } from '../lib/events';
import { formatDate, playerName, relative, useApp } from '../lib/store';
import type { Observation, Player, PlayerMatch } from '../lib/types';
import { PlayerForm } from './Players';
import { playerGroup } from '../lib/groups';

interface Parent { id: string; name: string; email: string; phone?: string }

interface PlayerPayload {
  player: Player;
  observations: Observation[];
  attendance: { present: number; total: number; history: { id: string; date: string; title: string; present: boolean }[] };
  matches: PlayerMatch[];
  parents: Parent[];
}

export function PlayerPage() {
  const { id } = useParams();
  const { me, can, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useAsync(() => api.get<PlayerPayload>(`/players/${id}`), [id]);
  const [edit, setEdit] = useState(false);

  if (q.loading && !q.data) return <Spinner fill />;
  if (q.error || !q.data)
    return (
      <div className="page">
        <Empty title="Joueur introuvable" text={q.error ?? undefined} action={<Link className="btn" to="/joueurs">Retour</Link>} />
      </div>
    );

  const data = q.data;
  const { player: p, attendance, matches } = data;
  const team = me.teams.find((t) => t.id === p.teamId);
  const coach = isStaff && can('notes.view');
  const rate = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : null;
  const playedList = matches.filter((m) => m.status === 'played');
  const minutes = playedList.reduce((a, m) => a + (m.minutes ?? 0), 0);
  const convocable = matches.filter((m) => m.status !== 'upcoming').length;
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;

  const removePlayer = async () => {
    if (!(await confirm({ title: `Retirer ${p.firstName} de l’effectif ?`, text: 'Sa fiche et son suivi seront supprimés.', confirm: 'Retirer', danger: true }))) return;
    await api.del(`/players/${p.id}`);
    toast('Joueur retiré');
    nav('/joueurs', { replace: true });
  };

  return (
    <div className="page">
      <Link to={isStaff ? '/joueurs' : '/'} className="back">
        <ArrowLeft size={15} /> {isStaff ? 'Joueurs' : 'Accueil'}
      </Link>
      <div className="pp-head">
        <div className="pp-avatar">
          <PlayerAvatar player={p} editable={!isStaff || can('players.manage')} onChange={(np) => q.setData({ ...data, player: { ...p, ...np } })} />
        </div>
        <div className="grow">
          <div className="pp-name">
            <h1>{playerName(p)}</h1>
            {team && <span className="badge">{playerGroup(p, team) ?? team.category}</span>}
          </div>
          {age !== null && (
            <div className="pp-sub">
              {age} ans · {p.birthYear}
            </div>
          )}
        </div>
        {isStaff && can('players.manage') && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn pp-edit" onClick={() => setEdit(true)}>
              <Pencil /> <span className="hide-mobile">Modifier</span>
            </button>
            <button className="btn icon ghost danger" onClick={removePlayer} aria-label="Retirer le joueur">
              <Trash2 />
            </button>
          </div>
        )}
      </div>

      <div className="pp-stats two">
        <div>
          <b>{rate === null ? '—' : `${rate} %`}</b>
          <span>présence · {attendance.present}/{attendance.total}</span>
          {attendance.history.length > 0 && (
            <div className="att-strip">
              {[...attendance.history].reverse().slice(-20).map((h) => (
                <i key={h.id} className={h.present ? 'on' : ''} title={`${formatDate(h.date, false)} · ${h.present ? 'présent' : 'absent'}`} />
              ))}
            </div>
          )}
        </div>
        <div>
          <b>
            {playedList.length}
            <small>/{convocable}</small>
          </b>
          <span>matchs joués · {minutes} min</span>
        </div>
      </div>

      <LicenceCard p={p} parents={data.parents} />

      <TimelineTab data={data} canEdit={isStaff && can('notes.write')} coach={coach} meId={me.user.id} isAdmin={me.user.role === 'admin'} reload={q.reload} />

      {edit && <PlayerForm player={p} teamId={p.teamId} onClose={() => setEdit(false)} onSaved={() => q.reload()} />}
    </div>
  );
}

/* ------------------------------------------------------------------ licence et parents */

const LICENCE = {
  ok: { label: 'Licence validée', tone: 'green' },
  pending: { label: 'Licence en cours', tone: 'warn' },
  missing: { label: 'Licence à faire', tone: 'red' },
} as const;

/** Icône qui révèle une information au survol (et l'ouvre au clic : appel, e-mail). */
function HoverInfo({ icon, label, href }: { icon: ReactNode; label: string; href?: string }) {
  const inner = (
    <>
      {icon}
      <span className="hover-tip" role="tooltip">
        {label}
      </span>
    </>
  );
  return href ? (
    <a className="hover-info" href={href} aria-label={label}>
      {inner}
    </a>
  ) : (
    <span className="hover-info" tabIndex={0} aria-label={label}>
      {inner}
    </span>
  );
}

function LicenceCard({ p, parents }: { p: Player; parents: Parent[] }) {
  const lic = p.info?.licence ?? { number: '', status: 'missing' as const };
  const city = p.info?.city?.trim() ?? '';
  // Parents inscrits, puis les contacts de la fiche qui n'ont pas de compte.
  const people = [
    ...parents.map((u) => ({ key: u.id, name: u.name, phone: u.phone ?? '', email: u.email })),
    ...(p.info?.contacts ?? [])
      .filter((c) => !parents.some((u) => (u.phone && u.phone === c.phone) || u.name.toLowerCase() === c.name.toLowerCase()))
      .map((c, i) => ({ key: `c${i}`, name: c.name || c.relation || 'Contact', phone: c.phone, email: '' })),
  ];
  const tel = (v: string) => `tel:${v.replace(/\s/g, '')}`;
  return (
    <section className="card pad lic-card">
      <div className="lic-head">
        <span className="admin-ic">
          <ShieldCheck />
        </span>
        <div className="grow">
          <b>Licence {new Date().getMonth() >= 6 ? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}` : `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`}</b>
          <small className="mono">{lic.number || 'N° non renseigné'}</small>
        </div>
        <span className={`badge ${LICENCE[lic.status].tone}`}>{LICENCE[lic.status].label}</span>
      </div>
      {people.length > 0 ? (
        <div className="lic-parents">
          {people.map((x) => (
            <div key={x.key} className="lic-parent">
              <Avatar name={x.name} size="sm" />
              <b className="grow ellipsis">{x.name}</b>
              {x.phone && <HoverInfo icon={<Phone size={16} />} label={x.phone} href={tel(x.phone)} />}
              {x.phone && <HoverInfo icon={<MessageSquare size={16} />} label={`SMS · ${x.phone}`} href={`sms:${x.phone.replace(/\s/g, '')}`} />}
              {x.email && <HoverInfo icon={<Mail size={16} />} label={x.email} href={`mailto:${x.email}`} />}
              {city && <HoverInfo icon={<MapPin size={16} />} label={city} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">Aucun parent rattaché pour l’instant.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ suivi (chronologie) */

interface Item { at: number; node: ReactNode; key: string }

function TimelineTab({ data, canEdit, coach, meId, isAdmin, reload }: { data: PlayerPayload; canEdit: boolean; coach: boolean; meId: string; isAdmin: boolean; reload: () => void }) {
  const confirm = useConfirm();
  const p = data.player;

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const o of data.observations) {
      out.push({
        at: o.createdAt, key: `o${o.id}`,
        node: (
          <>
            <span className="tl-ic note">
              <MessageSquare />
            </span>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>
                <b>{coach ? 'Remarque' : 'Message de l’éducateur'}</b>
                {o.visibility === 'parents' && coach && (
                  <span className="badge blue">
                    <Eye /> Parents
                  </span>
                )}
                {o.trainingId && coach && <span className="badge">Pendant la séance</span>}
              </div>
              {o.text && <p className="tl-text">{o.text}</p>}
              <small>
                {o.authorName ?? 'Éducateur'} · {relative(o.createdAt)}
              </small>
            </div>
            {canEdit && (o.authorId === meId || isAdmin) && (
              <button
                className="btn icon sm ghost"
                aria-label="Supprimer"
                onClick={async () => {
                  if (await confirm({ title: 'Supprimer cette remarque ?', confirm: 'Supprimer', danger: true })) {
                    await api.del(`/observations/${o.id}`);
                    reload();
                  }
                }}
              >
                <Trash2 />
              </button>
            )}
          </>
        ),
      });
    }
    for (const m of data.matches) {
      const at = fromYMD(m.date).getTime();
      const label = {
        played: `A joué ${m.minutes ?? 0} min${m.starter ? ' (titulaire)' : ''}${m.goals ? ` · ⚽ ${m.goals}` : ''}`,
        noShow: 'Convoqué mais absent',
        notSelected: 'Non convoqué',
        unavailable: 'Indisponible',
        upcoming: 'Convoqué',
      }[m.status];
      out.push({
        at, key: `m${m.eventId}${m.date}`,
        node: (
          <Link to={`/matchs/${m.eventId}/${m.date}`} className="tl-link">
            <span className={`tl-ic match-${m.status}`}>{m.status === 'played' || m.status === 'upcoming' ? <Check /> : m.status === 'noShow' ? <UserX /> : <X />}</span>
            <div className="grow">
              <b>
                {m.title}
                {m.score ? ` · ${m.score.us}–${m.score.them}` : ''}
              </b>
              <small>
                {label} · {formatDate(m.date, false)}
              </small>
              {m.award && (
                <span className="tl-award">
                  {m.award.emoji} {m.award.label}
                </span>
              )}
            </div>
          </Link>
        ),
      });
    }
    for (const h of data.attendance.history) {
      out.push({
        at: new Date(h.date.length > 10 ? h.date : `${h.date}T18:00`).getTime(), key: `t${h.id}`,
        node: (
          <>
            <span className={`tl-ic ${h.present ? 'present' : 'absent'}`}>{h.present ? <CalendarCheck /> : <CalendarX />}</span>
            <div className="grow">
              <b>
                {h.title} · {h.present ? 'présent' : 'absent'}
              </b>
              <small>{formatDate(h.date, false)}</small>
            </div>
          </>
        ),
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [data, coach, canEdit, meId, isAdmin, confirm, reload]);

  // Séparateurs de mois.
  const groups: { label: string; items: Item[] }[] = [];
  for (const it of items) {
    const d = new Date(it.at);
    const label = `${MONTHS_LONG[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}`;
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(it);
  }

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div className="sec-head">
        <h2>Suivi</h2>
      </div>
      {canEdit && <ObservationComposer player={p} onSaved={reload} />}
      {groups.length ? (
        groups.map((g) => (
          <div key={g.label}>
            <div className="section-title" style={{ margin: '6px 0 8px' }}>
              {g.label}
            </div>
            <div className="card tl">
              {g.items.map((it) => (
                <div key={it.key} className="tl-item">
                  {it.node}
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="card">
          <Empty title="Rien pour l’instant" text={canEdit ? 'Notez une remarque : le comportement, l’attitude, une anecdote.' : undefined} />
        </div>
      )}
    </section>
  );
}

export function ObservationComposer({ player, onSaved, trainingId, compact }: { player: Pick<Player, 'id' | 'firstName'>; onSaved: () => void; trainingId?: string; compact?: boolean }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.put(`/observations/${uid()}`, { playerId: player.id, trend: 'flat', text, visibility: shared ? 'parents' : 'staff', trainingId });
      setText('');
      toast('Remarque ajoutée');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`obs-composer${compact ? '' : ' card'}`}>
      <textarea
        className="textarea"
        rows={compact ? 3 : 2}
        placeholder={`Une remarque sur ${player.firstName} : comportement, attitude…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && save()}
      />
      <div className="row between wrap" style={{ gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setShared(!shared)}>
          {shared ? <Eye /> : <EyeOff />} {shared ? 'Partagée avec les parents' : 'Éducateurs uniquement'}
        </button>
        <button className="btn sm primary" disabled={busy || !text.trim()} onClick={save}>
          Ajouter
        </button>
      </div>
    </div>
  );
}
