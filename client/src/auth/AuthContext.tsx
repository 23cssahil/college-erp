import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api, tokenStore } from '../lib/api';
import type { SessionUser } from '../lib/types';

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tokenStore.access) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const login = async (identifier: string, password: string) => {
    const { data } = await api.post('/auth/login', { identifier, password });
    tokenStore.set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
    return data.user as SessionUser;
  };

  const logout = async () => {
    try { await api.post('/auth/logout', { refreshToken: tokenStore.refresh }); } catch { /* ignore */ }
    tokenStore.clear();
    setUser(null);
  };

  const can = (permission: string) => {
    if (!user) return false;
    if (user.permissions.includes('*:*')) return true;
    if (user.permissions.includes(permission)) return true;
    const mod = permission.split(':')[0];
    return user.permissions.includes(`${mod}:*`);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh: load, can }}>{children}</Ctx.Provider>;
}
