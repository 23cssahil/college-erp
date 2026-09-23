import { Router } from 'express';
import { z } from 'zod';
import { Notice, NoticeRead, Document, StudentProfile, Department, TeacherProfile } from '../models';
import { wrap, httpError, oid, parsePagination } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getParentChildStudentIds } from '../middleware/scope';
import { upload } from '../lib/upload';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ NOTICES ══════════════════════ */
// Visibility filter for the current user based on their context.
async function visibleNoticeWhere(user: any) {
  const and: any[] = [
    { $or: [{ publishAt: { $lte: new Date() } }, { publishAt: null }] },
    { $or: [{ expiryAt: null }, { expiryAt: { $gte: new Date() } }] },
  ];

  // staff roles with institution-wide scope see everything regardless of audience
  if (['SUPER_ADMIN', 'PRINCIPAL', 'ADMIN'].includes(user.role)) return { $and: and };

  // audience targeting: a notice is visible if it lists the user's role /
  // department / course / section (array-contains), or is completely untargeted (global).
  const audience: any[] = [{ rolesVisible: oid(user.roleId) }];

  let student: any = null;
  if (user.role === 'STUDENT') student = await StudentProfile.findOne({ userId: oid(user.id) });

  if (student) {
    audience.push({ deptsVisible: student.departmentId });
    audience.push({ coursesVisible: student.courseId });
    if (student.sectionId) audience.push({ sectionsVisible: student.sectionId });
  } else if (user.role === 'HOD') {
    const d = await Department.findOne({ hodId: oid(user.id) });
    if (d) audience.push({ deptsVisible: d._id });
  } else if (user.role === 'TEACHER') {
    const t = await TeacherProfile.findOne({ userId: oid(user.id) });
    if (t) audience.push({ deptsVisible: t.departmentId });
  }

  // parents: show notices targeted to their children's context too
  if (user.role === 'PARENT') {
    const childIds = await getParentChildStudentIds(user);
    const kids = await StudentProfile.find({ _id: { $in: childIds.map((x) => oid(x)) } });
    for (const k of kids as any[]) {
      audience.push({ deptsVisible: k.departmentId });
      audience.push({ coursesVisible: k.courseId });
      if (k.sectionId) audience.push({ sectionsVisible: k.sectionId });
    }
  }

  const globalNoTarget = {
    rolesVisible: { $size: 0 }, deptsVisible: { $size: 0 }, coursesVisible: { $size: 0 }, sectionsVisible: { $size: 0 },
  };
  and.push({ $or: [globalNoTarget, ...audience] });
  return { $and: and };
}

router.get('/notices', requirePermission('notices:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = await visibleNoticeWhere(req.user);
  const [total, docs] = await Promise.all([
    Notice.countDocuments(filter),
    Notice.find(filter).sort({ publishAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'createdBy', as: 'author', select: 'fullName' }),
  ]);
  const ids = docs.map((d: any) => d._id);
  const reads = await NoticeRead.find({ noticeId: { $in: ids }, userId: oid(req.user!.id) }).select('noticeId');
  const readSet = new Set(reads.map((r: any) => String(r.noticeId)));
  res.json({ total, page, limit, items: docs.map((d: any) => ({ ...d.toJSON(), isRead: readSet.has(String(d._id)) })) });
}));

router.post('/notices', requirePermission('notices:create', 'notices:manage'), validate(z.object({
  title: z.string().min(2), body: z.string().min(1), priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  publishAt: z.string().optional(), expiryAt: z.string().optional(),
  roleIds: z.array(z.string()).default([]), departmentIds: z.array(z.string()).default([]),
  courseIds: z.array(z.string()).default([]), sectionIds: z.array(z.string()).default([]),
})), wrap(async (req, res) => {
  const b = req.body;
  const item = await Notice.create({
    title: b.title, body: b.body, priority: b.priority,
    publishAt: toDate(b.publishAt) || new Date(), expiryAt: toDate(b.expiryAt),
    createdBy: oid(req.user!.id),
    rolesVisible: b.roleIds.map((id: string) => oid(id)),
    deptsVisible: b.departmentIds.map((id: string) => oid(id)),
    coursesVisible: b.courseIds.map((id: string) => oid(id)),
    sectionsVisible: b.sectionIds.map((id: string) => oid(id)),
  });
  await audit(req, 'CREATE', 'notices', String(item._id), { title: item.title });
  res.status(201).json({ item: item.toJSON() });
}));

router.post('/notices/:id/read', requirePermission('notices:view'), wrap(async (req, res) => {
  await NoticeRead.findOneAndUpdate(
    { noticeId: oid(req.params.id), userId: oid(req.user!.id) },
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ ok: true });
}));

router.delete('/notices/:id', requirePermission('notices:delete', 'notices:manage'), wrap(async (req, res) => {
  await Notice.deleteOne({ _id: oid(req.params.id) });
  await audit(req, 'DELETE', 'notices', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ DOCUMENTS ══════════════════════ */
router.get('/documents', requirePermission('documents:view'), wrap(async (_req, res) => {
  const items = await Document.find()
    .populate({ path: 'uploadedBy', as: 'uploader', select: 'fullName' })
    .populate({ path: 'rolesVisible', select: 'name' })
    .sort({ createdAt: -1 });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

router.post('/documents', requirePermission('documents:create', 'documents:manage'), upload.single('file'), wrap(async (req: any, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded');
  const b = req.body;
  let rolesVisible: string[] = [];
  try { rolesVisible = JSON.parse(b.roleIds || '[]'); } catch { /* ignore */ }
  const item = await Document.create({
    title: b.title || req.file.originalname,
    category: b.category || 'OTHER',
    fileName: req.file.originalname,
    filePath: `/uploads/${req.file.filename}`,
    mimeType: req.file.mimetype,
    sizeKB: Math.round(req.file.size / 1024),
    uploadedBy: oid(req.user!.id),
    rolesVisible: rolesVisible.map((id: string) => oid(id)),
  });
  await audit(req, 'UPLOAD', 'documents', String(item._id), { file: item.fileName });
  res.status(201).json({ item: item.toJSON() });
}));

router.delete('/documents/:id', requirePermission('documents:delete', 'documents:manage'), wrap(async (req, res) => {
  await Document.deleteOne({ _id: oid(req.params.id) });
  await audit(req, 'DELETE', 'documents', req.params.id);
  res.json({ ok: true });
}));

export default router;
