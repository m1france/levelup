import { X } from 'lucide-react';
import { createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Sheet({
  title, onClose, children, footer, wide,
}: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Fermer">
              <X />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  // <label> seulement autour d'un champ unique : autour de boutons, un clic dans le vide activerait le premier.
  const single = isValidElement(children) && typeof children.type === 'string' && ['input', 'textarea', 'select'].includes(children.type);
  const Tag = single ? 'label' : 'div';
  return (
    <Tag className="field">
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
    </Tag>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Spinner({ fill }: { fill?: boolean }) {
  return fill ? (
    <div className="center-fill">
      <div className="spinner" />
    </div>
  ) : (
    <div className="spinner" />
  );
}

export function initials(name: string) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const AVATAR_TINTS = ['#e4eee7', '#e7ecfb', '#fbf1df', '#f3e8fd', '#e3f4f7', '#fde8ec', '#eef3dc'];
const AVATAR_INKS = ['#1f5b3f', '#3653c4', '#a86b12', '#7c3aed', '#0e7490', '#be185d', '#4d7c0f'];
export function Avatar({ name, size }: { name: string; size?: 'sm' | 'lg' }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const i = h % AVATAR_TINTS.length;
  return (
    <span className={`avatar${size ? ` ${size}` : ''}`} style={{ background: AVATAR_TINTS[i], color: AVATAR_INKS[i] }}>
      {initials(name)}
    </span>
  );
}

export function Seg<T extends string | number>({
  value, options, onChange,
}: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */

interface Toast { id: number; text: string; error?: boolean }
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, error?: boolean) => {
    const id = ++n.current;
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 4200 : 2400);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ confirmation */

type ConfirmOpts = { title: string; text?: string; confirm?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Sheet
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => close(false)}>
                Annuler
              </button>
              <button className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                {state.confirm ?? 'Confirmer'}
              </button>
            </>
          }
        >
          {state.text && <p className="muted">{state.text}</p>}
        </Sheet>
      )}
    </ConfirmCtx.Provider>
  );
}

/** Menu contextuel simple, positionné sous le bouton déclencheur. */
export function Menu({ trigger, children }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className="menu" style={{ right: 0, top: 'calc(100% + 6px)' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, setData, error, loading, reload: () => setTick((t) => t + 1) };
}
