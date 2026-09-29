import { Check, Copy, Download, Mail, Phone, Search, Upload, Users } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TeamBadge } from '../components/Layout';
import { Empty, Field, Seg, Sheet, Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import type { ClubTeamStats, RosterRow } from '../lib/types';
import { Gauge } from './Convocation';

type Tab = 'vue' | 'effectif';

export function Club() {
  const { can, isAdmin, me } = useApp();
  const [params, setParams] = useSearchParams();
  const dash = can('club.dashboard') || isAdmin;
  const tabs: { value: Tab; label: string }[] = [
    ...(dash ? [{ value: 'vue' as Tab, label: 'Vue d’ensemble' }] : []),
    { value: 'effectif', label: 'Effectif' },
  ];
  const tab = tabs.find((t) => t.value === params.get('vue'))?.value ?? tabs[0].value;
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>{me.club?.name ?? 'Club'}</h1>
          <div className="sub">Tableau de bord du club</div>
        </div>
        {tabs.length > 1 && <Seg value={tab} onChange={(v) => setParams(v === tabs[0].value ? {} : { vue: v })} options={tabs} />}
      </div>
      {tab === 'vue' && <Overview />}
      {tab === 'effectif' && <Roster />}
    </div>
  );
}

/* ------------------------------------------------------------------ vue d'ensemble */

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / 100) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" className="club-spark" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Pct({ v, good = 80, ok = 60 }: { v: number | null; good?: number; ok?: number }) {
  if (v === null) return <span className="muted">—</span>;
  return <b className={`pct ${v >= good ? 'good' : v >= ok ? 'ok' : 'bad'}`}>{v} %</b>;
}

function Overview() {
  const q = useAsync(() => api.get<ClubTeamStats[]>('/club/stats'), []);
  if (q.loading && !q.data) return <Spinner fill />;
  const t = q.data ?? [];
  const sum = (k: keyof ClubTeamStats) => t.reduce((a, x) => a + ((x[k] as number) || 0), 0);
  const avg = (k: 'attendance' | 'onTime' | 'responseRate') => {
    const vals = t.map((x) => x[k]).filter((v): v is number => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const players = sum('players');
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="kpis">
        <div className="kpi" style={{ ['--c' as string]: '#0a84ff' } as CSSProperties}>
          <small>Joueurs</small>
          <b>{players}</b>
          <span>
            {t.length} équipe{t.length > 1 ? 's' : ''} · {sum('licences')} licence{sum('licences') > 1 ? 's' : ''} validée{sum('licences') > 1 ? 's' : ''}
          </span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#34c759' } as CSSProperties}>
          <small>Présence aux séances</small>
          <b>{avg('attendance') ?? '—'}{avg('attendance') !== null && <em>%</em>}</b>
          <span>moyenne de la saison</span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#ff9500' } as CSSProperties}>
          <small>Convocations à l’heure</small>
          <b>{avg('onTime') ?? '—'}{avg('onTime') !== null && <em>%</em>}</b>
          <span>publiées avant la date limite</span>
        </div>
        <div className="kpi" style={{ ['--c' as string]: '#af52de' } as CSSProperties}>
          <small>Réponses des parents</small>
          <b>{avg('responseRate') ?? '—'}{avg('responseRate') !== null && <em>%</em>}</b>
          <span>
            {sum('parents')} parent{sum('parents') > 1 ? 's' : ''} inscrit{sum('parents') > 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="card table-scroll">
        <table className="eq-table club-table">
          <thead>
            <tr>
              <th>Équipe</th>
              <th>Joueurs</th>
              <th>Présence</th>
              <th className="hide-mobile">Tendance</th>
              <th>Équité</th>
              <th className="hide-mobile">Licences</th>
            </tr>
          </thead>
          <tbody>
            {t.map((x) => (
              <tr key={x.team.id}>
                <td>
                  <span className="row" style={{ gap: 10 }}>
                    <TeamBadge team={{ ...x.team, name: x.team.category, season: '', staff: [], playerCount: x.players }} size={32} brand={false} />
                    <span>
                      <b>{x.team.category}</b>
                      <small className="muted" style={{ display: 'block' }}>{x.staff.join(', ') || 'Sans éducateur'}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <b>{x.players}</b>
                </td>
                <td>
                  <Pct v={x.attendance} />
                </td>
                <td className="hide-mobile">
                  <Spark values={x.attendanceTrend} />
                </td>
                <td>
                  <Gauge value={x.equity} size={40} />
                </td>
                <td className="hide-mobile">
                  {x.licences}/{x.players}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ effectif */

const LIC = { ok: { label: 'Validée', tone: 'green' }, pending: { label: 'En cours', tone: 'warn' }, missing: { label: 'Pas de licence', tone: 'red' } } as const;

function csvCell(v: string) {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function Roster() {
  const { me, can } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const q = useAsync(() => api.get<RosterRow[]>('/club/roster'), []);
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState<string>('');
  const rows = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (r) =>
        (!team || r.team.id === team) &&
        (!n || `${r.firstName} ${r.lastName} ${r.licence.number} ${r.parents.map((p) => `${p.name} ${p.email}`).join(' ')}`.toLowerCase().includes(n)),
    );
  }, [q.data, search, team]);
  const exportCsv = () => {
    const head = ['Équipe', 'Nom', 'Prénom', 'Année', 'N°', 'Licence', 'Statut licence', 'Certificat', 'Autorisation photo', 'Parent', 'E-mail', 'Téléphone', 'Contacts d’urgence', 'Allergies'];
    const lines = rows.map((r) =>
      [
        r.team.category, r.lastName, r.firstName, r.birthYear ?? '', r.number ?? '', r.licence.number, LIC[r.licence.status].label, r.certificate ?? '',
        r.photoConsent === 'yes' ? 'Oui' : r.photoConsent === 'no' ? 'Non' : '', r.parents.map((p) => p.name).join(' / '), r.parents.map((p) => p.email).join(' / '),
        r.parents.map((p) => p.phone).filter(Boolean).join(' / '), r.contacts.map((c) => `${c.name} ${c.phone}`).join(' / '), r.allergies,
      ].map((v) => csvCell(String(v))).join(';'),
    );
    const blob = new Blob([`﻿${[head.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `effectif-${me.club?.name ?? 'club'}.csv`;
    a.click();
  };
  if (q.loading && !q.data) return <Spinner fill />;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="chat-search grow" style={{ margin: 0, minWidth: 220 }}>
          <Search size={16} />
          <input placeholder="Nom, parent, e-mail, licence…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="select" style={{ width: 'auto' }} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Toutes les équipes</option>
          {me.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.category}
            </option>
          ))}
        </select>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn icon" onClick={exportCsv} data-tip="Exporter en CSV" aria-label="Exporter en CSV">
            <Download />
          </button>
          {can('players.manage') && (
            <button className="btn icon" onClick={() => file.current?.click()} data-tip="Importer un fichier CSV" aria-label="Importer un fichier CSV">
              <Upload />
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setCsv(await f.text());
          }}
        />
      </div>
      {csv !== null && (
        <Sheet title="Importer des joueurs" wide onClose={() => setCsv(null)}>
          <Import text={csv} onDone={q.reload} />
        </Sheet>
      )}
      <p className="small muted">
        {rows.length} joueur{rows.length > 1 ? 's' : ''}
      </p>
      <div className="roster">
        {rows.map((r) => (
          <div key={r.id} className="roster-row">
            <Link to={`/joueurs/${r.id}`} className="roster-who">
              <TeamBadge team={{ ...r.team, name: r.team.category, season: '', staff: [], playerCount: 0 }} size={30} brand={false} />
              <span>
                <b>
                  {r.lastName.toUpperCase()} {r.firstName}
                </b>
                <small>
                  {r.licence.number ? <span className="mono">{r.licence.number}</span> : 'Licence non renseignée'}
                  {r.number !== null ? ` · n° ${r.number}` : ''}
                  {r.allergies ? ` · ⚠️ ${r.allergies}` : ''}
                </small>
              </span>
            </Link>
            <div className="roster-admin">
              <span className={`badge ${LIC[r.licence.status].tone}`}>{LIC[r.licence.status].label}</span>
              {r.photoConsent === 'no' && <span className="badge red">🚫 Photos</span>}
            </div>
            <div className="roster-parents">
              {r.parents.map((p) => (
                <span key={p.id} className="roster-parent">
                  <b>{p.name}</b>
                  {p.status === 'invited' && <small className="muted"> (invité)</small>}
                  <span className="row" style={{ gap: 4 }}>
                    <a href={`mailto:${p.email}`} aria-label={`E-mail à ${p.name}`}>
                      <Mail size={14} />
                    </a>
                    {p.phone && (
                      <a href={`tel:${p.phone.replace(/\s/g, '')}`} aria-label={`Appeler ${p.name}`}>
                        <Phone size={14} /> {p.phone}
                      </a>
                    )}
                  </span>
                </span>
              ))}
              {!r.parents.length &&
                (r.contacts.length ? (
                  r.contacts.map((c, i) => (
                    <a key={i} className="roster-parent" href={`tel:${c.phone.replace(/\s/g, '')}`}>
                      <b>{c.name}</b> <Phone size={13} /> {c.phone}
                    </a>
                  ))
                ) : (
                  <small className="muted">Aucun parent inscrit</small>
                ))}
            </div>
          </div>
        ))}
        {!rows.length && <Empty icon={<Users />} title="Aucun joueur" />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ import CSV */

const FIELDS = [
  { key: 'firstName', label: 'Prénom', test: /pr[ée]nom|first/i },
  { key: 'lastName', label: 'Nom', test: /^nom$|nom de famille|^last|surname|^nom /i },
  { key: 'birthDate', label: 'Naissance', test: /naiss|birth|n[ée]\(e\) le|date/i },
  { key: 'number', label: 'N° maillot', test: /maillot|dossard|^n°$/i },
  { key: 'licence', label: 'N° licence', test: /licen/i },
  { key: 'parentName', label: 'Nom du parent', test: /^(?!.*(mail|t[ée]l|phone|portable)).*(parent|responsable|tuteur|contact)/i },
  { key: 'parentEmail', label: 'E-mail parent', test: /mail/i },
  { key: 'parentPhone', label: 'Téléphone', test: /t[ée]l|phone|portable|mobile/i },
] as const;

function parseCsv(text: string) {
  const first = text.split(/\r?\n/)[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function detectColumns(h: string[]) {
  const m: Record<string, number> = {};
  // Les colonnes les plus spécifiques d'abord (« E-mail du responsable » est un e-mail, pas un nom).
  const order = ['firstName', 'lastName', 'licence', 'parentEmail', 'parentPhone', 'birthDate', 'parentName', 'number'];
  for (const f of [...FIELDS].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))) {
    const i = h.findIndex((c, idx) => f.test.test(c) && !Object.values(m).includes(idx));
    if (i >= 0) m[f.key] = i;
  }
  return m;
}

function Import({ text, onDone }: { text: string; onDone: () => void }) {
  const { me, team } = useApp();
  const toast = useToast();
  const [teamId, setTeamId] = useState(team?.id ?? me.teams[0]?.id ?? '');
  const raw = text.replace(/^\uFEFF/, '');
  const [map, setMap] = useState<Record<string, number>>(() => detectColumns(parseCsv(raw)[0] ?? []));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; linked: number; invited: number; skipped: number; invites: { email: string; name: string; token: string }[] } | null>(null);
  const table = useMemo(() => parseCsv(raw), [raw]);
  const header = table[0] ?? [];
  const body = table.slice(1);
  const rows = body.map((r) => Object.fromEntries(FIELDS.map((f) => [f.key, map[f.key] !== undefined ? r[map[f.key]] ?? '' : ''])));
  const go = async () => {
    setBusy(true);
    try {
      setResult(await api.post('/club/import', { teamId, rows }));
      toast('Import terminé');
      onDone();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="small muted">
        Vérifiez la correspondance des colonnes avant d’importer. Les parents déjà inscrits sont rattachés automatiquement (un seul compte pour les frères et sœurs), les autres reçoivent
        une invitation.
      </p>
      <Field label="Équipe">
        <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {me.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.category}
            </option>
          ))}
        </select>
      </Field>
      {!header.length && <Empty title="Fichier vide" text="Aucune ligne n’a pu être lue dans ce fichier." />}

      {header.length > 0 && (
        <>
          <div className="map-grid">
            {FIELDS.map((f) => (
              <label key={f.key} className={`map-field${map[f.key] !== undefined ? ' ok' : ''}`}>
                <span>
                  {map[f.key] !== undefined && <Check size={13} />} {f.label}
                </span>
                <select className="select" value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? (undefined as unknown as number) : Number(e.target.value) })}>
                  <option value="">— ignorer —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Colonne ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="card table-scroll">
            <table className="eq-table">
              <thead>
                <tr>
                  {FIELDS.filter((f) => map[f.key] !== undefined).map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {FIELDS.filter((f) => map[f.key] !== undefined).map((f) => (
                      <td key={f.key}>{r[f.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 6 && <p className="small muted" style={{ padding: '8px 20px 14px' }}>… et {rows.length - 6} autres lignes</p>}
          </div>
          <button className="btn primary lg" disabled={busy || map.firstName === undefined || !rows.length} onClick={go} style={{ alignSelf: 'flex-start' }}>
            Importer {rows.length} joueur{rows.length > 1 ? 's' : ''}
          </button>
        </>
      )}

      {result && (
        <div className="card pad stack">
          <b>Import terminé</b>
          <div className="kpis small-kpis">
            <div className="kpi" style={{ ['--c' as string]: '#34c759' } as CSSProperties}>
              <small>Créés</small>
              <b>{result.created}</b>
            </div>
            <div className="kpi" style={{ ['--c' as string]: '#0a84ff' } as CSSProperties}>
              <small>Mis à jour</small>
              <b>{result.updated}</b>
            </div>
            <div className="kpi" style={{ ['--c' as string]: '#af52de' } as CSSProperties}>
              <small>Parents rattachés</small>
              <b>{result.linked}</b>
            </div>
            <div className="kpi" style={{ ['--c' as string]: '#ff9500' } as CSSProperties}>
              <small>Invitations créées</small>
              <b>{result.invited}</b>
            </div>
          </div>
          {result.invites.length > 0 && (
            <>
              <p className="small muted">Envoyez à chaque parent son lien d’activation (SMS, WhatsApp ou e-mail) :</p>
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={async () => {
                  await navigator.clipboard.writeText(result.invites.map((i) => `${i.name || i.email} : ${location.origin}/invitation/${i.token}`).join('\n'));
                  toast('Liens copiés');
                }}
              >
                <Copy /> Copier tous les liens
              </button>
              <div className="list">
                {result.invites.map((i) => (
                  <div key={i.token} className="list-item" style={{ cursor: 'default', padding: '8px 4px', minHeight: 0 }}>
                    <div className="t">
                      <b>{i.name || i.email}</b>
                      <small>{i.email}</small>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
