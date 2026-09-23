import { ReactNode, useEffect } from 'react';
import clsx from 'clsx';

/* ── Spinner ─────────────────────────────────────────────── */
export function Spinner({ full }: { full?: boolean }) {
  const s = (
    <div className="flex items-center gap-3 text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      <span className="text-sm">Loading…</span>
    </div>
  );
  if (full) return <div className="grid min-h-screen place-items-center bg-slate-50">{s}</div>;
  return <div className="grid place-items-center py-16">{s}</div>;
}

/* ── Card ────────────────────────────────────────────────── */
export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <div className={clsx('card', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-base font-bold text-slate-800">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────── */
const toneMap: Record<string, string> = {
  good: 'from-emerald-500 to-teal-600',
  warn: 'from-amber-500 to-orange-600',
  bad: 'from-rose-500 to-red-600',
  info: 'from-brand-500 to-indigo-600',
};
export function StatCard({ label, value, tone = 'info' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="card overflow-hidden !p-0">
      <div className={clsx('h-1.5 w-full bg-gradient-to-r', toneMap[tone] || toneMap.info)} />
      <div className="p-4">
        <div className="text-2xl font-extrabold text-slate-800">{value}</div>
        <div className="mt-0.5 text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

/* ── Badge ───────────────────────────────────────────────── */
const badgeTones: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  red: 'bg-rose-100 text-rose-700',
  amber: 'bg-amber-100 text-amber-700',
  blue: 'bg-brand-100 text-brand-700',
  slate: 'bg-slate-100 text-slate-600',
  violet: 'bg-violet-100 text-violet-700',
};
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: string }) {
  return <span className={clsx('badge', badgeTones[tone] || badgeTones.slate)}>{children}</span>;
}

/* ── Button ──────────────────────────────────────────────── */
export function Button({ children, variant = 'primary', className, ...props }: any) {
  const map = { primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-danger', ghost: 'btn-ghost' };
  return (
    <button className={clsx(map[variant as keyof typeof map], className)} {...props}>
      {children}
    </button>
  );
}

/* ── Modal ───────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── Form field primitives ───────────────────────────────── */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextInput(props: any) { return <input className="input" {...props} />; }
export function Select(props: any) { return <select className="input" {...props} />; }
export function TextArea(props: any) { return <textarea className="input min-h-[90px]" {...props} />; }

/* ── Empty state ─────────────────────────────────────────── */
export function Empty({ text = 'Nothing to show yet' }: { text?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-200 py-16 text-slate-400">
      <div className="text-center">
        <div className="mb-2 text-3xl">🗂️</div>
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}

/* ── Page header ─────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ── Alert / toast-ish banner ────────────────────────────── */
export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const map = { error: 'bg-rose-50 text-rose-700 ring-rose-200', success: 'bg-emerald-50 text-emerald-700 ring-emerald-200', info: 'bg-brand-50 text-brand-700 ring-brand-200' };
  return <div className={clsx('mb-4 rounded-lg px-4 py-2.5 text-sm ring-1', map[kind])}>{children}</div>;
}
