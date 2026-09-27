import { AlertCircle, FileWarning, ListPlus, Plus, Search, Target, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radar } from '../components/PlayerProfile';
import { Avatar, Empty, Field, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { playerName, useApp } from '../lib/store';
import type { Player } from '../lib/types';

export function PlayerForm({ player, teamId, onClose, onSaved }: { player?: Player; teamId: string; onClose: () => void; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Player>>(player ?? {});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.firstName?.trim()) return;
    setBusy(true);
    try {
      const p = await api.put<Player>(`/players/${player?.id ?? uid()}`, { ...f, teamId: f.teamId ?? teamId });
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
          <button className="btn primary" disabled={!f.firstName?.trim() || busy} onClick={save}>
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
          <Field label="Numéro">
            <input className="input" type="number" inputMode="numeric" min={0} max={99} value={f.number ?? ''} onChange={(e) => setF({ ...f, number: num(e.target.value) })} />
          </Field>
        </div>
        {!player && <p className="small muted">Postes, pied fort, évaluations et objectifs se remplissent ensuite sur sa fiche.</p>}
      </div>
    </Sheet>
  );
}

function BulkImport({ teamId, onClose, onDone }: { teamId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const year = l.match(/\b(19|20)\d{2}\b/)?.[0];
      const name = l.replace(/[,;\t]/g, ' ').replace(/\b(19|20)\d{2}\b/, '').trim().split(/\s+/);
      return { firstName: name[0] ?? '', lastName: name.slice(1).join(' '), birthYear: year ? Number(year) : undefined };
    })
    .filter((r) => r.firstName);
  const go = async () => {
    setBusy(true);
    try {
      for (const r of rows) await api.put(`/players/${uid()}`, { ...r, teamId });
      toast(`${rows.length} joueurs ajoutés`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Import rapide"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!rows.length || busy} onClick={go}>
          Ajouter {rows.length || ''} joueur{rows.length > 1 ? 's' : ''}
        </button>
      }
    >
      <p className="muted small" style={{ marginBottom: 10 }}>
        Un joueur par ligne : « Prénom Nom 2018 ». Vous pouvez copier la liste depuis SportEasy ou un tableur.
      </p>
      <textarea className="textarea" rows={10} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Léo Martin 2018\nInès Dubois 2019\nNolan'} />
    </Sheet>
  );
}

export function Players() {
  const { team, can } = useApp();
  const nav = useNavigate();
  const q = useAsync(() => (team ? api.get<Player[]>(`/teams/${team.id}/players?followUp=1`) : Promise.resolve([])), [team?.id]);
  const [sort, setSort] = useState<'name' | 'number' | 'follow'>('name');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(false);
  const [bulk, setBulk] = useState(false);
  const list = useMemo(() => {
    const n = search.trim().toLowerCase();
    const out = (q.data ?? []).filter((p) => !n || playerName(p).toLowerCase().includes(n));
    if (sort === 'number') out.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Joueurs</h1>
        </div>
        {can('players.manage') && (
          <div className="actions">
            <button className="btn" onClick={() => setBulk(true)}>
              <ListPlus /> <span className="hide-mobile">Import rapide</span>
            </button>
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
          { value: 'number', label: 'N°' },
          { value: 'follow', label: 'À suivre' },
        ]}
      />
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : list.length ? (
        <div className="p-grid">
          {list.map((p) => (
            <button key={p.id} className="p-tile" onClick={() => nav(`/joueurs/${p.id}`)}>
              {p.number !== undefined && <span className="p-num">{p.number}</span>}
              {p.followUp && (p.followUp.quietDays >= 28 || p.followUp.overdueGoals > 0) && <span className="p-alert" title="À suivre" />}
              {p.profile?.domains && Object.keys(p.profile.domains).length ? (
                <span className="p-radar">
                  <Radar values={p.profile.domains} size={76} labels={false} />
                  <span className="p-initials">{p.firstName.slice(0, 1)}</span>
                </span>
              ) : (
                <Avatar name={playerName(p)} size="lg" />
              )}
              <b className="ellipsis">{p.firstName}</b>
              <span className="p-meta">
                {p.profile?.positions?.[0] && <span className="p-pos">{p.profile.positions[0]}</span>}
                {p.birthYear && <span>{p.birthYear}</span>}
                {!!p.followUp?.activeGoals && (
                  <span title={`${p.followUp.activeGoals} objectif(s) en cours`}>
                    <Target size={12} /> {p.followUp.activeGoals}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<Users />}
            title="Aucun joueur"
            text="Ajoutez vos joueurs un par un ou collez la liste complète avec l’import rapide."
          />
        </div>
      )}
      {form && <PlayerForm teamId={team.id} onClose={() => setForm(false)} onSaved={() => q.reload()} />}
      {bulk && <BulkImport teamId={team.id} onClose={() => setBulk(false)} onDone={q.reload} />}
    </div>
  );
}
