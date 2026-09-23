import mongoose from 'mongoose';
import { Resolver } from 'node:dns/promises';
import { env } from '../config';

/**
 * Some environments (notably certain Windows resolvers) refuse the SRV lookup
 * that `mongodb+srv://` needs, even though the cluster is reachable. We resolve
 * SRV/TXT ourselves and rebuild an equivalent standard seedlist URI (with TLS,
 * which Atlas always requires). On hosts where native SRV works, this is a no-op
 * fast path; on hosts where it doesn't, it transparently repairs the connection.
 */
async function normalizeUri(raw: string): Promise<string> {
  if (!raw.startsWith('mongodb+srv://')) return raw;
  const m = raw.match(/^mongodb\+srv:\/\/([^@/]+)@([^/?]+)(\/[^?]*)?\??(.*)$/);
  if (!m) return raw;
  const [, creds, host, pathPart = '', query = ''] = m;

  const lookup = async (servers?: string[]) => {
    const r = new Resolver();
    if (servers) r.setServers(servers);
    const srv = await r.resolveSrv(`_mongodb._tcp.${host}`);
    let txt = '';
    try {
      txt = (await r.resolveTxt(host)).map((a) => a.join('')).join('&');
    } catch {
      /* TXT optional */
    }
    return { seeds: srv.map((s) => `${s.name}:${s.port}`).join(','), txt };
  };

  let resolved;
  try {
    resolved = await lookup();
  } catch {
    resolved = await lookup(['8.8.8.8', '1.1.1.1']);
  }

  const params = new URLSearchParams();
  for (const seg of `${resolved.txt}&${query}`.split('&')) {
    if (!seg) continue;
    const [k, v = ''] = seg.split('=');
    params.set(k, v);
  }
  params.set('tls', 'true');
  return `mongodb://${creds}@${resolved.seeds}${pathPart}?${params.toString()}`;
}

export async function connectDb(): Promise<void> {
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example → server/.env and fill it in.');
  }
  const uri = await normalizeUri(env.mongoUri);
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    dbName: env.mongoDbName,
  });
  console.log(`🗄️  MongoDB connected (db: ${env.mongoDbName})`);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export const db = mongoose;
export default mongoose;
