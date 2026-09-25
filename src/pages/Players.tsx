import { ListPlus, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Empty, Field, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { playerName, useApp } from '../lib/store';
import type { Player } from '../lib/types';

export function LevelDots({ level }: { level?: number }) {
  return (
    <span className="lvl-dots" title={['En progression', 'À l’aise', 'Très à l’aise'][(level ?? 2) - 1]}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= (level ?? 2) ? 'on' : ''} />
      ))}
    </span>
  );
}

export function PlayerForm({ player, teamId, onClose, onSaved }: { player?: Player; teamId: string; onClose: () => void; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Player>>(player ?? { level: 2 });
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
        <Field label="Aisance" hint="sert à équilibrer les groupes, jamais visible des parents">
          <Seg
            value={f.level ?? 2}
            onChange={(level) => setF({ ...f, level })}
            options={[
              { value: 1 as const, label: 'En progression' },
              { value: 2 as const, label: 'À l’aise' },
              { value: 3 as const, label: 'Très à l’aise' },
            ]}
          />
        </Field>
        <Field label="Pied">
          <Seg<string>
            value={f.foot ?? ''}
            onChange={(foot) => setF({ ...f, foot: (foot || undefined) as Player['foot'] })}
            options={[
              { value: '', label: '—' },
              { value: 'droit', label: 'Droit' },
              { value: 'gauche', label: 'Gauche' },
              { value: 'deux', label: 'Les deux' },
            ]}
          />
        </Field>
        <Field label="Poste préféré">
          <input className="input" value={f.position ?? ''} placeholder="Ex. : gardien, attaquant…" onChange={(e) => setF({ ...f, position: e.target.value })} />
        </Field>
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
      for (const r of rows) await api.put(`/players/${uid()}`, { ...r, level: 2, teamId });
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
  const q = useAsync(() => (team ? api.get<Player[]>(`/teams/${team.id}/players`) : Promise.resolve([])), [team?.id]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(false);
  const [bulk, setBulk] = useState(false);
  const list = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (q.data ?? []).filter((p) => !n || playerName(p).toLowerCase().includes(n));
  }, [q.data, search]);

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
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }} />
        <input className="input" style={{ paddingLeft: 38 }} placeholder="Rechercher un joueur…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.loading && !q.data ? (
        <Spinner fill />
      ) : list.length ? (
        <div className="p-grid">
          {list.map((p) => (
            <button key={p.id} className="p-tile" onClick={() => nav(`/joueurs/${p.id}`)}>
              {p.number !== undefined && <span className="p-num">{p.number}</span>}
              <Avatar name={playerName(p)} size="lg" />
              <b className="ellipsis">{p.firstName}</b>
              <span className="p-meta">
                {p.birthYear && <span>{p.birthYear}</span>}
                <LevelDots level={p.level} />
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
