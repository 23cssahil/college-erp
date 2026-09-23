import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds } from '../middleware/scope';
import { upload } from '../lib/upload';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ NOTICES ══════════════════════ */
// Visibility filter for the current user based on their context.
async function visibleNoticeWhere(user: any) {
  const and: any[] = [
    { OR: [{ publishAt: { lte: new Date() } }, { publishAt: null }] },
    { OR: [{ expiryAt: null }, { expiryAt: { gte: new Date() } }] },
  ];
  // audience targeting: a notice is visible if it has NO rows for that dimension,
  // or matches the user's role / department / course / section.
  const roleFilter: any = { rolesVisible: { some: { id: user.roleId } } };
  const deptFilter: any = {};
  const courseFilter: any = {};
  const sectionFilter: any = {};
  let student: any = null;
  let childrenIds: string[] = [];
  if (user.role === 'STUDENT') student = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  if (user.role === 'PARENT') childrenIds = await getParentChildStudentIds(user);

  if (student) {
    deptFilter.departmentId = student.departmentId;
    courseFilter.courseId = student.courseId;
    if (student.sectionId) sectionFilter.sectionId = student.sectionId;
  } else if (user.role === 'HOD') {
    const d = await prisma.department.findFirst({ where: { hodId: user.id } });
    if (d) deptFilter.departmentId = d.id;
  } else if (user.role === 'TEACHER') {
    const t = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });
    if (t) deptFilter.departmentId = t.departmentId;
  }

  const audience: any = { OR: [roleFilter] };
  if (Object.keys(deptFilter).length) audience.OR.push({ deptsVisible: { some: deptFilter } });
  if (Object.keys(courseFilter).length) audience.OR.push({ coursesVisible: { some: courseFilter } });
  if (Object.keys(sectionFilter).length) audience.OR.push({ sectionsVisible: { some: sectionFilter } });

  // parents: show notices targeted to their children's context too
  if (childrenIds.length) {
    const kids = await prisma.studentProfile.findMany({ where: { id: { in: childrenIds } } });
    for (const k of kids) {
      audience.OR.push({ deptsVisible: { some: { id: k.departmentId } } });
      audience.OR.push({ coursesVisible: { some: { id: k.courseId } } });
      if (k.sectionId) audience.OR.push({ sectionsVisible: { some: { id: k.sectionId } } });
    }
  }

  // staff roles with institution-wide scope see everything regardless of audience
  if (['SUPER_ADMIN', 'PRINCIPAL', 'ADMIN'].includes(user.role)) return { AND: and };
  // Untargeted notices (no audience rows at all) are global
  const globalNoTarget = {
    rolesVisible: { none: {} }, deptsVisible: { none: {} }, coursesVisible: { none: {} }, sectionsVisible: { none: {} },
  };
  and.push({ OR: [globalNoTarget, audience] });
  return { AND: and };
}

router.get('/notices', requirePermission('notices:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where = await visibleNoticeWhere(req.user);
  const [total, items] = await prisma.$transaction([
    prisma.notice.count({ where }),
    prisma.notice.findMany({
      where, skip, take: limit, orderBy: { publishAt: 'desc' },
      include: { author: { select: { fullName: true } }, reads: { where: { userId: req.user!.id }, select: { readAt: true } } },
    }),
  ]);
  res.json({ total, page, limit, items: items.map((i: any) => ({ ...i, isRead: i.reads.length > 0 })) });
}));

router.post('/notices', requirePermission('notices:create', 'notices:manage'), validate(z.object({
  title: z.string().min(2), body: z.string().min(1), priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  publishAt: z.string().optional(), expiryAt: z.string().optional(),
  roleIds: z.array(z.number()).default([]), departmentIds: z.array(z.string()).default([]),
  courseIds: z.array(z.string()).default([]), sectionIds: z.array(z.string()).default([]),
})), wrap(async (req, res) => {
  const b = req.body;
  const item = await prisma.notice.create({
    data: {
      title: b.title, body: b.body, priority: b.priority,
      publishAt: toDate(b.publishAt) || new Date(), expiryAt: toDate(b.expiryAt),
      createdBy: req.user!.id,
      rolesVisible: { connect: b.roleIds.map((id: number) => ({ id })) },
      deptsVisible: { connect: b.departmentIds.map((id: string) => ({ id })) },
      coursesVisible: { connect: b.courseIds.map((id: string) => ({ id })) },
      sectionsVisible: { connect: b.sectionIds.map((id: string) => ({ id })) },
    },
  });
  await audit(req, 'CREATE', 'notices', item.id, { title: item.title });
  res.status(201).json({ item });
}));

router.post('/notices/:id/read', requirePermission('notices:view'), wrap(async (req, res) => {
  await prisma.noticeRead.upsert({
    where: { noticeId_userId: { noticeId: req.params.id, userId: req.user!.id } },
    create: { noticeId: req.params.id, userId: req.user!.id },
    update: {},
  });
  res.json({ ok: true });
}));

router.delete('/notices/:id', requirePermission('notices:delete', 'notices:manage'), wrap(async (req, res) => {
  await prisma.notice.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'notices', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ DOCUMENTS ══════════════════════ */
router.get('/documents', requirePermission('documents:view'), wrap(async (_req, res) => {
  const items = await prisma.document.findMany({
    include: { uploader: { select: { fullName: true } }, rolesVisible: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
}));

router.post('/documents', requirePermission('documents:create', 'documents:manage'), upload.single('file'), wrap(async (req: any, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded');
  const b = req.body;
  let rolesVisible: number[] = [];
  try { rolesVisible = JSON.parse(b.roleIds || '[]'); } catch { /* ignore */ }
  const item = await prisma.document.create({
    data: {
      title: b.title || req.file.originalname,
      category: b.category || 'OTHER',
      fileName: req.file.originalname,
      filePath: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      sizeKB: Math.round(req.file.size / 1024),
      uploadedBy: req.user!.id,
      rolesVisible: { connect: rolesVisible.map((id: number) => ({ id })) },
    },
  });
  await audit(req, 'UPLOAD', 'documents', item.id, { file: item.fileName });
  res.status(201).json({ item });
}));

router.delete('/documents/:id', requirePermission('documents:delete', 'documents:manage'), wrap(async (req, res) => {
  await prisma.document.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'documents', req.params.id);
  res.json({ ok: true });
}));

export default router;
