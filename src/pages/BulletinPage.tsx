import { ArrowLeft, Pencil, Printer, RefreshCw, Send, Share2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Rating } from '../components/PlayerProfile';
import { Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { TIERS } from '../components/FutCard';
import { api } from '../lib/api';
import { DOMAIN, POSITION, SKILL, TEST } from '../lib/profile';
import { formatDate, useApp } from '../lib/store';
import type { Bulletin } from '../lib/types';

/** Apparition douce des sections au défilement. */
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return setOn(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setOn(true), io.disconnect()), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section ref={ref} className={`bl-sec ${className}${on ? ' in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </section>
  );
}

/** Anneaux façon « Activité » : présence, matchs joués, objectifs. */
function Rings({ rings }: { rings: { value: number; color: string; track: string }[] }) {
  return (
    <svg viewBox="0 0 200 200" className="bl-rings">
      {rings.map((r, i) => {
        const radius = 84 - i * 22;
        const c = 2 * Math.PI * radius;
        return (
          <g key={i}>
            <circle cx="100" cy="100" r={radius} fill="none" stroke={r.track} strokeWidth="18" />
            <circle
              className="ring"
              cx="100" cy="100" r={radius} fill="none" stroke={r.color} strokeWidth="18" strokeLinecap="round"
              strokeDasharray={`${c * Math.max(0.02, Math.min(1, r.value))} ${c}`} transform="rotate(-90 100 100)"
              style={{ ['--c' as string]: c, animationDelay: `${i * 180}ms` } as CSSProperties}
            />
          </g>
        );
      })}
    </svg>
  );
}

const pct = (a: number, b: number) => (b ? a / b : 0);
const n1 = (v: number) => v.toFixed(1).replace('.', ',');

export function BulletinPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isStaff, can } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useAsync(() => api.get<Bulletin>(`/bulletins/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  if (q.loading && !q.data) return <Spinner fill />;
  if (!q.data) return <div className="page">{q.error}</div>;
  const b = q.data;
  const s = b.snapshot;
  const p = b.player!;
  const team = b.team ?? { category: '', color: '#1f5b3f' };
  const staff = isStaff && can('notes.write');
  const att = pct(s.attendance.present, s.attendance.total);
  const played = pct(s.matches.played, s.matches.opportunities);
  const goalsDone = pct(s.goals.done.length, s.goals.done.length + s.goals.active.length);
  const ups = s.progress.filter((x) => x.now !== null && (x.before === null || x.now >= x.before));

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      const out = await api.patch<Bulletin>(`/bulletins/${b.id}`, body);
      q.setData({ ...b, ...out });
      toast(msg);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="bl" style={{ ['--team' as string]: team.color } as CSSProperties}>
      <header className="bl-bar no-print">
        <button className="rv-icon dark" onClick={() => nav(-1)} aria-label="Retour">
          <ArrowLeft />
        </button>
        <span className="grow" />
        {staff && !b.publishedAt && (
          <button className="btn primary sm" onClick={async () => (await confirm({ title: `Envoyer à la famille de ${p.firstName} ?`, confirm: 'Envoyer' })) && patch({ publish: true }, 'Bulletin envoyé 📘')}>
            <Send /> Envoyer
          </button>
        )}
        {staff && (
          <>
            <button className="rv-icon dark" onClick={() => setEdit(true)} aria-label="Modifier le mot">
              <Pencil />
            </button>
            <button className="rv-icon dark" onClick={() => patch({ refresh: true }, 'Chiffres mis à jour')} aria-label="Mettre à jour les chiffres">
              <RefreshCw />
            </button>
            <button
              className="rv-icon dark"
              aria-label="Supprimer"
              onClick={async () => {
                if (await confirm({ title: 'Supprimer ce bulletin ?', confirm: 'Supprimer', danger: true })) {
                  await api.del(`/bulletins/${b.id}`);
                  nav(`/joueurs/${p.id}?tab=bulletins`, { replace: true });
                }
              }}
            >
              <Trash2 />
            </button>
          </>
        )}
        <button className="rv-icon dark" onClick={() => window.print()} aria-label="Imprimer">
          <Printer />
        </button>
        {'share' in navigator && (
          <button className="rv-icon dark" onClick={() => navigator.share({ title: `Bulletin de ${p.firstName}`, url: location.href }).catch(() => undefined)} aria-label="Partager">
            <Share2 />
          </button>
        )}
      </header>

      {/* Couverture */}
      <section className="bl-hero">
        <div className="bl-mesh" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div className="bl-hero-in">
          <span className="bl-chip">{b.period}</span>
          <div className="bl-photo">
            {p.photo ? <img src={p.photo} alt={p.firstName} /> : <span>{p.firstName.slice(0, 1)}</span>}
          </div>
          <h1>{p.firstName}</h1>
          <p>
            Bulletin de progression · {team.category} · {b.club}
          </p>
          {s.positions[0] && <span className="bl-pos">{POSITION[s.positions[0]]?.label}</span>}
        </div>
      </section>

      <div className="bl-body">
        {/* Anneaux */}
        <Reveal className="bl-dark">
          <h2>Sa saison en un coup d’œil</h2>
          <div className="bl-rings-row">
            <Rings
              rings={[
                { value: att, color: '#ff2d55', track: 'rgba(255,45,85,.22)' },
                { value: played, color: '#a6ff00', track: 'rgba(166,255,0,.2)' },
                { value: goalsDone, color: '#00d9ff', track: 'rgba(0,217,255,.2)' },
              ]}
            />
            <ul className="bl-legend">
              <li style={{ color: '#ff2d55' }}>
                <small>Présence</small>
                <b>
                  {s.attendance.total ? `${Math.round(att * 100)} %` : '—'}
                  <span>
                    {s.attendance.present}/{s.attendance.total} séances
                  </span>
                </b>
              </li>
              <li style={{ color: '#a6ff00' }}>
                <small>Matchs joués</small>
                <b>
                  {s.matches.played}
                  <span>sur {s.matches.opportunities} possibles</span>
                </b>
              </li>
              <li style={{ color: '#00d9ff' }}>
                <small>Objectifs</small>
                <b>
                  {s.goals.done.length}
                  <span>atteint{s.goals.done.length > 1 ? 's' : ''}</span>
                </b>
              </li>
            </ul>
          </div>
        </Reveal>

        {/* Chiffres */}
        <Reveal className="bl-widgets">
          {[
            { v: s.matches.played, l: 'matchs', e: '🏟️', c: '#34c759' },
            { v: s.matches.minutes, l: 'minutes jouées', e: '⏱️', c: '#0a84ff' },
            { v: s.matches.goals, l: s.matches.goals > 1 ? 'buts' : 'but', e: '⚽', c: '#ff9500' },
            { v: s.matches.assists, l: s.matches.assists > 1 ? 'passes décisives' : 'passe décisive', e: '🎯', c: '#af52de' },
          ]
            .filter((w, i) => i < 2 || w.v > 0)
            .map((w) => (
            <div key={w.l} className="bl-widget" style={{ ['--c' as string]: w.c } as CSSProperties}>
              <span>{w.e}</span>
              <b>{w.v}</b>
              <small>{w.l}</small>
            </div>
          ))}
        </Reveal>

        {/* Points forts */}
        {s.strengths.length > 0 && (
          <Reveal>
            <h2>Ses super-pouvoirs</h2>
            <div className="bl-powers">
              {s.strengths.map((x, i) => {
                const sk = SKILL[x.skill];
                if (!sk) return null;
                const Icon = sk.domain.icon;
                return (
                  <div key={x.skill} className="bl-power" style={{ ['--c' as string]: sk.domain.color, animationDelay: `${i * 90}ms` } as CSSProperties}>
                    <span className="bl-power-ic">
                      <Icon size={22} filled />
                    </span>
                    <b>{sk.label}</b>
                    <small>{sk.hint}</small>
                    <Rating domain={sk.domain} value={x.v} readOnly size={20} />
                  </div>
                );
              })}
            </div>
          </Reveal>
        )}

        {/* Progrès */}
        {ups.length > 0 && (
          <Reveal>
            <h2>Ça progresse</h2>
            <div className="bl-progress">
              {ups.map((x) => {
                const d = DOMAIN[x.domain];
                const delta = x.before !== null && x.now !== null ? x.now - x.before : 0;
                const Icon = d.icon;
                return (
                  <div key={x.domain} className="bl-bar-row" style={{ ['--c' as string]: d.color } as CSSProperties}>
                    <span className="bl-bar-ic">
                      <Icon size={18} filled />
                    </span>
                    <span className="bl-bar-label">{d.label}</span>
                    <span className="bl-track">
                      {x.before !== null && <i className="before" style={{ width: `${(x.before / 5) * 100}%` }} />}
                      <i className="now" style={{ width: `${((x.now ?? 0) / 5) * 100}%` }} />
                    </span>
                    <b>{delta >= 0.1 ? `+${n1(delta)}` : n1(x.now ?? 0)}</b>
                  </div>
                );
              })}
            </div>
            <p className="bl-note">Évaluation de l’éducateur sur 5. En clair : le niveau au début de la période, en couleur : aujourd’hui.</p>
          </Reveal>
        )}

        {/* Trophées */}
        <Reveal>
          <h2>Son armoire à trophées</h2>
          {s.awards.length ? (
            <div className="bl-trophies">
              {s.awards.map((a, i) => {
                const t = TIERS[a.tier] ?? TIERS.gold;
                return (
                  <div key={i} className="bl-trophy" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="medal" style={{ background: `radial-gradient(circle at 35% 30%, ${t.from}, ${t.mid} 55%, ${t.to})`, boxShadow: `0 8px 20px -8px ${t.glow}` }}>
                      {a.emoji}
                    </span>
                    <b>{a.label}</b>
                    <small>
                      {a.title} · {formatDate(a.date, false)}
                    </small>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="bl-note">Les récompenses de match apparaîtront ici.</p>
          )}
        </Reveal>

        {/* Objectifs */}
        {(s.goals.done.length > 0 || s.goals.active.length > 0) && (
          <Reveal>
            <h2>Ses objectifs</h2>
            <div className="bl-goals">
              {s.goals.done.map((g, i) => (
                <div key={`d${i}`} className="bl-goal done">
                  <span className="seal">✓</span>
                  <b>{g.title}</b>
                  <small>Atteint 🎉</small>
                </div>
              ))}
              {s.goals.active.map((g, i) => (
                <div key={`a${i}`} className="bl-goal">
                  <span className="seal">
                    <svg viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke={g.domain ? DOMAIN[g.domain].color : 'var(--accent)'} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(g.progress / 100) * 94} 94`} transform="rotate(-90 18 18)" />
                    </svg>
                  </span>
                  <b>{g.title}</b>
                  <small>En route · {g.progress} %</small>
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* Records */}
        {s.records.length > 0 && (
          <Reveal>
            <h2>Records personnels</h2>
            <div className="bl-records">
              {s.records.map((r) => {
                const t = TEST[r.key];
                if (!t) return null;
                const gain = t.lower ? r.first - r.best : r.best - r.first;
                return (
                  <div key={r.key} className="bl-record">
                    <span>{t.emoji}</span>
                    <small>{t.label}</small>
                    <b>
                      {String(r.best).replace('.', ',')}
                      <em>{t.unit}</em>
                    </b>
                    {gain > 0 && <i>+{String(Math.round(gain * 10) / 10).replace('.', ',')} depuis le début</i>}
                  </div>
                );
              })}
            </div>
          </Reveal>
        )}

        {/* Le mot du coach */}
        {b.message && (
          <Reveal className="bl-letter-wrap">
            <div className="bl-letter">
              <small>Le mot de l’éducateur</small>
              <p>{b.message}</p>
              <span className="sign">{b.authorName}</span>
            </div>
          </Reveal>
        )}
        <p className="bl-foot">
          {b.club} · {formatDate(b.from, false)} → {formatDate(b.to, false)}
        </p>
      </div>

      {edit && (
        <MessageSheet
          value={b.message}
          onClose={() => setEdit(false)}
          onSave={async (message) => {
            await patch({ message }, 'Mot mis à jour');
            setEdit(false);
          }}
        />
      )}
    </div>
  );
}

function MessageSheet({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Sheet
      title="Le mot de l’éducateur"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={() => onSave(v)}>
          Enregistrer
        </button>
      }
    >
      <textarea className="textarea" rows={6} autoFocus value={v} onChange={(e) => setV(e.target.value)} />
    </Sheet>
  );
}
