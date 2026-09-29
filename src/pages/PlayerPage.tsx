import {
  ArrowLeft, Ban, CalendarCheck, CalendarX, Check, ChevronDown, Eye, EyeOff, Flag, Lock, MoreHorizontal, Pencil,
  Plus, Target, Trash2, TrendingDown, TrendingUp, Trophy, UserX, X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BulletinsTab, InfoPanel, PlayerAlerts, TestsPanel } from '../components/PlayerExtras';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { FootPicker, PositionPitch, ProgressSteps, Radar, Rating, Sparkline } from '../components/PlayerProfile';
import { Empty, Field, Menu, Seg, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { countdown } from '../lib/convocations';
import { MONTHS_LONG, fromYMD } from '../lib/events';
import { DOMAIN, DOMAINS, FOOT_LABEL, GOAL_IDEAS, POSITION, SKILL, TEST, TRENDS } from '../lib/profile';
import { formatDate, playerName, relative, useApp } from '../lib/store';
import type { DomainKey, Objective, Observation, Player, PlayerMatch, Trend } from '../lib/types';
import { PlayerForm } from './Players';
import { playerGroup } from '../lib/groups';

interface PlayerPayload {
  player: Player;
  observations: Observation[];
  objectives: Objective[];
  attendance: { present: number; total: number; history: { id: string; date: string; title: string; present: boolean }[] };
  matches: PlayerMatch[];
  parents: { id: string; name: string; email: string }[];
}

type Tab = 'profil' | 'objectifs' | 'suivi' | 'bulletins' | 'infos';

export function PlayerPage() {
  const { id } = useParams();
  const { me, can, isStaff } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
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
  const { player: p, attendance, matches, objectives } = data;
  const team = me.teams.find((t) => t.id === p.teamId);
  const coach = isStaff && can('notes.view');
  const tabs: { value: Tab; label: string }[] = coach
    ? [
        { value: 'profil', label: 'Profil' },
        { value: 'objectifs', label: 'Objectifs' },
        { value: 'suivi', label: 'Suivi' },
        { value: 'bulletins', label: 'Bulletins' },
        { value: 'infos', label: 'Infos' },
      ]
    : isStaff
      ? [{ value: 'suivi', label: 'Suivi' }, { value: 'infos', label: 'Infos' }]
      : [
          { value: 'suivi', label: 'Suivi' },
          { value: 'bulletins', label: 'Bulletins' },
          { value: 'objectifs', label: 'Objectifs' },
          { value: 'infos', label: 'Infos' },
        ];
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0].value;
  const rate = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : null;
  const playedList = matches.filter((m) => m.status === 'played');
  const minutes = playedList.reduce((a, m) => a + (m.minutes ?? 0), 0);
  const convocable = matches.filter((m) => m.status !== 'upcoming').length;
  const active = objectives.filter((o) => o.status === 'active').length;
  const done = objectives.filter((o) => o.status === 'done').length;
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const positions = p.profile?.positions ?? [];

  const removePlayer = async () => {
    if (!(await confirm({ title: `Retirer ${p.firstName} de l’effectif ?`, text: 'Sa fiche, ses évaluations, objectifs et observations seront supprimés.', confirm: 'Retirer', danger: true }))) return;
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
          <h1>{playerName(p)}</h1>
          <div className="pp-tags">
            {team && <span className="badge">{playerGroup(p, team) ?? team.category}</span>}
            {age !== null && <span className="badge">{age} ans · {p.birthYear}</span>}
            {positions[0] && <span className="badge green">{POSITION[positions[0]]?.label}</span>}
            {p.profile?.foot && <span className="badge">{FOOT_LABEL[p.profile.foot]}</span>}
          </div>
        </div>
        {isStaff && can('players.manage') && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => setEdit(true)}>
              <Pencil /> <span className="hide-mobile">Identité</span>
            </button>
            <button className="btn icon ghost danger" onClick={removePlayer} aria-label="Retirer le joueur">
              <Trash2 />
            </button>
          </div>
        )}
      </div>

      <div className="pp-stats">
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
        <div>
          <b>
            {done}
            <small> atteint{done > 1 ? 's' : ''}</small>
          </b>
          <span>{active} objectif{active > 1 ? 's' : ''} en cours</span>
        </div>
        {coach && (
          <div>
            <b>{p.followUp?.lastObservation ? relative(p.followUp.lastObservation).replace('il y a ', '') : '—'}</b>
            <span>depuis la dernière observation</span>
          </div>
        )}
      </div>

      {coach && <PlayerAlerts p={p} onObserve={() => setParams({ tab: 'suivi' }, { replace: true })} />}

      <div style={{ margin: '4px 0 22px' }}>
        <Seg value={tab} onChange={(v) => setParams(v === tabs[0].value ? {} : { tab: v }, { replace: true })} options={tabs} />
      </div>

      {tab === 'profil' && coach && <ProfileTab p={p} canEdit={can('notes.write')} onSaved={(np) => q.setData({ ...data, player: { ...p, ...np } })} />}
      {tab === 'objectifs' && <GoalsTab data={data} canEdit={isStaff && can('notes.write')} reload={q.reload} />}
      {tab === 'suivi' && <TimelineTab data={data} canEdit={isStaff && can('notes.write')} coach={coach} meId={me.user.id} isAdmin={me.user.role === 'admin'} reload={q.reload} />}
      {tab === 'bulletins' && <BulletinsTab p={p} canEdit={isStaff && can('notes.write')} />}
      {tab === 'infos' && (
        <InfoPanel p={p} canEdit={!isStaff || can('players.manage')} parents={data.parents} isStaff={isStaff} onSaved={(np) => q.setData({ ...data, player: { ...p, ...np } })} />
      )}

      {isStaff && !coach && tab === 'profil' && (
        <div className="card">
          <Empty icon={<Lock />} title="Fiches réservées" text="Votre rôle ne permet pas de consulter les évaluations." />
        </div>
      )}

      {edit && <PlayerForm player={p} teamId={p.teamId} onClose={() => setEdit(false)} onSaved={() => q.reload()} />}
    </div>
  );
}

/* ------------------------------------------------------------------ profil (évaluations) */

function ProfileTab({ p, canEdit, onSaved }: { p: Player; canEdit: boolean; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const [prof, setProf] = useState(p.profile ?? {});
  const ratings = prof.ratings ?? {};
  // Chaque domaine s'ouvre et se ferme indépendamment ; au départ, ceux qui ne sont pas encore évalués sont ouverts.
  const [open, setOpen] = useState<Set<DomainKey>>(() => new Set(DOMAINS.filter((d) => !p.profile?.domains?.[d.key]).map((d) => d.key)));
  const toggle = (k: DomainKey) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const history = prof.history ?? [];

  const save = async (patch: Record<string, unknown>) => {
    try {
      const out = await api.put<Player>(`/players/${p.id}/profile`, patch);
      setProf(out.profile ?? {});
      onSaved(out);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const rate = (skill: string, v: number) => {
    setProf({ ...prof, ratings: { ...ratings, [skill]: v } });
    void save({ ratings: { [skill]: v } });
  };

  const domains = prof.domains ?? {};
  const first = history.find((h) => Object.keys(h.d).length);
  const last = history.at(-1);
  const compare = first && last && first.at !== last.at ? first.d : null;
  const rated = Object.keys(ratings).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="pp-top">
        <div className="card pad radar-card">
          <div className="row between" style={{ marginBottom: 4 }}>
            <h3>Profil</h3>
            {compare && (
              <span className="radar-legend">
                <i className="now" /> maintenant <i className="before" /> {formatDate(first!.at, false)}
              </span>
            )}
          </div>
          {rated ? (
            <Radar values={domains} compare={compare} size={300} />
          ) : (
            <div className="radar-empty">
              <Radar values={{}} size={300} />
              <p className="small muted">Évaluez les compétences ci-dessous : le radar se dessine au fur et à mesure.</p>
            </div>
          )}
        </div>
        <div className="card pad stack" style={{ gap: 18 }}>
          <div>
            <h3 style={{ marginBottom: 10 }}>Postes</h3>
            <PositionPitch value={prof.positions ?? []} readOnly={!canEdit} onChange={(positions) => (setProf({ ...prof, positions }), void save({ positions }))} />
            <p className="small muted" style={{ marginTop: 6 }}>
              {prof.positions?.length ? prof.positions.map((k) => POSITION[k]?.label).join(' · ') : 'Touchez les postes où il joue. Le premier est son poste principal.'}
            </p>
          </div>
          <div>
            <h3 style={{ marginBottom: 10 }}>Pied fort</h3>
            <FootPicker foot={prof.foot ?? ''} readOnly={!canEdit} onChange={(foot) => (setProf({ ...prof, foot }), void save({ foot }))} />
            {prof.foot && prof.foot !== 'deux' && (
              <div className="row between" style={{ marginTop: 12 }}>
                <span className="small">Pied faible</span>
                <Rating domain={DOMAIN.tech} value={prof.weakFoot ?? 0} readOnly={!canEdit} size={20} onChange={(weakFoot) => (setProf({ ...prof, weakFoot }), void save({ weakFoot }))} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="domain-list">
        {DOMAINS.map((d) => {
          const Icon = d.icon;
          const avg = domains[d.key];
          const series = history.map((h) => h.d[d.key]).filter((v): v is number => typeof v === 'number');
          const isOpen = open.has(d.key);
          return (
            <div key={d.key} className={`card domain${isOpen ? ' open' : ''}`} style={{ '--c': d.color } as React.CSSProperties}>
              <button className="domain-head" onClick={() => toggle(d.key)} aria-expanded={isOpen}>
                <span className="domain-ic">
                  <Icon size={20} filled />
                </span>
                <b className="grow">{d.label}</b>
                <Sparkline values={series} color={d.color} />
                <span className="domain-avg">{avg ? avg.toFixed(1).replace('.', ',') : '—'}</span>
                <ChevronDown size={18} className="chev" />
              </button>
              {isOpen && (
                <div className="skills">
                  {d.skills.map((s) => (
                    <div key={s.key} className="skill">
                      <div className="grow">
                        <b>{s.label}</b>
                        <small>{s.hint}</small>
                      </div>
                      <Rating domain={d} value={ratings[s.key] ?? 0} readOnly={!canEdit} onChange={(v) => rate(s.key, v)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <TestsPanel p={{ ...p, profile: { ...p.profile, ...prof } }} canEdit={canEdit} onSaved={(np) => (setProf(np.profile ?? {}), onSaved(np))} />
      <p className="small muted" style={{ textAlign: 'center' }}>
        <Lock size={12} /> Les évaluations restent entre éducateurs. Elles servent aussi à équilibrer les groupes en séance.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ objectifs */

function dueChip(due: string | null) {
  if (!due) return null;
  const ts = fromYMD(due).getTime();
  const late = ts < Date.now() - 864e5 / 2;
  return <span className={`badge ${late ? 'red' : ts - Date.now() < 7 * 864e5 ? 'warn' : ''}`}>{late ? `Échéance dépassée` : `Échéance ${countdown(ts)}`}</span>;
}

function GoalsTab({ data, canEdit, reload }: { data: PlayerPayload; canEdit: boolean; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Objective> | null>(null);
  const [checkin, setCheckin] = useState<Objective | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const goals = data.objectives;
  const active = goals.filter((g) => g.status === 'active');
  const closed = goals.filter((g) => g.status !== 'active');

  const put = async (g: Objective, patch: Partial<Objective>) => {
    try {
      await api.put(`/objectives/${g.id}`, { ...g, ...patch });
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {canEdit && (
        <button className="goal-new" onClick={() => setEdit({ playerId: data.player.id, visibility: 'staff' })}>
          <Plus /> Fixer un objectif à {data.player.firstName}
        </button>
      )}
      {active.length ? (
        <div className="goal-grid">
          {active.map((g) => {
            const d = g.domain ? DOMAIN[g.domain] : null;
            const Icon = d?.icon;
            const lastCheck = g.checkins.at(-1);
            return (
              <div key={g.id} className="card goal" style={{ '--c': d?.color ?? 'var(--accent)' } as React.CSSProperties}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span className="goal-ic">{Icon ? <Icon size={18} filled /> : <Target size={18} />}</span>
                  <div className="grow">
                    <b>{g.title}</b>
                    <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                      {g.skill && <span className="badge">{SKILL[g.skill]?.label}</span>}
                      {dueChip(g.due)}
                      {g.visibility === 'parents' && (
                        <span className="badge blue">
                          <Eye /> Parents
                        </span>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <Menu
                      trigger={(open) => (
                        <button className="btn icon sm ghost" onClick={open} aria-label="Actions">
                          <MoreHorizontal />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <button onClick={() => (close(), setEdit(g))}>
                            <Pencil /> Modifier
                          </button>
                          <button onClick={() => (close(), put(g, { visibility: g.visibility === 'parents' ? 'staff' : 'parents' }))}>
                            {g.visibility === 'parents' ? <EyeOff /> : <Eye />} {g.visibility === 'parents' ? 'Ne plus partager' : 'Partager avec les parents'}
                          </button>
                          <button onClick={() => (close(), put(g, { status: 'done' }))}>
                            <Trophy /> Marquer atteint
                          </button>
                          <button onClick={() => (close(), put(g, { status: 'dropped' }))}>
                            <Ban /> Abandonner
                          </button>
                          <button
                            onClick={async () => {
                              close();
                              if (await confirm({ title: 'Supprimer cet objectif ?', confirm: 'Supprimer', danger: true })) {
                                await api.del(`/objectives/${g.id}`);
                                reload();
                              }
                            }}
                          >
                            <Trash2 /> Supprimer
                          </button>
                        </>
                      )}
                    </Menu>
                  )}
                </div>
                <ProgressSteps value={g.progress} color={d?.color} onChange={canEdit ? (progress) => setCheckin({ ...g, progress }) : undefined} />
                {lastCheck?.note && (
                  <p className="goal-last">
                    « {lastCheck.note} » <small>· {lastCheck.by}, {relative(lastCheck.at)}</small>
                  </p>
                )}
                {canEdit && (
                  <button className="btn sm" onClick={() => setCheckin(g)}>
                    <Flag /> Point d’étape
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Target />} title="Aucun objectif en cours" text={canEdit ? 'Un objectif concret, une échéance, des points d’étape : c’est ce qui fait progresser.' : 'Les éducateurs n’ont pas encore partagé d’objectif.'} />
        </div>
      )}
      {closed.length > 0 && (
        <>
          <div className="section-title">Terminés</div>
          <div className="card list">
            {closed.map((g) => (
              <div key={g.id} className="list-item" style={{ cursor: 'default' }}>
                {g.status === 'done' ? <Trophy color="var(--accent)" /> : <Ban />}
                <div className="t">
                  <b>{g.title}</b>
                  <small>
                    {g.status === 'done' ? `Atteint ${g.doneAt ? relative(g.doneAt) : ''}` : 'Abandonné'}
                    {g.checkins.length ? ` · ${g.checkins.length} point${g.checkins.length > 1 ? 's' : ''} d’étape` : ''}
                  </small>
                </div>
                {canEdit && (
                  <button className="btn sm ghost" onClick={() => put(g, { status: 'active', progress: g.status === 'done' ? 75 : g.progress })}>
                    Rouvrir
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {edit && <GoalSheet goal={edit} player={data.player} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), reload())} />}
      {checkin && <CheckinSheet goal={checkin} onClose={() => setCheckin(null)} onSaved={() => (setCheckin(null), reload())} />}
    </div>
  );
}

function addDaysYMD(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function GoalSheet({ goal, player, onClose, onSaved }: { goal: Partial<Objective>; player: Player; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [g, setG] = useState<Partial<Objective>>({ domain: '', skill: '', due: addDaysYMD(42), progress: 0, visibility: 'staff', ...goal });
  const [busy, setBusy] = useState(false);
  const domain = g.domain ? DOMAIN[g.domain] : null;
  // Suggestion : les compétences les plus faibles d'abord.
  const weakest = useMemo(
    () =>
      Object.entries(player.profile?.ratings ?? {})
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3)
        .map(([k]) => k)
        .filter((k) => SKILL[k]),
    [player.profile?.ratings],
  );
  const save = async () => {
    if (!g.title?.trim()) return;
    setBusy(true);
    try {
      await api.put(`/objectives/${g.id ?? uid()}`, { ...g, playerId: player.id, status: g.status ?? 'active' });
      toast(g.id ? 'Objectif modifié' : 'Objectif fixé');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const quick = [
    { label: '2 semaines', v: addDaysYMD(14) },
    { label: '1 mois', v: addDaysYMD(30) },
    { label: '6 semaines', v: addDaysYMD(42) },
    { label: 'Fin de saison', v: `${new Date().getMonth() >= 7 ? new Date().getFullYear() + 1 : new Date().getFullYear()}-06-15` },
  ];
  return (
    <Sheet
      title={g.id ? 'Modifier l’objectif' : `Objectif pour ${player.firstName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={!g.title?.trim() || busy} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Domaine">
          <div className="dom-pick">
            {DOMAINS.map((d) => {
              const Icon = d.icon;
              return (
                <button key={d.key} type="button" className={g.domain === d.key ? 'on' : ''} style={{ '--c': d.color } as React.CSSProperties} onClick={() => setG({ ...g, domain: d.key, skill: '' })}>
                  <Icon size={20} filled={g.domain === d.key} />
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
        </Field>
        {domain && (
          <Field label="Compétence">
            <div className="chips">
              {domain.skills.map((s) => (
                <button key={s.key} type="button" className={`chip${g.skill === s.key ? ' on' : ''}`} onClick={() => setG({ ...g, skill: s.key, title: g.title || GOAL_IDEAS[s.key]?.[0] || '' })}>
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {!domain && weakest.length > 0 && (
          <p className="small muted">
            Compétences les moins bien évaluées :{' '}
            {weakest.map((k, i) => (
              <button key={k} className="link-btn" onClick={() => setG({ ...g, domain: SKILL[k].domain.key, skill: k, title: GOAL_IDEAS[k]?.[0] ?? '' })}>
                {SKILL[k].label}
                {i < weakest.length - 1 ? ',' : ''}
              </button>
            ))}
          </p>
        )}
        <Field label="Objectif">
          <input className="input" autoFocus value={g.title ?? ''} placeholder="Concret et observable : « Faire une passe avant de tirer »" onChange={(e) => setG({ ...g, title: e.target.value })} />
        </Field>
        {g.skill && GOAL_IDEAS[g.skill]?.length > 1 && (
          <div className="chips">
            {GOAL_IDEAS[g.skill].map((t) => (
              <button key={t} type="button" className="chip" onClick={() => setG({ ...g, title: t })}>
                {t}
              </button>
            ))}
          </div>
        )}
        <Field label="Échéance">
          <div className="row wrap" style={{ gap: 6 }}>
            {quick.map((qk) => (
              <button key={qk.label} type="button" className={`chip${g.due === qk.v ? ' on' : ''}`} onClick={() => setG({ ...g, due: qk.v })}>
                {qk.label}
              </button>
            ))}
            <input className="input" type="date" style={{ width: 170 }} value={g.due ?? ''} onChange={(e) => setG({ ...g, due: e.target.value || null })} />
          </div>
        </Field>
        <button type="button" className={`share-toggle${g.visibility === 'parents' ? ' on' : ''}`} onClick={() => setG({ ...g, visibility: g.visibility === 'parents' ? 'staff' : 'parents' })}>
          {g.visibility === 'parents' ? <Eye /> : <EyeOff />}
          <span className="grow">
            <b>{g.visibility === 'parents' ? 'Partagé avec les parents' : 'Visible des éducateurs uniquement'}</b>
            <small>{g.visibility === 'parents' ? 'Les parents suivent la progression et peuvent encourager à la maison.' : 'Touchez pour partager avec la famille.'}</small>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

function CheckinSheet({ goal, onClose, onSaved }: { goal: Objective; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [progress, setProgress] = useState(goal.progress);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const d = goal.domain ? DOMAIN[goal.domain] : null;
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/objectives/${goal.id}/checkin`, { progress, note });
      toast(progress === 100 ? '🏆 Objectif atteint !' : 'Point d’étape enregistré');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Point d’étape"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={busy} onClick={save}>
          Enregistrer
        </button>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <b>{goal.title}</b>
        <ProgressSteps value={progress} onChange={setProgress} color={d?.color} />
        <textarea className="textarea" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ce que vous avez observé (facultatif)" />
        {goal.checkins.length > 0 && (
          <div className="checkins">
            {[...goal.checkins].reverse().slice(0, 5).map((c, i) => (
              <p key={i} className="small">
                <b>{c.progress} %</b> · {relative(c.at)} {c.note && `· ${c.note}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ suivi (chronologie) */

type Kind = 'all' | 'obs' | 'match' | 'goal' | 'presence';
interface Item { at: number; kind: Exclude<Kind, 'all'>; node: ReactNode; key: string }

function TimelineTab({ data, canEdit, coach, meId, isAdmin, reload }: { data: PlayerPayload; canEdit: boolean; coach: boolean; meId: string; isAdmin: boolean; reload: () => void }) {
  const [filter, setFilter] = useState<Kind>('all');
  const confirm = useConfirm();
  const p = data.player;

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const o of data.observations) {
      const t = TRENDS[o.trend];
      const skill = o.skill ? SKILL[o.skill] : null;
      out.push({
        at: o.createdAt, kind: 'obs', key: `o${o.id}`,
        node: (
          <>
            <span className={`tl-ic trend-${o.trend}`}>{o.trend === 'up' ? <TrendingUp /> : o.trend === 'down' ? <TrendingDown /> : <Eye />}</span>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>
                <b>{coach ? t.label : 'Message de l’éducateur'}</b>
                {skill && (
                  <span className="badge" style={{ color: skill.domain.color }}>
                    {skill.label}
                  </span>
                )}
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
                  if (await confirm({ title: 'Supprimer cette observation ?', confirm: 'Supprimer', danger: true })) {
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
    for (const g of data.objectives) {
      out.push({
        at: g.createdAt, kind: 'goal', key: `g${g.id}`,
        node: (
          <>
            <span className="tl-ic target">
              <Target />
            </span>
            <div className="grow">
              <b>Nouvel objectif : {g.title}</b>
              <small>{g.authorName ?? 'Éducateur'} · {relative(g.createdAt)}</small>
            </div>
          </>
        ),
      });
      for (const c of g.checkins) {
        out.push({
          at: c.at, kind: 'goal', key: `c${g.id}${c.at}`,
          node: (
            <>
              <span className="tl-ic target">
                <Flag />
              </span>
              <div className="grow">
                <b>
                  {g.title} · {c.progress} %
                </b>
                {c.note && <p className="tl-text">{c.note}</p>}
                <small>
                  {c.by} · {relative(c.at)}
                </small>
              </div>
            </>
          ),
        });
      }
      if (g.status === 'done' && g.doneAt) {
        out.push({
          at: g.doneAt, kind: 'goal', key: `d${g.id}`,
          node: (
            <>
              <span className="tl-ic win">
                <Trophy />
              </span>
              <div className="grow">
                <b>Objectif atteint : {g.title} 🎉</b>
                <small>{relative(g.doneAt)}</small>
              </div>
            </>
          ),
        });
      }
    }
    for (const m of data.matches) {
      const at = fromYMD(m.date).getTime();
      const label = {
        played: `A joué ${m.minutes ?? 0} min${m.starter ? ' (titulaire)' : ''}${m.goals ? ` · ⚽ ${m.goals}` : ''}`,
        noShow: 'Convoqué mais absent',
        notSelected: 'Non retenu',
        unavailable: 'Indisponible',
        upcoming: 'Convoqué',
      }[m.status];
      out.push({
        at, kind: 'match', key: `m${m.eventId}${m.date}`,
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
    if (coach) {
      for (const [key, list] of Object.entries(data.player.profile?.tests ?? {})) {
        const t = TEST[key];
        if (!t) continue;
        list.forEach((x, i) => {
          const prev = list[i - 1];
          const better = prev && (t.lower ? x.v < prev.v : x.v > prev.v);
          out.push({
            at: new Date(`${x.at}T17:00`).getTime(), kind: 'goal', key: `x${key}${i}`,
            node: (
              <>
                <span className="tl-ic test">{t.emoji}</span>
                <div className="grow">
                  <b>
                    {t.label} : {String(x.v).replace('.', ',')} {t.unit} {better ? '📈' : ''}
                  </b>
                  <small>Test mesuré · {formatDate(x.at, false)}</small>
                </div>
              </>
            ),
          });
        });
      }
      const hist = data.player.profile?.history ?? [];
      hist.forEach((h, i) => {
        if (!i) return;
        const prev = hist[i - 1].d;
        const ups = (Object.keys(h.d) as DomainKey[]).filter((k) => (h.d[k] ?? 0) - (prev[k] ?? 0) >= 0.2);
        if (!ups.length) return;
        out.push({
          at: new Date(`${h.at}T18:00`).getTime(), kind: 'obs', key: `r${h.at}`,
          node: (
            <>
              <span className="tl-ic trend-up">
                <TrendingUp />
              </span>
              <div className="grow">
                <b>Évaluation : {ups.map((k) => DOMAIN[k].label).join(', ')} en progrès</b>
                <small>
                  {ups.map((k) => `${DOMAIN[k].short} ${(prev[k] ?? 0).toFixed(1).replace('.', ',')} → ${(h.d[k] ?? 0).toFixed(1).replace('.', ',')}`).join(' · ')}
                </small>
              </div>
            </>
          ),
        });
      });
    }
    for (const h of data.attendance.history) {
      out.push({
        at: new Date(h.date.length > 10 ? h.date : `${h.date}T18:00`).getTime(), kind: 'presence', key: `t${h.id}`,
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

  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter);
  // Séparateurs de mois.
  const groups: { label: string; items: Item[] }[] = [];
  for (const it of shown) {
    const d = new Date(it.at);
    const label = `${MONTHS_LONG[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}`;
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(it);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {canEdit && <ObservationComposer player={p} onSaved={reload} />}
      <div className="chips">
        {(
          [
            ['all', 'Tout'],
            ['obs', coach ? 'Observations' : 'Messages'],
            ['match', 'Matchs'],
            ['goal', 'Objectifs'],
            ['presence', 'Présences'],
          ] as [Kind, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
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
          <Empty title="Rien pour l’instant" text={canEdit ? 'Notez ce que vous observez : un progrès, un point à travailler, une anecdote.' : undefined} />
        </div>
      )}
    </div>
  );
}

export function ObservationComposer({ player, onSaved, trainingId, compact }: { player: Pick<Player, 'id' | 'firstName'>; onSaved: () => void; trainingId?: string; compact?: boolean }) {
  const toast = useToast();
  const [trend, setTrend] = useState<Trend>('up');
  const [domain, setDomain] = useState<DomainKey | ''>('');
  const [skill, setSkill] = useState('');
  const [text, setText] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim() && !skill) return;
    setBusy(true);
    try {
      await api.put(`/observations/${uid()}`, { playerId: player.id, trend, skill, text, visibility: shared ? 'parents' : 'staff', trainingId });
      setText('');
      setSkill('');
      setDomain('');
      toast('Observation ajoutée');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const d = domain ? DOMAIN[domain] : null;
  return (
    <div className={`obs-composer${compact ? '' : ' card'}`}>
      <div className="trend-pick">
        {(['up', 'flat', 'down'] as Trend[]).map((t) => (
          <button key={t} type="button" className={`trend-${t}${trend === t ? ' on' : ''}`} onClick={() => setTrend(t)}>
            {t === 'up' ? <TrendingUp /> : t === 'down' ? <TrendingDown /> : <Eye />} {TRENDS[t].short}
          </button>
        ))}
      </div>
      <div className="dom-pick small">
        {DOMAINS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.key} type="button" className={domain === x.key ? 'on' : ''} style={{ '--c': x.color } as React.CSSProperties} onClick={() => (setDomain(domain === x.key ? '' : x.key), setSkill(''))} title={x.label}>
              <Icon size={17} filled={domain === x.key} />
              <span>{x.short}</span>
            </button>
          );
        })}
      </div>
      {d && (
        <div className="chips">
          {d.skills.map((s) => (
            <button key={s.key} type="button" className={`chip${skill === s.key ? ' on' : ''}`} onClick={() => setSkill(skill === s.key ? '' : s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="textarea"
        rows={compact ? 3 : 2}
        placeholder={`Ce que vous avez observé chez ${player.firstName}…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && save()}
      />
      <div className="row between wrap" style={{ gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setShared(!shared)}>
          {shared ? <Eye /> : <EyeOff />} {shared ? 'Partagée avec les parents' : 'Éducateurs uniquement'}
        </button>
        <button className="btn sm primary" disabled={busy || (!text.trim() && !skill)} onClick={save}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

