import { AlertCircle, FileWarning, Plus, Search, Target, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FutCard } from '../components/FutCard';
import { photoUrl } from '../components/PlayerAvatar';
import { Avatar, Empty, Field, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { groupsOf, guessGroup, playerGroup } from '../lib/groups';
import { playerName, useApp } from '../lib/store';
import type { DomainKey, Player, PlayerCard } from '../lib/types';

export function PlayerForm({ player, teamId, onClose, onSaved }: { player?: Player; teamId: string; onClose: () => void; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const { me } = useApp();
  const team = me.teams.find((t) => t.id === (player?.teamId ?? teamId));
  const groups = groupsOf(team?.category);
  const [f, setF] = useState<Partial<Player>>(player ?? {});
  // Catégorie choisie explicitement ; tant qu'elle ne l'est pas, on propose celle de l'année de naissance.
  const [picked, setPicked] = useState<string | null>(player && groups.includes(player.category ?? '') ? player.category! : null);
  const category = groups.length ? (picked ?? guessGroup(f.birthYear, team)) : null;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.firstName?.trim() || (groups.length && !category)) return;
    setBusy(true);
    try {
      const p = await api.put<Player>(`/players/${player?.id ?? uid()}`, { ...f, category: category ?? undefined, teamId: f.teamId ?? teamId });
      onSaved(p);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <Sheet
      title={player ? 'Modifier le joueur' : 'Nouveau joueur'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={!f.firstName?.trim() || (groups.length > 0 && !category) || busy} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <Field label="Prénom">
            <input className="input" autoFocus value={f.firstName ?? ''} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          </Field>
          <Field label="Nom">
            <input className="input" value={f.lastName ?? ''} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          <Field label="Année de naissance">
            <input className="input" type="number" inputMode="numeric" min={1950} max={2030} value={f.birthYear ?? ''} onChange={(e) => setF({ ...f, birthYear: num(e.target.value) })} />
          </Field>
        </div>
        {groups.length > 0 && (
          <Field label="Catégorie">
            <Seg<string> value={category ?? ''} onChange={setPicked} options={groups.map((g) => ({ value: g, label: g }))} />
          </Field>
        )}
        {!player && <p className="small muted">Postes, pied fort, évaluations et objectifs se remplissent ensuite sur sa fiche.</p>}
      </div>
    </Sheet>
  );
}

/** Note de 1 à 5 → note façon Ultimate Team (40 à 95). */
const toOvr = (v: number) => Math.round(40 + ((Math.min(5, Math.max(1, v)) - 1) / 4) * 55);
const STAT_LABELS: [DomainKey, string][] = [['tech', 'TEC'], ['phys', 'PHY'], ['tact', 'TAC'], ['mental', 'MEN'], ['behav', 'COM']];

/** Carte Ultimate Team d'un joueur de l'effectif, calculée à partir de ses évaluations. */
function rosterCard(p: Player): PlayerCard {
  const d = p.profile?.domains ?? {};
  const rated = STAT_LABELS.map(([k]) => d[k]).filter((v): v is number => typeof v === 'number');
  // Sans évaluation : une note neutre d'après l'aisance (1 à 3).
  const fallback = 2 + ((p.level ?? 2) - 1) * 0.75;
  const ovr = toOvr(rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : fallback);
  const stats: [string, number][] = STAT_LABELS.map(([k, label]) => [label, typeof d[k] === 'number' ? toOvr(d[k]!) : toOvr(fallback)]);
  const weak = p.profile?.weakFoot;
  stats.push(['PIE', p.profile?.foot === 'deux' ? 95 : weak ? toOvr(weak) : toOvr(fallback)]);
  return {
    id: p.id,
    firstName: p.firstName,
    photo: photoUrl(p),
    position: p.profile?.positions?.[0] ?? '—',
    ovr,
    stats,
    // La couleur de la carte suit la note : or, argent, bronze.
    award: { key: 'roster', label: '', emoji: '', tier: ovr >= 75 ? 'gold' : ovr >= 60 ? 'silver' : 'bronze' },
    minutes: 0,
    goals: 0,
    assists: 0,
    mine: false,
  };
}

export function Players() {
  const { team, can } = useApp();
  const nav = useNavigate();
  const groups = groupsOf(team?.category);
  const q = useAsync(() => (team ? api.get<Player[]>(`/teams/${team.id}/players?followUp=1`) : Promise.resolve([])), [team?.id]);
  const [sort, setSort] = useState<'name' | 'follow'>('name');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(false);
  const list = useMemo(() => {
    const n = search.trim().toLowerCase();
    const out = (q.data ?? []).filter((p) => !n || playerName(p).toLowerCase().includes(n));
    if (sort === 'follow') out.sort((a, b) => (b.followUp?.quietDays ?? 0) - (a.followUp?.quietDays ?? 0));
    return out;
  }, [q.data, search, sort]);
  // Joueurs à suivre : pas d'observation depuis 4 semaines, objectif dépassé, certificat manquant ou expiré.
  const watch = useMemo(() => {
    const out: { p: Player; why: string; icon: React.ReactNode }[] = [];
    for (const p of q.data ?? []) {
      const f = p.followUp;
      if (!f) continue;
      if (f.overdueGoals) out.push({ p, why: `${f.overdueGoals} objectif${f.overdueGoals > 1 ? 's' : ''} à échéance dépassée`, icon: <Target size={14} /> });
      else if (f.quietDays >= 28) out.push({ p, why: f.lastObservation ? `Pas d’observation depuis ${Math.floor(f.quietDays / 7)} semaines` : 'Aucune observation', icon: <AlertCircle size={14} /> });
      else if (f.certificate === 'expired' || f.certificate === 'soon') out.push({ p, why: f.certificate === 'expired' ? 'Certificat expiré' : 'Certificat bientôt expiré', icon: <FileWarning size={14} /> });
    }
    return out;
  }, [q.data]);

  if (!team) return <div className="page"><Empty icon={<Users />} title="Aucune équipe" /></div>;

  const tile = (p: Player) => {
    const alert = p.followUp && (p.followUp.quietDays >= 28 || p.followUp.overdueGoals > 0);
    return (
      <button key={p.id} className="fut-tile" onClick={() => nav(`/joueurs/${p.id}`)} aria-label={playerName(p)}>
        <FutCard
          card={rosterCard(p)}
          team={{ category: playerGroup(p, team) ?? team.category, color: team.color }}
          size={180}
          foot={
            <>
              {p.birthYear && <span>{p.birthYear}</span>}
              {!!p.followUp?.activeGoals && <span>🎯 {p.followUp.activeGoals}</span>}
            </>
          }
        />
        {alert && <span className="fut-alert" title="À suivre" />}
      </button>
    );
  };
  // Équipe U8/U9 : une section par catégorie.
  const sections = groups.length
    ? [...groups, null].map((g) => ({ g, players: list.filter((p) => playerGroup(p, team) === g) })).filter((x) => x.players.length)
    : [{ g: null, players: list }];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Joueurs</h1>
        </div>
        {can('players.manage') && (
          <div className="actions">
            <button className="btn primary" onClick={() => setForm(true)}>
              <Plus /> Ajouter
            </button>
          </div>
        )}
      </div>
      {watch.length > 0 && (
        <div className="watch">
          <b>À suivre cette semaine</b>
          <div className="watch-list">
            {watch.slice(0, 8).map(({ p, why, icon }) => (
              <button key={p.id} onClick={() => nav(`/joueurs/${p.id}?tab=suivi`)}>
                <Avatar name={playerName(p)} size="sm" />
                <span>
                  <b>{p.firstName}</b>
                  <small>
                    {icon} {why}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }} />
        <input className="input" style={{ paddingLeft: 38 }} placeholder="Rechercher un joueur…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Seg
        value={sort}
        onChange={setSort}
        options={[
          { value: 'name', label: 'A–Z' },
          { value: 'follow', label: 'À suivre' },
        ]}
      />
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : list.length ? (
        <div className="stack" style={{ gap: 26 }}>
          {sections.map(({ g, players }) => (
            <section key={g ?? 'none'}>
              {groups.length > 0 && (
                <div className="p-section">
                  <h2>{g ?? 'Sans catégorie'}</h2>
                  <span>
                    {players.length} joueur{players.length > 1 ? 's' : ''}
                  </span>
                </div>
              )}
              <div className="fut-grid">{players.map(tile)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<Users />}
            title="Aucun joueur"
            text="Ajoutez vos joueurs un par un avec le bouton « Ajouter »."
          />
        </div>
      )}
      {form && <PlayerForm teamId={team.id} onClose={() => setForm(false)} onSaved={() => q.reload()} />}
    </div>
  );
}
