import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { NAV_ITEMS } from '../lib/nav';
import { Modal } from '../components/ui';

const SECTIONS = ['Overview', 'People', 'Academics', 'Operations', 'Content', 'System'];

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '' });
  const [pwdMsg, setPwdMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = NAV_ITEMS.filter((n) => n.permission === '*' || can(n.permission));
  const roleLabel = user?.role?.label || user?.role?.name || '';

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setPwdMsg('');
    try {
      await api.post('/auth/change-password', pwd);
      setPwdOpen(false); setPwd({ currentPassword: '', newPassword: '' });
    } catch (err: any) {
      setPwdMsg(err?.response?.data?.error || 'Failed to change password');
    } finally { setBusy(false); }
  }

  async function signOut() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {SECTIONS.map((sec) => {
        const items = visible.filter((n) => n.section === sec);
        if (!items.length) return null;
        return (
          <div key={sec}>
            <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{sec}</div>
            {items.map((n) => (
              <NavLink key={n.path} to={n.path} end={n.path === '/'} onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `mb-0.5 block rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}>
                {n.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white">C</div>
      <div>
        <div className="text-sm font-extrabold leading-tight text-slate-800">College ERP</div>
        <div className="text-[11px] text-slate-400">Campus Management</div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {brand}
        {sidebar}
        <div className="border-t border-slate-100 p-3 text-[11px] text-slate-400">v1.0 · {roleLabel}</div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-2xl">
            {brand}
            {sidebar}
          </aside>
        </div>
      )}

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <button className="btn-ghost !px-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">☰</button>
          <div className="hidden text-sm text-slate-500 sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {user?.mustChangePwd && (
              <button onClick={() => setPwdOpen(true)}
                className="badge bg-amber-100 text-amber-700 hover:bg-amber-200" title="You must change your password">
                ⚠ Change password
              </button>
            )}
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-slate-700">{user?.fullName}</div>
              <div className="text-[11px] text-slate-400">{roleLabel}</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {user?.fullName?.slice(0, 1).toUpperCase()}
            </div>
            <button onClick={() => setPwdOpen(true)} className="btn-ghost !px-2 text-xs" title="Change password">🔒</button>
            <button onClick={signOut} className="btn-secondary !px-3 !py-1.5 text-xs">Sign out</button>
          </div>
        </header>

        {user?.mustChangePwd && !pwdOpen && (
          <div className="bg-amber-50 px-4 py-2 text-sm text-amber-700 ring-1 ring-amber-100">
            You're using a temporary password. Please <button className="underline font-semibold" onClick={() => setPwdOpen(true)}>change it</button> to secure your account.
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Change Password">
        <form onSubmit={changePassword} className="space-y-4">
          {pwdMsg && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{pwdMsg}</div>}
          <div>
            <label className="label">Current password</label>
            <input type="password" required className="input" value={pwd.currentPassword}
              onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} />
          </div>
          <div>
            <label className="label">New password <span className="text-slate-400">(min 8 characters)</span></label>
            <input type="password" required minLength={8} className="input" value={pwd.newPassword}
              onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPwdOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
