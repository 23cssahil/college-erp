import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
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
  for (const k of ['courseId', 'semesterId', 'departmentId']) if (req.query[k]) where[k] = req.query[k];
  if (req.user!.role === 'HOD') {
    const deptId = await getHodDepartmentId(req.user!);
    where.departmentId = deptId || '__none__';
  }
  const [total, items] = await prisma.$transaction([
    prisma.subject.count({ where }),
    prisma.subject.findMany({
      where, skip, take: limit, orderBy: { code: 'asc' },
      include: {
        course: { select: { name: true } }, semester: { select: { number: true } }, department: { select: { code: true } },
        allocations: { include: { teacher: { select: { user: { select: { fullName: true } } } } } },
      },
    }),
  ]);
  res.json({ total, page, limit, items });
}));

router.post('/', requirePermission('subjects:create', 'subjects:manage'), validate(subjectSchema), wrap(async (req, res) => {
  const item = await prisma.subject.create({ data: req.body });
  await audit(req, 'CREATE', 'subjects', item.id, { code: item.code });
  res.status(201).json({ item });
}));

router.put('/:id', requirePermission('subjects:edit', 'subjects:manage'), validate(subjectSchema.partial()), wrap(async (req, res) => {
  const item = await prisma.subject.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'UPDATE', 'subjects', item.id);
  res.json({ item });
}));

router.delete('/:id', requirePermission('subjects:delete', 'subjects:manage'), wrap(async (req, res) => {
  const used = await prisma.examSubject.count({ where: { subjectId: req.params.id } });
  if (used > 0) throw httpError(409, 'Subject is referenced by exams; deactivate instead');
  await prisma.subject.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'subjects', req.params.id);
  res.json({ ok: true });
}));

export default router;
