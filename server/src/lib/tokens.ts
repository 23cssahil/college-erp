import argon2 from 'argon2';
import crypto from 'crypto';
import { prisma } from './prisma';
import { env } from '../config';
import { hashToken, signAccessToken } from './http';

export const hashPassword = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain);

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** Issue an access token + a rotating refresh token (stored hashed). */
export async function issueTokens(
  userId: string,
  role: string,
  meta: { userAgent?: string; ip?: string; device?: string } = {},
): Promise<IssuedTokens> {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = crypto.randomBytes(48).toString('hex');

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId,
      expiresAt: new Date(Date.now() + env.refreshDays * 24 * 60 * 60 * 1000),
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
    },
  });
  await prisma.userSessionInfo.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      device: meta.device?.slice(0, 200),
      ip: meta.ip,
    },
  });

  return { accessToken, refreshToken };
}

/** Rotate: consume an old refresh token and mint a new pair. */
export async function rotateRefreshToken(oldToken: string, role: string) {
  const hash = hashToken(oldToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  await prisma.userSessionInfo.deleteMany({ where: { tokenHash: hash } });

  const tokens = await issueTokens(stored.userId, role, { ip: stored.ip || undefined });
  return { userId: stored.userId, ...tokens };
}

export async function revokeRefreshToken(token: string) {
  const hash = hashToken(token);
  await prisma.refreshToken.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.userSessionInfo.deleteMany({ where: { tokenHash: hash } });
}
