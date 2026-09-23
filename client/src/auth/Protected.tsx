import { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '../components/ui';

/** Gate a route behind auth + (optionally) a permission key. */
export function Protected({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner full />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (permission && !can(permission)) return <NotAuthorised permission={permission} />;
  return <>{children}</>;
}

/** Shown in place of the page (inside the app layout) when the role lacks the permission. */
function NotAuthorised({ permission }: { permission: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="rounded-2xl border border-rose-100 bg-white p-8 shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-3xl">🚫</div>
        <h2 className="mt-4 text-xl font-extrabold text-slate-800">You are not authorised</h2>
        <p className="mt-2 text-sm text-slate-500">
          Your role doesn't include the <span className="font-semibold text-slate-600">{permission}</span> permission.
          Ask a Super Admin to grant it under <span className="font-semibold">Roles &amp; Permissions</span>.
        </p>
        <Link to="/" className="btn-primary mt-6 inline-block">Back to my dashboard</Link>
      </div>
    </div>
  );
}
