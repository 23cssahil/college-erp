import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '../components/ui';

/** Gate a route behind auth + (optionally) a permission key. */
export function Protected({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner full />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (permission && !can(permission)) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}
