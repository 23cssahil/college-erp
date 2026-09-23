import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, errMsg } from '../lib/api';

function Shell({ children, title, sub }: { children: any; title: string; sub?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-800 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-2xl font-black backdrop-blur">C</div>
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {sub && <p className="mt-1 text-sm text-brand-100">{sub}</p>}
        </div>
        <div className="card !p-6 sm:!p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-brand-200">College ERP · secure role-based access</p>
      </div>
    </div>
  );
}

export function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await login(form.identifier.trim(), form.password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
      void u;
    } catch (err) {
      setError(errMsg(err));
    } finally { setBusy(false); }
  }

  return (
    <Shell title="College ERP" sub="Sign in with your college email, username or roll number">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div>}
        <div>
          <label className="label">Email / Username</label>
          <input className="input" autoFocus value={form.identifier} required
            onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="you@college.edu" />
        </div>
        <div>
          <label className="label">Password</label>
          <input type="password" className="input" value={form.password} required
            onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link>
        </div>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier });
      setResult(data);
    } catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Forgot Password" sub="We'll send you a link to reset your password">
      {result?.devResetToken ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">{result.message}</div>
          <div className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
            <p className="mb-2 font-semibold text-slate-600">Development mode — reset token:</p>
            <code className="break-all text-xs text-brand-700">{result.devResetToken}</code>
            <Link to={`/reset-password?token=${result.devResetToken}`} className="btn-primary mt-3 w-full">Set a new password →</Link>
          </div>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">{result.message}</div>
          <Link to="/login" className="btn-secondary w-full">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div>}
          <div>
            <label className="label">Email / Username</label>
            <input className="input" autoFocus value={identifier} required
              onChange={(e) => setIdentifier(e.target.value)} placeholder="you@college.edu" />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <Link to="/login" className="block text-center text-sm text-slate-500 hover:underline">Back to sign in</Link>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const [form, setForm] = useState({ token: params.get('token') || '', newPassword: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/reset-password', form);
      setDone(true);
    } catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Reset Password" sub="Choose a strong new password (min 8 characters)">
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">
            Password updated successfully. You can now sign in.
          </div>
          <Link to="/login" className="btn-primary w-full">Go to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div>}
          <div>
            <label className="label">Reset token</label>
            <input className="input" required value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </div>
          <div>
            <label className="label">New password</label>
            <input type="password" minLength={8} className="input" required value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      )}
    </Shell>
  );
}

export function Unauthorized() {
  return (
    <Shell title="Access denied" sub="Your role doesn't include permission for this page">
      <div className="space-y-4 text-center">
        <div className="text-5xl">🚫</div>
        <p className="text-sm text-slate-500">If you believe this is a mistake, contact your college administrator.</p>
        <Link to="/" className="btn-primary w-full">Back to my dashboard</Link>
      </div>
    </Shell>
  );
}

export function NotFound() {
  return (
    <Shell title="Page not found">
      <div className="space-y-4 text-center">
        <div className="text-5xl">🔍</div>
        <Link to="/" className="btn-primary w-full">Go home</Link>
      </div>
    </Shell>
  );
}
