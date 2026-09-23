import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import {
  User, Role, StudentProfile, TeacherProfile, PasswordResetToken, RefreshToken, UserSessionInfo,
} from '../models';
import { wrap, httpError, hashToken, oid } from '../lib/http';
import { validate } from '../lib/validate';
import { hashPassword, verifyPassword, issueTokens, rotateRefreshToken, revokeRefreshToken } from '../lib/tokens';
import { authenticate, loadPermissionsForRole } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { env } from '../config';

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

async function serializeUser(userId: string) {
  const u = await User.findById(userId).populate({ path: 'roleId', as: 'role', select: 'name label' });
  if (!u) throw httpError(404, 'User not found');
  const role: any = (u as any).toJSON().role;
  const perms = await loadPermissionsForRole(role.id);

  const student = await StudentProfile.findOne({ userId: u._id }).populate([
    { path: 'courseId', as: 'course', select: 'name code' },
    { path: 'departmentId', as: 'department', select: 'name code' },
    { path: 'semesterId', as: 'semester', select: 'number' },
    { path: 'sectionId', as: 'section', select: 'name' },
  ]);
  const teacher = await TeacherProfile.findOne({ userId: u._id }).populate({
    path: 'departmentId', as: 'department', select: 'name code',
  });

  return {
    id: String(u._id),
    email: u.email,
    username: u.username,
    fullName: u.fullName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    status: u.status,
    mustChangePwd: u.mustChangePwd,
    role: { id: role.id, name: role.name, label: role.label },
    permissions: Array.from(perms),
    student: student ? student.toJSON() : null,
    teacher: teacher ? teacher.toJSON() : null,
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
    const user = await User.findOne({
      $or: [{ email: String(identifier).toLowerCase() }, { username: identifier }],
    }).populate({ path: 'roleId', as: 'role', select: 'name' });
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw httpError(401, 'Invalid credentials');
    }
    if (user.status !== 'ACTIVE') throw httpError(403, `Account is ${user.status.toLowerCase()}`);

    const role: any = (user as any).toJSON().role;
    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;
    const tokens = await issueTokens(String(user._id), role.name, { userAgent: ua, ip, device: ua });
    await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
    await audit(req, 'LOGIN', 'auth', String(user._id), { identifier });

    res.json({ user: await serializeUser(String(user._id)), ...tokens });
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
    const u = await User.findById(req.user!.id);
    if (!u) throw httpError(404, 'User not found');
    if (!(await verifyPassword(u.passwordHash, req.body.currentPassword))) throw httpError(400, 'Current password is incorrect');
    u.passwordHash = await hashPassword(req.body.newPassword);
    u.mustChangePwd = false;
    await u.save();
    await audit(req, 'CHANGE_PASSWORD', 'auth', String(u._id));
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
    const user = await User.findOne({
      $or: [{ email: String(identifier).toLowerCase() }, { username: identifier }],
      status: 'ACTIVE',
    });
    // Always respond 200 to avoid user enumeration
    const generic = { ok: true, message: 'If an account exists, a password reset link has been sent.' };
    if (!user) return res.json(generic);

    const raw = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user._id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await audit(req, 'FORGOT_PASSWORD', 'auth', String(user._id));
    res.json(env.nodeEnv === 'production' ? generic : { ...generic, devResetToken: raw });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ token: z.string().min(10), newPassword: z.string().min(8) })),
  wrap(async (req, res) => {
    const stored = await PasswordResetToken.findOne({ tokenHash: hashToken(req.body.token) });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) throw httpError(400, 'Invalid or expired reset token');
    await User.updateOne(
      { _id: stored.userId },
      { passwordHash: await hashPassword(req.body.newPassword), mustChangePwd: false },
    );
    await PasswordResetToken.updateOne({ _id: stored._id }, { usedAt: new Date() });
    await RefreshToken.updateMany({ userId: stored.userId, revokedAt: null }, { revokedAt: new Date() });
    res.json({ ok: true });
  }),
);

// ── Sessions ─────────────────────────────────────────────────────────────
router.get('/sessions', authenticate, wrap(async (req, res) => {
  const sessions = await UserSessionInfo.find({ userId: oid(req.user!.id) })
    .sort({ lastActive: -1 })
    .select('device ip lastActive');
  res.json({ sessions: sessions.map((s: any) => s.toJSON()) });
}));

router.delete('/sessions/:id', authenticate, wrap(async (req, res) => {
  const s = await UserSessionInfo.findOne({ _id: oid(req.params.id), userId: oid(req.user!.id) });
  if (!s) throw httpError(404, 'Session not found');
  await RefreshToken.updateMany({ tokenHash: s.tokenHash, revokedAt: null }, { revokedAt: new Date() });
  await UserSessionInfo.deleteOne({ _id: s._id });
  res.json({ ok: true });
}));

export default router;
