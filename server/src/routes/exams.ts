import { Router } from 'express';
import { z } from 'zod';
import { Exam, ExamSubject, ExamResult, Subject, StudentProfile } from '../models';
import { wrap, httpError, oid } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId } from '../middleware/scope';
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

/** Replace Prisma's findUniqueOrThrow: a missing doc becomes a clean 404. */
async function orElse<T>(p: Promise<T>, msg: string): Promise<NonNullable<T>> {
  const v = await p;
  if (v == null) throw httpError(404, msg);
  return v as NonNullable<T>;
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
  const exs = await Exam.find()
    .populate({ path: 'academicYearId', as: 'academicYear', select: 'label' })
    .sort({ startDate: -1 });
  const counts = await Promise.all(exs.map((e: any) => ExamSubject.countDocuments({ examId: e._id })));
  res.json({ items: exs.map((e: any, i: number) => ({ ...e.toJSON(), _count: { subjects: counts[i] } })) });
}));

router.post('/', requirePermission('exams:create', 'exams:manage'), validate(examSchema), wrap(async (req, res) => {
  const item = await Exam.create({ ...req.body });
  await audit(req, 'CREATE', 'exams', String(item._id), { name: item.name });
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/:id', requirePermission('exams:edit', 'exams:manage'), validate(examSchema.partial().extend({ status: z.string().optional() })), wrap(async (req, res) => {
  const data: any = { ...req.body };
  const item = await orElse(Exam.findByIdAndUpdate(oid(req.params.id), data, { new: true }), 'Exam not found');
  await audit(req, 'UPDATE', 'exams', String(item._id));
  res.json({ item: item.toJSON() });
}));

// Add a subject to an exam (schedule + weightage)
router.post('/:id/subjects', requirePermission('exams:manage', 'exams:create'), validate(z.object({
  subjectId: z.string(), maxMarks: z.coerce.number().default(100), passMarks: z.coerce.number().default(40),
  weightage: z.coerce.number().default(100), date: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  const examId = oid(req.params.id);
  await orElse(Exam.findById(examId), 'Exam not found');
  const subject = await orElse(Subject.findById(oid(b.subjectId)), 'Subject not found');
  const item = await ExamSubject.findOneAndUpdate(
    { examId, subjectId: subject._id },
    { $set: { maxMarks: b.maxMarks, passMarks: b.passMarks, weightage: b.weightage, date: toDate(b.date), startTime: b.startTime, endTime: b.endTime } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'ADD_SUBJECT', 'exams', req.params.id, { subjectId: String(subject._id) });
  res.json({ item: item.toJSON() });
}));

router.get('/:id/subjects', requirePermission('exams:view', 'marks:view'), wrap(async (req, res) => {
  const examId = oid(req.params.id);
  const list = await ExamSubject.find({ examId })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name semesterId courseId' });
  const counts = await Promise.all(list.map((e: any) => ExamResult.countDocuments({ examSubjectId: e._id })));
  const items = list
    .map((e: any, i: number) => ({ ...e.toJSON(), _count: { results: counts[i] } }))
    .sort((a: any, b: any) => String(a.subject?.code || '').localeCompare(String(b.subject?.code || '')));
  res.json({ items });
}));

/* ══════════════════════ MARKS ══════════════════════ */
// Roster of students enrolled in the subject's semester (for marks entry)
router.get('/roster/:examSubjectId', requirePermission('marks:view', 'marks:create'), wrap(async (req, res) => {
  const es = await orElse(
    ExamSubject.findById(oid(req.params.examSubjectId))
      .populate({ path: 'subjectId', as: 'subject', select: 'code name semesterId courseId' }),
    'Exam subject not found',
  );
  const esJson: any = es.toJSON();
  const subject: any = esJson.subject;
  const students = await StudentProfile.find({ semesterId: subject?.semesterId, status: 'STUDYING' })
    .sort({ rollNo: 1 })
    .populate({ path: 'userId', as: 'user', select: 'fullName' });
  const results = await ExamResult.find({ examSubjectId: es._id }).select('studentId marksObtained status isPublished');
  const byStudent: Record<string, any[]> = {};
  for (const r of results as any[]) {
    const k = String(r.studentId);
    (byStudent[k] = byStudent[k] || []).push({ marksObtained: r.marksObtained, status: r.status, isPublished: r.isPublished });
  }
  res.json({
    examSubject: esJson,
    students: students.map((s: any) => ({ ...s.toJSON(), results: byStudent[String(s._id)] || [] })),
  });
}));

// Bulk upsert marks
router.post('/marks', requirePermission('marks:create', 'marks:edit', 'marks:manage'), validate(z.object({
  examSubjectId: z.string(),
  entries: z.array(z.object({ studentId: z.string(), marks: z.number().nullable(), absent: z.boolean().optional() })),
})), wrap(async (req, res) => {
  const es = await orElse(ExamSubject.findById(oid(req.body.examSubjectId)), 'Exam subject not found');
  let count = 0;
  await Promise.all(req.body.entries.map((e: any) => {
    let status: string = 'WITHHELD';
    let grade: string | null = null;
    if (e.absent) status = 'ABSENT';
    else if (e.marks != null) {
      const pct = (e.marks / es.maxMarks) * 100;
      status = pct >= (es.passMarks / es.maxMarks) * 100 ? 'PASS' : 'FAIL';
      grade = gradeFor(pct);
    }
    count++;
    return ExamResult.findOneAndUpdate(
      { examSubjectId: es._id, studentId: oid(e.studentId) },
      { $set: { marksObtained: e.absent ? null : e.marks, status, grade, enteredBy: oid(req.user!.id) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }));
  await audit(req, 'SAVE_MARKS', 'marks', String(es._id), { count });
  res.json({ ok: true, count });
}));

/* ══════════════════════ RESULTS ══════════════════════ */
// Publish / unpublish all results of an exam
router.post('/:id/publish', requirePermission('results:manage', 'results:edit'), validate(z.object({ publish: z.boolean().default(true) })), wrap(async (req, res) => {
  const examId = oid(req.params.id);
  const subjects = await ExamSubject.find({ examId }).select('_id');
  const ids = subjects.map((s: any) => s._id);
  await ExamResult.updateMany({ examSubjectId: { $in: ids } }, { isPublished: req.body.publish });
  await Exam.findByIdAndUpdate(examId, { status: req.body.publish ? 'RESULT_PUBLISHED' : 'COMPLETED' });
  await audit(req, 'PUBLISH_RESULT', 'results', req.params.id, { publish: req.body.publish });
  res.json({ ok: true });
}));

// Result view — scoped: student sees own, parent sees children, others see all in an exam
router.get('/view/results', requirePermission('results:view'), wrap(async (req, res) => {
  const examId = req.query.examId as string;
  if (!examId) throw httpError(400, 'examId required');

  let studentIdFilter: string | undefined = req.query.studentId as string;
  if (req.user!.role === 'STUDENT' && !studentIdFilter) studentIdFilter = (await getStudentProfileId(req.user!)) || undefined;

  const exam = await orElse(Exam.findById(oid(examId)), 'Exam not found');
  const esList = await ExamSubject.find({ examId: exam._id })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name' });
  const examJson: any = { ...exam.toJSON(), subjects: esList.map((e: any) => e.toJSON()) };

  if (req.user!.role === 'STUDENT' || studentIdFilter) {
    if (!studentIdFilter) return res.json({ exam: examJson, rows: [] });
    const student = await orElse(
      StudentProfile.findById(oid(studentIdFilter)).populate([
        { path: 'userId', as: 'user', select: 'fullName' },
        { path: 'courseId', as: 'course', select: 'name' },
        { path: 'semesterId', as: 'semester', select: 'number' },
        { path: 'sectionId', as: 'section', select: 'name' },
      ]),
      'Student not found',
    );
    const esIds = esList.map((e: any) => e._id);
    const results = await ExamResult.find({ studentId: student._id, examSubjectId: { $in: esIds }, isPublished: true })
      .populate({ path: 'examSubjectId', as: 'examSubject', populate: { path: 'subjectId', as: 'subject', select: 'code name' } });
    const rjson = results.map((r: any) => r.toJSON());
    const total = rjson.reduce((s: number, r: any) => s + (r.marksObtained || 0), 0);
    const max = rjson.reduce((s: number, r: any) => s + (r.examSubject?.maxMarks || 0), 0);
    return res.json({
      exam: examJson,
      student: student.toJSON(),
      results: rjson,
      summary: { total, max, percentage: max ? Math.round((total / max) * 1000) / 10 : 0, overallGrade: max ? gradeFor((total / max) * 100) : '-' },
    });
  }

  // staff view: aggregate per student
  const esIds = esList.map((e: any) => e._id);
  const results = await ExamResult.find({ examSubjectId: { $in: esIds } }).populate([
    { path: 'examSubjectId', as: 'examSubject', populate: { path: 'subjectId', as: 'subject', select: 'code name' } },
    { path: 'studentId', as: 'student', select: 'rollNo userId sectionId', populate: [{ path: 'userId', select: 'fullName' }, { path: 'sectionId', select: 'name' }] },
  ]);
  const byStudent: Record<string, any> = {};
  for (const rr of results as any[]) {
    const r = rr.toJSON();
    const stu = r.student;
    if (!stu) continue;
    const id: string = stu.id;
    byStudent[id] = byStudent[id] || { studentId: id, rollNo: stu.rollNo, fullName: stu.user?.fullName, section: stu.section?.name, marks: {}, total: 0, max: 0 };
    const subj = r.examSubject?.subject;
    byStudent[id].marks[subj.code] = { obtained: r.marksObtained, max: r.examSubject?.maxMarks, status: r.status, grade: r.grade, published: r.isPublished };
    byStudent[id].total += r.marksObtained || 0;
    byStudent[id].max += r.examSubject?.maxMarks || 0;
  }
  res.json({ exam: examJson, rows: Object.values(byStudent) });
}));

export default router;
