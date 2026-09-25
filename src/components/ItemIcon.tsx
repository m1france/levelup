import type { ItemKind } from '../lib/types';
import { colorHex } from '../pitch/geometry';

export type IconKind = ItemKind | 'line' | 'square' | 'circle' | 'slalom' | 'grid';

const SHIRT = 'M9.3 4.2Q12 6.6 14.7 4.2L17.6 5 21 8.3 18.8 11.2 16.9 9.9V19.4Q16.9 20.2 16.1 20.2H7.9Q7.1 20.2 7.1 19.4V9.9L5.2 11.2 3 8.3 6.4 5Z';

/** Pictogrammes de la palette, dessinés comme sur le terrain. */
export function ItemIcon({ kind, color }: { kind: IconKind; color?: string }) {
  const c = color ? colorHex(color) : undefined;
  const stroke = 'currentColor';
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' as const };
  const cone = (cx: number, cy: number, r = 2.3) => (
    <g key={`${cx}-${cy}`}>
      <circle cx={cx} cy={cy} r={r} fill="#f76707" />
      <circle cx={cx} cy={cy} r={r * 0.42} fill="#2f6444" opacity=".55" />
    </g>
  );
  switch (kind) {
    case 'player':
      return (
        <svg {...common}>
          <path d={SHIRT} fill={c ?? '#3b5bdb'} stroke="rgba(0,0,0,.25)" strokeWidth=".8" strokeLinejoin="round" />
          <path d="M9.3 4.2Q12 6.6 14.7 4.2" stroke="rgba(0,0,0,.3)" strokeWidth="1.2" />
          <text x="12" y="16.4" textAnchor="middle" fontSize="7" fontWeight="800" fill={color === 'white' || color === 'yellow' ? '#1c1c1c' : '#fff'}>
            7
          </text>
        </svg>
      );
    case 'coach':
      return (
        <svg {...common}>
          <rect x="8.4" y="15.5" width="2.6" height="6" rx="1" fill="#16171a" />
          <rect x="13" y="15.5" width="2.6" height="6" rx="1" fill="#16171a" />
          <path d="M7.4 9.4Q7.4 8 9 8h6q1.6 0 1.6 1.4l-.4 7H7.8z" fill="#25262b" />
          <path d="M12 8.4v7.8" stroke="#fff" strokeWidth=".7" opacity=".8" />
          <rect x="13.6" y="10.4" width="4.6" height="5.6" rx=".6" fill="#8a5a34" transform="rotate(-8 15.9 13.2)" />
          <rect x="14.1" y="11.1" width="3.6" height="4.4" fill="#fbfaf5" transform="rotate(-8 15.9 13.2)" />
          <circle cx="12" cy="5.2" r="2.6" fill="#e9b48f" />
          <path d="M9.3 4.9a2.7 2.7 0 0 1 5.4 0z" fill="#25262b" />
          <path d="M11.5 4.4h4.6" stroke="#25262b" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case 'ball':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.5" fill="#fff" stroke="#1c1c1c" strokeWidth="1.3" />
          <path d="M12 8.8l3 2.2-1.1 3.5h-3.8L9 11z" fill="#1c1c1c" />
          <path d="M12 8.8V4.6M15 11l4-1.3M13.9 14.5l2.4 3.4M10.1 14.5l-2.4 3.4M9 11 5 9.7" stroke="#1c1c1c" strokeWidth=".9" />
        </svg>
      );
    case 'ballbag':
      return (
        <svg {...common}>
          {[[9, 10], [15, 10], [12, 15], [8, 15.5], [16, 15.5]].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="3" fill="#fff" stroke="#1c1c1c" strokeWidth=".9" />
          ))}
          <ellipse cx="12" cy="13" rx="8.4" ry="7.6" stroke={stroke} strokeWidth="1.2" strokeDasharray="1.6 1.4" />
        </svg>
      );
    case 'cone':
      return <svg {...common}>{cone(12, 12, 6.5)}</svg>;
    case 'marker':
      return (
        <svg {...common}>
          <path d="M5.5 19.2h13l-1 1.6h-11z" fill={c ?? '#f76707'} opacity=".6" />
          <path d="M11.1 3.6q.9-.8 1.8 0l5 15.1q-5.9 1.3-11.8 0z" fill={c ?? '#f76707'} />
          <path d="M9.2 9.2h5.6l.6 2H8.6zM7.7 14h8.6l.4 1.6H7.3z" fill="#fff" opacity=".9" />
        </svg>
      );
    case 'pole':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="20.2" rx="4.2" ry="1.4" fill="#26282c" />
          <rect x="10.8" y="2.6" width="2.4" height="17.4" rx="1.2" fill={c ?? '#f5c518'} />
          <path d="M10.8 7h2.4M10.8 12h2.4" stroke="#fff" strokeWidth="1.2" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...common}>
          <ellipse cx="7" cy="20.4" rx="3" ry="1.1" fill="#26282c" />
          <rect x="6.3" y="2.6" width="1.4" height="17.6" rx=".7" fill={stroke} opacity=".7" />
          <path d="M7.6 3.4c3-1.2 5.4 1 9.8-.2v6.4c-4.4 1.2-6.8-1-9.8.2z" fill={c ?? '#e03131'} />
        </svg>
      );
    case 'hoop':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.2" stroke={c ?? '#f5c518'} strokeWidth="2.4" />
        </svg>
      );
    case 'hurdle':
      return (
        <svg {...common}>
          <path d="M6 20V9.5M18 20V9.5" stroke="#8a3a05" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 20h4M16 20h4" stroke="#8a3a05" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="4.5" y="7.8" width="15" height="3.2" rx="1.2" fill={c ?? '#f76707'} />
          <path d="M9 7.8v3.2M15 7.8v3.2" stroke="#fff" strokeWidth="1.1" />
        </svg>
      );
    case 'ladder':
      return (
        <svg {...common}>
          <path d="M2.5 8h19M2.5 16h19" stroke="#2b2d31" strokeWidth="1.4" strokeLinecap="round" />
          {[4.5, 8.5, 12.5, 16.5, 20].map((x) => (
            <rect key={x} x={x - 0.9} y="7" width="1.8" height="10" rx=".6" fill={c ?? '#f5c518'} />
          ))}
        </svg>
      );
    case 'minigoal':
      return (
        <svg {...common}>
          <path d="M6 18V8.5l3-2.5h9v9.5L15 18" stroke={stroke} strokeWidth=".8" opacity=".5" />
          <path d="M6 8.5h9V18M15 8.5l3-2.5" stroke={stroke} strokeWidth=".8" opacity=".5" />
          <path d="M6 18V8.5h9V18" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <path d="M8 8.5 15 16M11 8.5 15 13M6 11.5 12.5 18M6 15l3 3M13 8.5l2 2.2M6 8.5l9 9.5" stroke={stroke} strokeWidth=".6" opacity=".45" />
        </svg>
      );
    case 'goal':
      return (
        <svg {...common}>
          <path d="M3 19V7h18v12" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M3 7l2.5-2.5h13L21 7M5.5 4.5V17M18.5 4.5V17" stroke={stroke} strokeWidth=".8" opacity=".5" />
          <path d="M6 7l12 12M10 7l9 9M14 7l7 7M3 10l9 9M3 14l5 5M18 7 6 19M14 7l-9 9M10 7 3 14M21 10l-9 9M21 14l-5 5" stroke={stroke} strokeWidth=".5" opacity=".4" />
        </svg>
      );
    case 'rebounder':
      return (
        <svg {...common}>
          <path d="M6 19 4 22M18 19l2 3" stroke="#2b2d31" strokeWidth="1.4" strokeLinecap="round" />
          <rect x="4" y="4" width="16" height="15" rx="2" stroke={c ?? '#3b5bdb'} strokeWidth="2.2" />
          <path d="M5 8h14M5 11.5h14M5 15h14M8 5v13M12 5v13M16 5v13" stroke={stroke} strokeWidth=".6" opacity=".45" />
        </svg>
      );
    case 'dummy':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="21" rx="4" ry="1.2" fill="#26282c" />
          <path d="M11.5 16h1v5h-1z" fill="#9ea3a8" />
          <circle cx="12" cy="4.6" r="2.2" fill={c ?? '#f5c518'} />
          <path d="M10.4 7.2Q6.8 7.2 7 9.6l1.6 7.2q3.4.9 6.8 0L17 9.6q.2-2.4-3.4-2.4z" fill={c ?? '#f5c518'} stroke="rgba(0,0,0,.3)" strokeWidth=".6" />
        </svg>
      );
    case 'wall':
      return (
        <svg {...common}>
          <path d="M2 20.5h20" stroke="#26282c" strokeWidth="1.6" strokeLinecap="round" />
          {[5, 12, 19].map((x) => (
            <g key={x} fill={c ?? '#f5c518'} stroke="rgba(0,0,0,.3)" strokeWidth=".5">
              <circle cx={x} cy="6" r="1.7" />
              <path d={`M${x - 1.3} 8.2q-2.4 0-2.3 1.8l1.1 8.6q2.5.7 5 0l1.1-8.6q.1-1.8-2.3-1.8z`} />
            </g>
          ))}
        </svg>
      );
    case 'zone':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="1" stroke={stroke} strokeWidth="1.6" strokeDasharray="3 2.4" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'measure':
      return (
        <svg {...common}>
          <path d="M3.5 8.5v7M20.5 8.5v7M4 12h16" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 12l3-2.2v4.4zM20 12l-3-2.2v4.4z" fill={stroke} />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          {[4, 9, 14, 19].map((x) => cone(x + 0.5, 19.5 - (x - 4) * 0.9, 2.2))}
        </svg>
      );
    case 'square':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" stroke={stroke} strokeWidth="1" opacity=".35" />
          {[[5, 5], [19, 5], [19, 19], [5, 19]].map(([x, y]) => cone(x, y, 2.4))}
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.5" stroke={stroke} strokeWidth="1" opacity=".35" />
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i * Math.PI) / 3 - Math.PI / 2;
            return cone(12 + Math.cos(a) * 7.5, 12 + Math.sin(a) * 7.5, 2);
          })}
        </svg>
      );
    case 'slalom':
      return (
        <svg {...common}>
          <path d="M3 18c3-9 5 3 9-6s6 3 9-6" stroke={stroke} strokeWidth="1.2" strokeDasharray="2 1.6" opacity=".6" />
          {[[5, 9], [10, 16], [15, 8], [20, 15]].map(([x, y]) => (
            <g key={x}>
              <rect x={x - 0.9} y={y - 6} width="1.8" height="7" rx=".9" fill="#f5c518" />
              <ellipse cx={x} cy={y + 1.2} rx="1.8" ry=".6" fill="#26282c" />
            </g>
          ))}
        </svg>
      );
    case 'grid':
      return (
        <svg {...common}>
          {[5, 12, 19].flatMap((x) => [5, 12, 19].map((y) => cone(x, y, 1.9)))}
        </svg>
      );
  }
}
