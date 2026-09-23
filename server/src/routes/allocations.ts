import { Router } from 'express';
import { z } from 'zod';
import { TeacherAllocation } from '../models';
import { wrap, oid } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ SUBJECT ALLOCATIONS (teacher ↔ subject ↔ section) ══════════════════════ */

// Global list with optional filters: ?teacherId=&subjectId=&sectionId=
router.get('/', requirePermission('allocations:view', 'teachers:view'), wrap(async (req, res) => {
  const where: any = {};
  for (const k of ['teacherId', 'subjectId', 'sectionId']) if (req.query[k]) where[k] = oid(req.query[k] as string);
  const items = await TeacherAllocation.find(where)
    .populate({ path: 'teacherId', as: 'teacher', select: 'employeeCode userId', populate: { path: 'userId', select: 'fullName email' } })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name type' })
    .populate({ path: 'sectionId', as: 'section', select: 'name semesterId', populate: { path: 'semesterId', select: 'number' } })
    .sort({ createdAt: -1 });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

router.post('/', requirePermission('allocations:create', 'allocations:manage', 'teachers:edit'), validate(z.object({
  teacherId: z.string(), subjectId: z.string(), sectionId: z.string(),
  role: z.enum(['PRIMARY', 'LAB', 'COORDINATOR']).default('PRIMARY'),
})), wrap(async (req, res) => {
  const b = req.body;
  const item = await TeacherAllocation.findOneAndUpdate(
    { teacherId: oid(b.teacherId), subjectId: oid(b.subjectId), sectionId: oid(b.sectionId), role: b.role },
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'ALLOCATE', 'allocations', String(item._id), { teacher: b.teacherId, subject: b.subjectId, section: b.sectionId });
  res.status(201).json({ item: item.toJSON() });
}));

router.delete('/:id', requirePermission('allocations:delete', 'allocations:manage', 'teachers:edit'), wrap(async (req, res) => {
  await TeacherAllocation.deleteOne({ _id: oid(req.params.id) });
  await audit(req, 'UNALLOCATE', 'allocations', req.params.id);
  res.json({ ok: true });
}));

export default router;
