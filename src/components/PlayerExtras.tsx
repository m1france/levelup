import {
  AlertCircle, BookOpen, Camera, Check, ChevronRight, FileWarning, MessageSquare, Minus, Phone, Plus, ShieldCheck, Target, Trash2, Trophy,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ALLERGY_PICKS, HEALTH_PICKS, TEST, TESTS } from '../lib/profile';
import { formatDate, relative } from '../lib/store';
import type { Bulletin, EmergencyContact, Player, PlayerInfo } from '../lib/types';
import { Avatar, Empty, Field, Sheet, useAsync, useConfirm, useToast } from './ui';

/* ------------------------------------------------------------------ alertes */

/** « Pas d'observation sur Tom depuis 5 semaines » : pour qu'aucun enfant ne soit oublié. */
export function PlayerAlerts({ p, onObserve }: { p: Player; onObserve: () => void }) {
  const f = p.followUp;
  if (!f) return null;
  const items: { icon: React.ReactNode; text: string; action?: { label: string; fn: () => void } }[] = [];
  if (f.quietDays >= 28) {
    items.push({
      icon: <AlertCircle />,
      text: f.lastObservation ? `Pas d’observation sur ${p.firstName} depuis ${Math.floor(f.quietDays / 7)} semaines` : `Aucune observation sur ${p.firstName} pour l’instant`,
      action: { label: 'Observer', fn: onObserve },
    });
  }
  if (f.overdueGoals) items.push({ icon: <Target />, text: `${f.overdueGoals} objectif${f.overdueGoals > 1 ? 's ont' : ' a'} dépassé l’échéance` });
  if (f.certificate === 'expired' || f.certificate === 'missing') items.push({ icon: <FileWarning />, text: f.certificate === 'expired' ? 'Certificat médical expiré' : 'Certificat médical non renseigné' });
  if (!items.length) return null;
  return (
    <div className="pp-alerts">
      {items.map((it, i) => (
        <div key={i} className="pp-alert">
          {it.icon}
          <span className="grow">{it.text}</span>
          {it.action && (
            <button className="btn sm" onClick={it.action.fn}>
              {it.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ tests mesurés */

function MiniChart({ values, lower, color = 'var(--accent)' }: { values: number[]; lower: boolean; color?: string }) {
  if (values.length < 2) return <span className="mini-chart empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const y = lower ? (v - min) / span : 1 - (v - min) / span;
    return `${((i / (values.length - 1)) * 96 + 2).toFixed(1)},${(y * 26 + 3).toFixed(1)}`;
  });
  return (
    <svg className="mini-chart" viewBox="0 0 100 32" preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const fmt = (v: number) => String(v).replace('.', ',');

/** Tests concrets : sprint, jongles, tirs cadrés… avec record personnel et évolution. */
export function TestsPanel({ p, canEdit, onSaved }: { p: Player; canEdit: boolean; onSaved: (p: Player) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const tests = p.profile?.tests ?? {};
  return (
    <div className="card pad">
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h3>Tests & records</h3>
          <p className="small muted">Des mesures concrètes pour voir la progression, séance après séance.</p>
        </div>
      </div>
      <div className="tests">
        {TESTS.map((t) => {
          const list = tests[t.key] ?? [];
          const last = list.at(-1);
          const first = list[0];
          const best = list.length ? list.reduce((a, b) => ((t.lower ? b.v < a.v : b.v > a.v) ? b : a)) : null;
          const gain = last && first && list.length > 1 ? (t.lower ? first.v - last.v : last.v - first.v) : 0;
          const record = !!last && best === last && list.length > 1;
          return (
            <button key={t.key} className={`test${last ? '' : ' empty'}`} onClick={() => (canEdit || last) && setOpen(t.key)} disabled={!canEdit && !last}>
              <span className="test-emoji">{t.emoji}</span>
              <span className="test-label">{t.label}</span>
              {last ? (
                <>
                  <span className="test-value">
                    {fmt(last.v)}
                    <small>{t.unit}</small>
                  </span>
                  <span className="test-foot">
                    {record ? <span className="test-record">🏆 Record</span> : gain > 0 ? <span className="test-gain">+{fmt(Math.round(gain * 10) / 10)}</span> : <span className="muted">{list.length} mesure{list.length > 1 ? 's' : ''}</span>}
                    <MiniChart values={list.map((x) => x.v)} lower={t.lower} />
                  </span>
                </>
              ) : (
                <span className="test-add">{canEdit ? <><Plus size={14} /> Mesurer</> : '—'}</span>
              )}
            </button>
          );
        })}
      </div>
      {open && <TestSheet p={p} testKey={open} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={(np) => onSaved(np)} />}
    </div>
  );
}

function TestSheet({ p, testKey, canEdit, onClose, onSaved }: { p: Player; testKey: string; canEdit: boolean; onClose: () => void; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const t = TEST[testKey];
  const list = p.profile?.tests?.[testKey] ?? [];
  const [v, setV] = useState<number>(list.at(-1)?.v ?? (t.lower ? 5 : 5));
  const [busy, setBusy] = useState(false);
  const best = list.length ? list.reduce((a, b) => ((t.lower ? b.v < a.v : b.v > a.v) ? b : a)).v : null;
  const save = async () => {
    setBusy(true);
    try {
      const out = await api.post<Player>(`/players/${p.id}/tests`, { key: testKey, value: v });
      onSaved(out);
      const beat = best !== null && (t.lower ? v < best : v > best);
      toast(beat ? `🏆 Nouveau record pour ${p.firstName} !` : 'Mesure enregistrée');
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const step = (d: number) => setV((x) => Math.max(0, Math.min(t.max, Math.round((x + d) * 10) / 10)));
  return (
    <Sheet
      title={`${t.emoji} ${t.label}`}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            {list.length > 0 && (
              <button
                className="btn ghost danger"
                onClick={async () => {
                  onSaved(await api.del<Player>(`/players/${p.id}/tests/${testKey}`));
                  onClose();
                }}
              >
                <Trash2 /> Retirer la dernière
              </button>
            )}
            <span className="grow" />
            <button className="btn primary" disabled={busy} onClick={save}>
              Enregistrer la mesure
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <p className="small muted">{t.hint}</p>
        {canEdit && (
          <div className="big-stepper">
            <button onClick={() => step(-t.step)} aria-label="Moins">
              <Minus />
            </button>
            <label>
              <input type="number" inputMode="decimal" step={t.step} value={v} onChange={(e) => setV(Number(e.target.value.replace(',', '.')) || 0)} />
              <small>{t.unit}</small>
            </label>
            <button onClick={() => step(t.step)} aria-label="Plus">
              <Plus />
            </button>
          </div>
        )}
        {best !== null && (
          <p className="small" style={{ textAlign: 'center' }}>
            Record actuel : <b>{fmt(best)} {t.unit}</b> {t.lower ? '(plus bas = mieux)' : ''}
          </p>
        )}
        {list.length > 0 && (
          <div className="test-hist">
            {[...list].reverse().map((x, i) => (
              <span key={i}>
                <small>{formatDate(x.at, false)}</small>
                <b>
                  {fmt(x.v)} {t.unit}
                </b>
              </span>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ infos pratiques */

const EMPTY_INFO: PlayerInfo = { contacts: [], allergies: '', treatment: '', health: '', licence: { number: '', status: 'missing' }, certificate: null, photoConsent: '' };
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function TagPicker({ value, picks, onChange, readOnly, tone }: { value: string; picks: string[]; onChange: (v: string) => void; readOnly: boolean; tone: string }) {
  const tags = split(value);
  const [adding, setAdding] = useState('');
  const toggle = (t: string) => onChange((tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]).join(', '));
  const all = [...new Set([...picks, ...tags])];
  return (
    <div className="tag-picker">
      {all.filter((t) => !readOnly || tags.includes(t)).map((t) => (
        <button key={t} type="button" disabled={readOnly} className={`tag ${tone}${tags.includes(t) ? ' on' : ''}`} onClick={() => toggle(t)}>
          {tags.includes(t) && <Check size={13} />} {t}
        </button>
      ))}
      {!readOnly && (
        <form
          className="tag-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.trim() && !tags.includes(adding.trim())) onChange([...tags, adding.trim()].join(', '));
            setAdding('');
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="+ Autre…" />
        </form>
      )}
      {readOnly && !tags.length && <span className="muted small">Rien à signaler</span>}
    </div>
  );
}

function ContactSheet({ contact, onClose, onSave, onDelete }: { contact: EmergencyContact; onClose: () => void; onSave: (c: EmergencyContact) => void; onDelete?: () => void }) {
  const [c, setC] = useState(contact);
  return (
    <Sheet
      title={contact.name ? contact.name : 'Nouveau contact'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn ghost danger" onClick={onDelete}>
              <Trash2 />
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" disabled={!c.name.trim() && !c.phone.trim()} onClick={() => onSave(c)}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nom">
          <input className="input" autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </Field>
        <div className="chips">
          {['Mère', 'Père', 'Grand-parent', 'Oncle / tante', 'Nourrice', 'Autre'].map((r) => (
            <button key={r} type="button" className={`chip${c.relation === r ? ' on' : ''}`} onClick={() => setC({ ...c, relation: r })}>
              {r}
            </button>
          ))}
        </div>
        <Field label="Téléphone">
          <input className="input" type="tel" inputMode="tel" value={c.phone} placeholder="06 12 34 56 78" onChange={(e) => setC({ ...c, phone: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  );
}

function certState(date: string | null) {
  if (!date) return { tone: 'red', label: 'À fournir', days: 0, pct: 0 };
  const end = new Date(`${date}T12:00`).getTime() + 365 * 864e5;
  const days = Math.ceil((end - Date.now()) / 864e5);
  if (days < 0) return { tone: 'red', label: 'Expiré', days, pct: 0 };
  return { tone: days < 30 ? 'warn' : 'green', label: days < 30 ? `Expire dans ${days} j` : 'Valide', days, pct: Math.min(1, days / 365) };
}

/** Infos pratiques en cartes : contacts d'urgence, santé, licence, certificat, autorisation photo. Enregistrement automatique. */
export function InfoPanel({ p, canEdit, parents, isStaff, onSaved }: { p: Player; canEdit: boolean; parents: { id: string; name: string; email: string }[]; isStaff: boolean; onSaved: (p: Player) => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<PlayerInfo>({ ...EMPTY_INFO, ...(p.info ?? {}) });
  const [contact, setContact] = useState<{ i: number | null; c: EmergencyContact } | null>(null);
  const [more, setMore] = useState(!!info.health);
  const lastSaved = useRef(JSON.stringify(info));
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok'>('idle');

  useEffect(() => {
    const json = JSON.stringify(info);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    setSaved('saving');
    const t = setTimeout(async () => {
      try {
        onSaved(await api.put<Player>(`/players/${p.id}/info`, info));
        setSaved('ok');
      } catch (e) {
        toast((e as Error).message, true);
        setSaved('idle');
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const set = (patch: Partial<PlayerInfo>) => canEdit && setInfo({ ...info, ...patch });
  const cert = certState(info.certificate);
  const R = 22;
  const C = 2 * Math.PI * R;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {canEdit && (
        <p className="small muted" style={{ textAlign: 'right', minHeight: 18 }}>
          {saved === 'saving' ? 'Enregistrement…' : saved === 'ok' ? '✓ Enregistré' : ''}
        </p>
      )}
      <div className="card pad">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3>
            <Phone size={16} style={{ verticalAlign: -2 }} /> En cas d’urgence
          </h3>
          {canEdit && info.contacts.length < 4 && (
            <button className="btn sm" onClick={() => setContact({ i: null, c: { name: '', relation: '', phone: '' } })}>
              <Plus /> Contact
            </button>
          )}
        </div>
        <div className="contacts">
          {info.contacts.map((c, i) => (
            <div key={i} className="contact">
              <button className="contact-main" onClick={() => canEdit && setContact({ i, c })} disabled={!canEdit}>
                <Avatar name={c.name || '?'} />
                <span className="grow">
                  <b>{c.name || 'Sans nom'}</b>
                  <small>
                    {c.relation && <span className="rel">{c.relation}</span>} {c.phone}
                  </small>
                </span>
              </button>
              {c.phone && (
                <>
                  <a className="contact-btn sms" href={`sms:${c.phone.replace(/\s/g, '')}`} aria-label="SMS">
                    <MessageSquare size={17} />
                  </a>
                  <a className="contact-btn call" href={`tel:${c.phone.replace(/\s/g, '')}`} aria-label="Appeler">
                    <Phone size={17} />
                  </a>
                </>
              )}
            </div>
          ))}
          {!info.contacts.length && <p className="small muted">Aucun contact d’urgence.</p>}
        </div>
      </div>

      <div className="card pad stack" style={{ gap: 14 }}>
        <h3>Santé</h3>
        <div>
          <span className="lbl">Allergies</span>
          <TagPicker value={info.allergies} picks={ALLERGY_PICKS} tone="red" readOnly={!canEdit} onChange={(allergies) => set({ allergies })} />
        </div>
        <div>
          <span className="lbl">À savoir</span>
          <TagPicker value={info.treatment} picks={HEALTH_PICKS} tone="blue" readOnly={!canEdit} onChange={(treatment) => set({ treatment })} />
        </div>
        {more || info.health ? (
          <textarea className="textarea" rows={2} disabled={!canEdit} value={info.health} placeholder="Autre chose que l’éducateur doit savoir ?" onChange={(e) => set({ health: e.target.value })} />
        ) : (
          canEdit && (
            <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)}>
              + Ajouter une précision
            </button>
          )
        )}
      </div>

      <div className="admin-cards">
        <div className={`card admin-card lic-${info.licence.status}`}>
          <span className="admin-ic">
            <ShieldCheck />
          </span>
          <b>Licence</b>
          <div className="lic-pick">
            {(
              [
                ['ok', '✅', 'Validée'],
                ['pending', '⏳', 'En cours'],
                ['missing', '✖️', 'À faire'],
              ] as const
            ).map(([k, e, l]) => (
              <button key={k} disabled={!canEdit} className={info.licence.status === k ? 'on' : ''} onClick={() => set({ licence: { ...info.licence, status: k } })}>
                <span>{e}</span>
                {l}
              </button>
            ))}
          </div>
          <input className="input bare-num" disabled={!canEdit} placeholder="N° de licence" value={info.licence.number} onChange={(e) => set({ licence: { ...info.licence, number: e.target.value } })} />
        </div>
        <div className={`card admin-card cert-${cert.tone}`}>
          <span className="cert-ring">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
              <circle cx="26" cy="26" r={R} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * cert.pct} ${C}`} transform="rotate(-90 26 26)" />
            </svg>
            <b>{cert.days > 0 ? cert.days : '!'}</b>
          </span>
          <b>Certificat médical</b>
          <span className={`badge ${cert.tone}`}>{cert.label}</span>
          <input className="input bare-num" type="date" disabled={!canEdit} value={info.certificate ?? ''} onChange={(e) => set({ certificate: e.target.value || null })} />
        </div>
        <div className="card admin-card">
          <span className="admin-ic">
            <Camera />
          </span>
          <b>Photos dans l’album</b>
          <div className="consent">
            <button disabled={!canEdit} className={info.photoConsent === 'yes' ? 'on yes' : ''} onClick={() => set({ photoConsent: 'yes' })}>
              📸 <span>Autorisées</span>
            </button>
            <button disabled={!canEdit} className={info.photoConsent === 'no' ? 'on no' : ''} onClick={() => set({ photoConsent: 'no' })}>
              🚫 <span>Refusées</span>
            </button>
          </div>
        </div>
      </div>

      {isStaff && parents.length > 0 && (
        <>
          <div className="section-title">Parents inscrits</div>
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
      {contact && (
        <ContactSheet
          contact={contact.c}
          onClose={() => setContact(null)}
          onDelete={contact.i !== null ? () => (set({ contacts: info.contacts.filter((_, j) => j !== contact.i) }), setContact(null)) : undefined}
          onSave={(c) => {
            set({ contacts: contact.i === null ? [...info.contacts, c] : info.contacts.map((x, j) => (j === contact.i ? c : x)) });
            setContact(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bulletins */

function periods() {
  const now = new Date();
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [
    { label: `1er trimestre ${y}-${y + 1}`, from: `${y}-08-01`, to: `${y}-12-31` },
    { label: `2e trimestre ${y}-${y + 1}`, from: `${y + 1}-01-01`, to: `${y + 1}-03-31` },
    { label: `3e trimestre ${y}-${y + 1}`, from: `${y + 1}-04-01`, to: `${y + 1}-07-31` },
    { label: `Saison ${y}-${y + 1}`, from: `${y}-08-01`, to: today },
  ];
}

export function BulletinsTab({ p, canEdit }: { p: Player; canEdit: boolean }) {
  const nav = useNavigate();
  const q = useAsync(() => api.get<Bulletin[]>(`/players/${p.id}/bulletins`), [p.id]);
  const [create, setCreate] = useState(false);
  const list = q.data ?? [];
  return (
    <div className="stack" style={{ gap: 14 }}>
      {canEdit && (
        <button className="goal-new" onClick={() => setCreate(true)}>
          <BookOpen /> Préparer un bulletin pour {p.firstName}
        </button>
      )}
      {list.length ? (
        <div className="bul-list">
          {list.map((b) => (
            <button key={b.id} className="bul-item" onClick={() => nav(`/bulletins/${b.id}`)}>
              <span className="bul-cover">
                <Trophy />
              </span>
              <span className="grow">
                <b>{b.period}</b>
                <small>
                  {b.publishedAt ? `Envoyé ${relative(b.publishedAt)}` : 'Brouillon · pas encore envoyé'} · {b.snapshot.awards.length} récompense{b.snapshot.awards.length > 1 ? 's' : ''}
                </small>
              </span>
              {!b.publishedAt && <span className="badge warn">Brouillon</span>}
              <ChevronRight className="muted" />
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<BookOpen />} title="Aucun bulletin" text={canEdit ? 'Chaque trimestre, un bulletin illustré et positif pour la famille : progrès, récompenses, objectifs et votre mot.' : 'Le bulletin de progression arrivera ici.'} />
        </div>
      )}
      {create && <BulletinSheet p={p} onClose={() => setCreate(false)} onDone={(b) => nav(`/bulletins/${b.id}`)} />}
    </div>
  );
}

function BulletinSheet({ p, onClose, onDone }: { p: Player; onClose: () => void; onDone: (b: Bulletin) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const options = useMemo(periods, []);
  const [period, setPeriod] = useState(options[3]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (publish: boolean) => {
    if (publish && !(await confirm({ title: `Envoyer le bulletin de ${p.firstName} ?`, text: 'La famille reçoit une notification. Seuls les progrès, points forts et récompenses sont partagés.', confirm: 'Envoyer' }))) return;
    setBusy(true);
    try {
      const b = await api.post<Bulletin>(`/players/${p.id}/bulletins`, { period: period.label, from: period.from, to: period.to, message, publish });
      toast(publish ? 'Bulletin envoyé 📘' : 'Brouillon créé');
      onDone(b);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Bulletin de ${p.firstName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={() => go(false)}>
            Aperçu d’abord
          </button>
          <button className="btn primary" disabled={busy} onClick={() => go(true)}>
            Envoyer à la famille
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="period-pick">
          {options.map((o) => (
            <button key={o.label} className={period.label === o.label ? 'on' : ''} onClick={() => setPeriod(o)}>
              <b>{o.label.split(' ').slice(0, 2).join(' ')}</b>
              <small>
                {formatDate(o.from, false)} → {formatDate(o.to, false)}
              </small>
            </button>
          ))}
        </div>
        <Field label="Votre mot pour la famille">
          <textarea
            className="textarea"
            rows={4}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`${p.firstName} a fait de beaux progrès ce trimestre, notamment…`}
          />
        </Field>
        <p className="small muted">
          Le bulletin rassemble automatiquement présences, temps de jeu, points forts, progrès par domaine, récompenses de match, objectifs atteints et records. Les points à travailler ne sont jamais affichés.
        </p>
      </div>
    </Sheet>
  );
}

