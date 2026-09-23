import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

function gradeFor(pct: number): string {
  if (pct >= 90) return 'O';
  if (pct >= 80) return 'A+';
  if (pct >= 70) return 'A';
  if (pct >= 60) return 'B+';
  if (pct >= 50) return 'B';
  if (pct >= 40) return 'C';
  return 'F';
}

/* ══════════════════════ EXAMS ══════════════════════ */
const examSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['INTERNAL', 'MID_SEM', 'FINAL_SEM', 'SUPPLEMENTARY', 'PRACTICAL']).default('FINAL_SEM'),
  academicYearId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

router.get('/', requirePermission('exams:view', 'marks:view', 'results:view'), wrap(async (_req, res) => {
  const items = await prisma.exam.findMany({
    include: { academicYear: { select: { label: true } }, _count: { select: { subjects: true } } },
    orderBy: { startDate: 'desc' },
  });
  res.json({ items });
}));

router.post('/', requirePermission('exams:create', 'exams:manage'), validate(examSchema), wrap(async (req, res) => {
  const item = await prisma.exam.create({ data: { ...req.body, startDate: new Date(req.body.startDate), endDate: new Date(req.body.endDate) } });
  await audit(req, 'CREATE', 'exams', item.id, { name: item.name });
  res.status(201).json({ item });
}));

router.put('/:id', requirePermission('exams:edit', 'exams:manage'), validate(examSchema.partial().extend({ status: z.string().optional() })), wrap(async (req, res) => {
  const data: any = { ...req.body };
  if (req.body.startDate) data.startDate = new Date(req.body.startDate);
  if (req.body.endDate) data.endDate = new Date(req.body.endDate);
  const item = await prisma.exam.update({ where: { id: req.params.id }, data });
  await audit(req, 'UPDATE', 'exams', item.id);
  res.json({ item });
}));

// Add a subject to an exam (schedule + weightage)
router.post('/:id/subjects', requirePermission('exams:manage', 'exams:create'), validate(z.object({
  subjectId: z.string(), maxMarks: z.coerce.number().default(100), passMarks: z.coerce.number().default(40),
  weightage: z.coerce.number().default(100), date: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: req.params.id } });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { id: b.subjectId } });
  const item = await prisma.examSubject.upsert({
    where: { examId_subjectId: { examId: exam.id, subjectId: subject.id } },
    create: { examId: exam.id, subjectId: subject.id, maxMarks: b.maxMarks, passMarks: b.passMarks, weightage: b.weightage, date: toDate(b.date), startTime: b.startTime, endTime: b.endTime },
    update: { maxMarks: b.maxMarks, passMarks: b.passMarks, weightage: b.weightage, date: toDate(b.date), startTime: b.startTime, endTime: b.endTime },
  });
  await audit(req, 'ADD_SUBJECT', 'exams', exam.id, { subjectId: subject.id });
  res.json({ item });
}));

router.get('/:id/subjects', requirePermission('exams:view', 'marks:view'), wrap(async (req, res) => {
  const items = await prisma.examSubject.findMany({
    where: { examId: req.params.id },
    include: { subject: { select: { id: true, code: true, name: true, semesterId: true, courseId: true } }, _count: { select: { results: true } } },
    orderBy: { subject: { code: 'asc' } },
  });
  res.json({ items });
}));

/* ══════════════════════ MARKS ══════════════════════ */
// Roster of students enrolled in the subject's semester (for marks entry)
router.get('/roster/:examSubjectId', requirePermission('marks:view', 'marks:create'), wrap(async (req, res) => {
  const es = await prisma.examSubject.findUniqueOrThrow({ where: { id: req.params.examSubjectId }, include: { subject: true } });
  const students = await prisma.studentProfile.findMany({
    where: { semesterId: es.subject.semesterId, status: 'STUDYING' },
    orderBy: { rollNo: 'asc' },
    include: { user: { select: { fullName: true } }, results: { where: { examSubjectId: es.id }, select: { marksObtained: true, status: true, isPublished: true } } },
  });
  res.json({ examSubject: es, students });
}));

// Bulk upsert marks
router.post('/marks', requirePermission('marks:create', 'marks:edit', 'marks:manage'), validate(z.object({
  examSubjectId: z.string(),
  entries: z.array(z.object({ studentId: z.string(), marks: z.number().nullable(), absent: z.boolean().optional() })),
})), wrap(async (req, res) => {
  const es = await prisma.examSubject.findUniqueOrThrow({ where: { id: req.body.examSubjectId } });
  let count = 0;
  await prisma.$transaction(
    req.body.entries.map((e: any) => {
      let status: any = 'WITHHELD';
      let grade: string | null = null;
      if (e.absent) status = 'ABSENT';
      else if (e.marks != null) {
        const pct = (e.marks / es.maxMarks) * 100;
        status = pct >= (es.passMarks / es.maxMarks) * 100 ? 'PASS' : 'FAIL';
        grade = gradeFor(pct);
      }
      count++;
      return prisma.examResult.upsert({
        where: { examSubjectId_studentId: { examSubjectId: es.id, studentId: e.studentId } },
        create: { examSubjectId: es.id, studentId: e.studentId, marksObtained: e.absent ? null : e.marks, status, grade, enteredBy: req.user!.id },
        update: { marksObtained: e.absent ? null : e.marks, status, grade, enteredBy: req.user!.id },
      });
    }),
  );
  await audit(req, 'SAVE_MARKS', 'marks', es.id, { count });
  res.json({ ok: true, count });
}));

/* ══════════════════════ RESULTS ══════════════════════ */
// Publish / unpublish all results of an exam
router.post('/:id/publish', requirePermission('results:manage', 'results:edit'), validate(z.object({ publish: z.boolean().default(true) })), wrap(async (req, res) => {
  const subjects = await prisma.examSubject.findMany({ where: { examId: req.params.id }, select: { id: true } });
  const ids = subjects.map((s) => s.id);
  await prisma.examResult.updateMany({ where: { examSubjectId: { in: ids } }, data: { isPublished: req.body.publish } });
  await prisma.exam.update({ where: { id: req.params.id }, data: { status: req.body.publish ? 'RESULT_PUBLISHED' : 'COMPLETED' } });
  await audit(req, 'PUBLISH_RESULT', 'results', req.params.id, { publish: req.body.publish });
  res.json({ ok: true });
}));

// Result view — scoped: student sees own, parent sees children, others see all in an exam
router.get('/view/results', requirePermission('results:view'), wrap(async (req, res) => {
  const examId = req.query.examId as string;
  if (!examId) throw httpError(400, 'examId required');

  let studentIdFilter: string | undefined = req.query.studentId as string;
  if (req.user!.role === 'STUDENT' && !studentIdFilter) studentIdFilter = (await getStudentProfileId(req.user!)) || undefined;

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: { subjects: { include: { subject: { select: { code: true, name: true } } } } } });

  if (req.user!.role === 'STUDENT' || studentIdFilter) {
    if (!studentIdFilter) return res.json({ exam, rows: [] });
    const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentIdFilter }, include: { user: { select: { fullName: true } }, course: { select: { name: true } }, semester: { select: { number: true } }, section: { select: { name: true } } } });
    const results = await prisma.examResult.findMany({ where: { studentId: student.id, examSubject: { examId }, isPublished: true }, include: { examSubject: { include: { subject: { select: { code: true, name: true } } } } } });
    const total = results.reduce((s, r) => s + (r.marksObtained || 0), 0);
    const max = results.reduce((s, r) => s + (r.examSubject.maxMarks || 0), 0);
    return res.json({ exam, student, results, summary: { total, max, percentage: max ? Math.round((total / max) * 1000) / 10 : 0, overallGrade: max ? gradeFor((total / max) * 100) : '-' } });
  }

  // staff view: aggregate per student
  const esIds = exam.subjects.map((s) => s.id);
  const results = await prisma.examResult.findMany({ where: { examSubjectId: { in: esIds } }, include: { examSubject: { include: { subject: { select: { code: true, name: true } } } }, student: { include: { user: { select: { fullName: true } }, section: { select: { name: true } } } } } });
  const byStudent: Record<string, any> = {};
  for (const r of results) {
    const id = r.studentId;
    byStudent[id] = byStudent[id] || { studentId: id, rollNo: r.student.rollNo, fullName: r.student.user.fullName, section: r.student.section?.name, marks: {}, total: 0, max: 0 };
    const subj = r.examSubject.subject;
    byStudent[id].marks[subj.code] = { obtained: r.marksObtained, max: r.examSubject.maxMarks, status: r.status, grade: r.grade, published: r.isPublished };
    byStudent[id].total += r.marksObtained || 0;
    byStudent[id].max += r.examSubject.maxMarks || 0;
  }
  res.json({ exam, rows: Object.values(byStudent) });
}));

export default router;
