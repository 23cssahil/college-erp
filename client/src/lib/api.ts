import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const ACCESS_KEY = 'erp_access';
const REFRESH_KEY = 'erp_refresh';

export const tokenStore = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(tokens: { accessToken: string; refreshToken: string }) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  setAccess(t: string) { localStorage.setItem(ACCESS_KEY, t); },
  clear() { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); },
};

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  const rt = tokenStore.refresh;
  if (!rt) return false;
  try {
    const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken: rt });
    tokenStore.setAccess(data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return true;
  } catch {
    tokenStore.clear();
    return false;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !original._retry && tokenStore.refresh) {
      original._retry = true;
      refreshing = refreshing || doRefresh();
      const ok = await refreshing;
      refreshing = null;
      if (ok) {
        original.headers.Authorization = `Bearer ${tokenStore.access}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

/** Normalize an axios error into a readable message. */
export function errMsg(e: any): string {
  return e?.response?.data?.error || e?.message || 'Something went wrong';
}
