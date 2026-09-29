import { Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FutCard } from '../components/FutCard';
import { photoUrl } from '../components/PlayerAvatar';
import { Empty, Field, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { groupsOf, guessGroup, playerGroup } from '../lib/groups';
import { playerName, useApp } from '../lib/store';
import type { DomainKey, Player, PlayerCard, PlayerInfo } from '../lib/types';

const EMPTY_INFO: PlayerInfo = { contacts: [], allergies: '', treatment: '', health: '', licence: { number: '', status: 'missing' }, certificate: null, photoConsent: '', city: '' };

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
  const info: PlayerInfo = { ...EMPTY_INFO, ...(player?.info ?? {}) };
  const [lic, setLic] = useState(info.licence);
  const [city, setCity] = useState(info.city ?? '');
  const save = async () => {
    if (!f.firstName?.trim() || (groups.length && !category)) return;
    setBusy(true);
    try {
      let p = await api.put<Player>(`/players/${player?.id ?? uid()}`, { ...f, category: category ?? undefined, teamId: f.teamId ?? teamId });
      // Licence et ville : enregistrées avec les infos pratiques de la fiche.
      if (lic.number !== info.licence.number || lic.status !== info.licence.status || city.trim() !== (info.city ?? ''))
        p = await api.put<Player>(`/players/${p.id}/info`, { ...info, licence: { ...lic, number: lic.number.trim() }, city: city.trim() });
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
        <div className="row">
          <Field label="N° de licence">
            <input className="input" value={lic.number} onChange={(e) => setLic({ ...lic, number: e.target.value })} />
          </Field>
          <Field label="Ville">
            <input className="input" value={city} placeholder="Ville de la famille" onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <Field label="Licence">
          <Seg<PlayerInfo['licence']['status']>
            value={lic.status}
            onChange={(status) => setLic({ ...lic, status })}
            options={[
              { value: 'ok', label: 'Validée' },
              { value: 'pending', label: 'En cours' },
              { value: 'missing', label: 'À faire' },
            ]}
          />
        </Field>
        {groups.length > 0 && (
          <Field label="Catégorie">
            <Seg<string> value={category ?? ''} onChange={setPicked} options={groups.map((g) => ({ value: g, label: g }))} />
          </Field>
        )}
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
    cutout: !!p.photo && !!p.photoAlpha,
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
  const { me, team, can } = useApp();
  const nav = useNavigate();
  const groups = groupsOf(team?.category);
  const q = useAsync(() => (team ? api.get<Player[]>(`/teams/${team.id}/players`) : Promise.resolve([])), [team?.id]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(false);
  const list = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (q.data ?? []).filter((p) => !n || playerName(p).toLowerCase().includes(n));
  }, [q.data, search]);
  if (!team) return <div className="page"><Empty icon={<Users />} title="Aucune équipe" /></div>;

  const tile = (p: Player) => (
      <button key={p.id} className="fut-tile" onClick={() => nav(`/joueurs/${p.id}`)} aria-label={playerName(p)}>
        <FutCard
          card={rosterCard(p)}
          team={{ category: playerGroup(p, team) ?? team.category, color: team.color, logo: me.club?.logo }}
          size={180}
          foot={p.birthYear ? <span>{p.birthYear}</span> : <></>}
        />
      </button>
  );
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
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }} />
        <input className="input" style={{ paddingLeft: 38 }} placeholder="Rechercher un joueur…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
