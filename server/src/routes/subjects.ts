import { Router } from 'express';
import { z } from 'zod';
import { Subject, ExamSubject, TeacherAllocation, TeacherProfile, User } from '../models';
import { wrap, httpError, parsePagination, oid } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getHodDepartmentId } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

const subjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  courseId: z.string(),
  departmentId: z.string(),
  semesterId: z.string(),
  credits: z.coerce.number().min(0).default(3),
  type: z.enum(['THEORY', 'LAB', 'THEORY_LAB']).default('THEORY'),
  ltp: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/', requirePermission('subjects:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  for (const k of ['courseId', 'semesterId', 'departmentId']) if (req.query[k]) where[k] = oid(req.query[k] as string);
  if (req.user!.role === 'HOD') {
    const deptId = await getHodDepartmentId(req.user!);
    where.departmentId = deptId ? oid(deptId) : null;
  }
  const [total, docs] = await Promise.all([
    Subject.countDocuments(where),
    Subject.find(where).skip(skip).limit(limit).sort({ code: 1 })
      .populate({ path: 'courseId', as: 'course', select: 'name' })
      .populate({ path: 'semesterId', as: 'semester', select: 'number' })
      .populate({ path: 'departmentId', as: 'department', select: 'code' }),
  ]);
  const items = await Promise.all(docs.map(async (s: any) => {
    const j = s.toJSON();
    const allocs = await TeacherAllocation.find({ subjectId: s._id })
      .populate({ path: 'teacherId', as: 'teacher', populate: { path: 'userId', select: 'fullName' } });
    j.allocations = allocs.map((a: any) => {
      const aj = a.toJSON();
      return { id: String(a._id), role: aj.role, teacher: aj.teacher ? { fullName: aj.teacher.user?.fullName } : null };
    });
    return j;
  }));
  res.json({ total, page, limit, items });
}));

router.post('/', requirePermission('subjects:create', 'subjects:manage'), validate(subjectSchema), wrap(async (req, res) => {
  const b = req.body;
  const item = await Subject.create({
    ...b, courseId: oid(b.courseId), departmentId: oid(b.departmentId), semesterId: oid(b.semesterId),
  });
  await audit(req, 'CREATE', 'subjects', String(item._id), { code: item.code });
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/:id', requirePermission('subjects:edit', 'subjects:manage'), validate(subjectSchema.partial()), wrap(async (req, res) => {
  const data: any = { ...req.body };
  for (const k of ['courseId', 'departmentId', 'semesterId']) if (data[k]) data[k] = oid(data[k]);
  const item = await Subject.findByIdAndUpdate(oid(req.params.id), data, { new: true });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'UPDATE', 'subjects', String(item._id));
  res.json({ item: item.toJSON() });
}));

router.delete('/:id', requirePermission('subjects:delete', 'subjects:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const used = await ExamSubject.countDocuments({ subjectId: id });
  if (used > 0) throw httpError(409, 'Subject is referenced by exams; deactivate instead');
  await Subject.deleteOne({ _id: id });
  await audit(req, 'DELETE', 'subjects', req.params.id);
  res.json({ ok: true });
}));

export default router;
