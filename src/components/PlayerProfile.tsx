import { useState } from 'react';
import { Boot, DOMAINS, POSITIONS, RATING_WORDS, type Domain } from '../lib/profile';
import type { DomainKey, Foot } from '../lib/types';

/** Échelle 1 à 5 avec l'icône du domaine (crampons pour la technique, éclairs pour le physique…). */
export function Rating({
  value, onChange, domain, size = 22, readOnly,
}: { value: number; onChange?: (v: number) => void; domain: Domain; size?: number; readOnly?: boolean }) {
  const [hover, setHover] = useState(0);
  const Icon = domain.icon;
  const shown = hover || value;
  return (
    <span className={`rating${readOnly ? ' ro' : ''}`} style={{ '--c': domain.color } as React.CSSProperties} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={() => !readOnly && setHover(n)}
          onClick={() => onChange?.(n === value ? 0 : n)}
          aria-label={`${n} sur 5 · ${RATING_WORDS[n]}`}
          title={RATING_WORDS[n]}
        >
          <Icon size={size} filled={n <= shown} />
        </button>
      ))}
    </span>
  );
}

const AXES = DOMAINS.map((d, i) => ({ d, a: -Math.PI / 2 + (i * 2 * Math.PI) / DOMAINS.length }));

function polygon(vals: Partial<Record<DomainKey, number>>, r: number, c: number) {
  return AXES.map(({ d, a }) => {
    const v = Math.max(0, Math.min(5, vals[d.key] ?? 0)) / 5;
    return `${(c + Math.cos(a) * r * v).toFixed(1)},${(c + Math.sin(a) * r * v).toFixed(1)}`;
  }).join(' ');
}

/** Radar des 5 domaines, avec en pointillés la première évaluation de la saison. */
export function Radar({ values, compare, size = 260, labels = true }: { values: Partial<Record<DomainKey, number>>; compare?: Partial<Record<DomainKey, number>> | null; size?: number; labels?: boolean }) {
  const pad = labels ? 46 : 4;
  const c = size / 2;
  const r = c - pad;
  return (
    <svg
      className="radar"
      viewBox={labels ? `-34 0 ${size + 68} ${size}` : `0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: labels ? size + 68 : size }}
      role="img"
      aria-label="Profil du joueur par domaine"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <polygon key={n} points={AXES.map(({ a }) => `${c + Math.cos(a) * r * (n / 5)},${c + Math.sin(a) * r * (n / 5)}`).join(' ')} className={`grid${n === 5 ? ' outer' : ''}`} />
      ))}
      {AXES.map(({ d, a }) => (
        <line key={d.key} x1={c} y1={c} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} className="axis" />
      ))}
      {compare && <polygon points={polygon(compare, r, c)} className="before" />}
      <polygon points={polygon(values, r, c)} className="now" />
      {AXES.map(({ d, a }) => {
        const v = values[d.key];
        if (!v) return null;
        return <circle key={d.key} cx={c + (Math.cos(a) * r * v) / 5} cy={c + (Math.sin(a) * r * v) / 5} r={labels ? 4 : 2.5} fill={d.color} />;
      })}
      {labels &&
        AXES.map(({ d, a }) => {
          const x = c + Math.cos(a) * (r + 24);
          const y = c + Math.sin(a) * (r + 20);
          const v = values[d.key];
          return (
            <g key={d.key}>
              <text x={x} y={y - 2} textAnchor="middle" className="lbl">
                {d.label}
              </text>
              <text x={x} y={y + 13} textAnchor="middle" className="val" fill={d.color}>
                {v ? v.toFixed(1).replace('.', ',') : '—'}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** Évolution d'un domaine (moyenne à chaque évaluation). */
export function Sparkline({ values, color, width = 90, height = 26 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="spark-empty" style={{ width }} />;
  const min = 1;
  const max = 5;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - min) / (max - min)) * (height - 4)).toFixed(1)}`);
  const delta = values[values.length - 1] - values[0];
  return (
    <span className="spark">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pts.at(-1)!.split(',')[0]} cy={pts.at(-1)!.split(',')[1]} r={2.8} fill={color} />
      </svg>
      {Math.abs(delta) >= 0.1 && <small className={delta > 0 ? 'pos' : 'neg'}>{delta > 0 ? '+' : ''}{delta.toFixed(1).replace('.', ',')}</small>}
    </span>
  );
}

/** Mini-terrain : postes du joueur. Le premier choisi est le poste principal. */
export function PositionPitch({ value, onChange, readOnly, compact }: { value: string[]; onChange?: (v: string[]) => void; readOnly?: boolean; compact?: boolean }) {
  const toggle = (k: string) => {
    if (!onChange) return;
    onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k].slice(0, 5));
  };
  return (
    <div className={`pos-pitch${compact ? ' compact' : ''}${readOnly ? ' ro' : ''}`}>
      <div className="mp-lines">
        <i className="mid" />
        <i className="circle" />
        <i className="box top" />
        <i className="box bottom" />
      </div>
      {POSITIONS.map((p) => {
        const idx = value.indexOf(p.key);
        if (readOnly && idx < 0) return null;
        return (
          <button
            key={p.key}
            type="button"
            className={`pos-dot${idx === 0 ? ' main' : idx > 0 ? ' on' : ''}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onClick={() => toggle(p.key)}
            disabled={readOnly}
            title={p.label}
          >
            {p.key}
          </button>
        );
      })}
    </div>
  );
}

/** Pied fort : deux crampons à toucher. */
export function FootPicker({ foot, onChange, readOnly }: { foot: Foot; onChange?: (f: Foot) => void; readOnly?: boolean }) {
  const has = (side: 'gauche' | 'droit') => foot === side || foot === 'deux';
  const tap = (side: 'gauche' | 'droit') => {
    if (!onChange) return;
    const other = side === 'gauche' ? 'droit' : 'gauche';
    if (foot === 'deux') onChange(other);
    else if (foot === side) onChange('');
    else if (foot === other) onChange('deux');
    else onChange(side);
  };
  return (
    <div className="feet">
      {(['gauche', 'droit'] as const).map((side) => (
        <button key={side} type="button" className={`foot ${side}${has(side) ? ' on' : ''}`} disabled={readOnly} onClick={() => tap(side)} aria-pressed={has(side)}>
          <Boot size={40} filled={has(side)} />
          <span>{side === 'gauche' ? 'Gauche' : 'Droit'}</span>
        </button>
      ))}
    </div>
  );
}

/** Progression d'un objectif en 5 crans (0, 25, 50, 75, 100 %). */
export function ProgressSteps({ value, onChange, color = 'var(--accent)' }: { value: number; onChange?: (v: number) => void; color?: string }) {
  const labels = ['Pas commencé', 'Premiers signes', 'À mi-chemin', 'Presque', 'Atteint'];
  return (
    <div className={`psteps${onChange ? '' : ' ro'}`} style={{ '--c': color } as React.CSSProperties}>
      {[0, 25, 50, 75, 100].map((v, i) => (
        <button key={v} type="button" disabled={!onChange} className={v <= value ? 'on' : ''} onClick={() => onChange?.(v)} title={labels[i]} aria-label={labels[i]}>
          <i />
        </button>
      ))}
      <span>{labels[value / 25]}</span>
    </div>
  );
}
