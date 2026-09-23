import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { wrap, httpError, hashToken } from '../lib/http';
import { validate } from '../lib/validate';
import { hashPassword, verifyPassword, issueTokens, rotateRefreshToken, revokeRefreshToken } from '../lib/tokens';
import { authenticate, loadPermissionsForRole } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { env } from '../config';

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

async function serializeUser(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: true, studentProfile: { include: { course: true, department: true, semester: true, section: true } }, teacherProfile: { include: { department: true } } },
  });
  const perms = await loadPermissionsForRole(u.roleId);
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    fullName: u.fullName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    status: u.status,
    mustChangePwd: u.mustChangePwd,
    role: { id: u.role.id, name: u.role.name, label: u.role.label },
    permissions: Array.from(perms),
    student: u.studentProfile,
    teacher: u.teacherProfile,
  };
}

const loginSchema = z.object({
  identifier: z.string().min(2), // email OR username
  password: z.string().min(1),
});

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  wrap(async (req, res) => {
    const { identifier, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier }] },
      include: { role: true },
    });
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw httpError(401, 'Invalid credentials');
    }
    if (user.status !== 'ACTIVE') throw httpError(403, `Account is ${user.status.toLowerCase()}`);

    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;
    const tokens = await issueTokens(user.id, user.role.name, { userAgent: ua, ip, device: ua });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(req, 'LOGIN', 'auth', user.id, { identifier });

    res.json({ user: await serializeUser(user.id), ...tokens });
  }),
);

router.post(
  '/refresh',
  wrap(async (req, res) => {
    const token = req.body?.refreshToken;
    if (!token) throw httpError(400, 'refreshToken required');
    const result = await rotateRefreshToken(token, req.body?.role || 'USER');
    if (!result) throw httpError(401, 'Invalid refresh token');
    res.json(result);
  }),
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    const token = req.body?.refreshToken;
    if (token) await revokeRefreshToken(token);
    res.json({ ok: true });
  }),
);

router.get('/me', authenticate, wrap(async (req, res) => res.json({ user: await serializeUser(req.user!.id) })));

const changePwdSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
router.post(
  '/change-password',
  authenticate,
  validate(changePwdSchema),
  wrap(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(u.passwordHash, req.body.currentPassword))) throw httpError(400, 'Current password is incorrect');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePwd: false } });
    await audit(req, 'CHANGE_PASSWORD', 'auth', u.id);
    res.json({ ok: true });
  }),
);

// ── Forgot / Reset password ──────────────────────────────────────────────
// A real deployment emails the reset link. Here we generate a token and, in
// development, return it directly so the flow is testable end-to-end.
router.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ identifier: z.string().min(2) })),
  wrap(async (req, res) => {
    const { identifier } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier }], status: 'ACTIVE' },
    });
    // Always respond 200 to avoid user enumeration
    const generic = { ok: true, message: 'If an account exists, a password reset link has been sent.' };
    if (!user) return res.json(generic);

    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await audit(req, 'FORGOT_PASSWORD', 'auth', user.id);
    res.json(env.nodeEnv === 'production' ? generic : { ...generic, devResetToken: raw });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ token: z.string().min(10), newPassword: z.string().min(8) })),
  wrap(async (req, res) => {
    const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(req.body.token) } });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) throw httpError(400, 'Invalid or expired reset token');
    await prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePwd: false },
    });
    await prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
    await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ── Sessions ─────────────────────────────────────────────────────────────
router.get('/sessions', authenticate, wrap(async (req, res) => {
  const sessions = await prisma.userSessionInfo.findMany({
    where: { userId: req.user!.id },
    orderBy: { lastActive: 'desc' },
    select: { id: true, device: true, ip: true, lastActive: true },
  });
  res.json({ sessions });
}));

router.delete('/sessions/:id', authenticate, wrap(async (req, res) => {
  const s = await prisma.userSessionInfo.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!s) throw httpError(404, 'Session not found');
  await prisma.refreshToken.updateMany({ where: { tokenHash: s.tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.userSessionInfo.delete({ where: { id: s.id } });
  res.json({ ok: true });
}));

export default router;
