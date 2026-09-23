import { Router } from 'express';
import { z } from 'zod';
import { FeeStructure, FeeInvoice, StudentProfile } from '../models';
import { wrap, httpError, oid, parsePagination, genSeqNo } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

async function orElse<T>(p: Promise<T>, msg: string): Promise<NonNullable<T>> {
  const v = await p;
  if (v == null) throw httpError(404, msg);
  return v as NonNullable<T>;
}

/* ══════════════════════ FEE STRUCTURES ══════════════════════ */
const fsSchema = z.object({
  name: z.string().min(2), amount: z.coerce.number().min(0),
  courseId: z.string().optional(), semesterId: z.string().optional(), academicYearId: z.string().optional(),
  dueDayOfMonth: z.coerce.number().int().min(1).max(28).default(10), isMandatory: z.boolean().optional(),
});
router.get('/structures', requirePermission('fees:view'), wrap(async (_req, res) => {
  const items = await FeeStructure.find()
    .populate({ path: 'courseId', as: 'course', select: 'name' })
    .populate({ path: 'semesterId', as: 'semester', select: 'number' })
    .sort({ createdAt: -1 });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));
router.post('/structures', requirePermission('fees:create', 'fees:manage'), validate(fsSchema), wrap(async (req, res) => {
  const b = req.body;
  const item = await FeeStructure.create({
    name: b.name, amount: b.amount, dueDayOfMonth: b.dueDayOfMonth, isMandatory: b.isMandatory,
    courseId: b.courseId ? oid(b.courseId) : undefined,
    semesterId: b.semesterId ? oid(b.semesterId) : undefined,
    academicYearId: b.academicYearId ? oid(b.academicYearId) : undefined,
  });
  await audit(req, 'CREATE', 'feeStructures', String(item._id), { name: item.name });
  res.status(201).json({ item: item.toJSON() });
}));
router.delete('/structures/:id', requirePermission('fees:delete', 'fees:manage'), wrap(async (req, res) => {
  await FeeStructure.findByIdAndUpdate(oid(req.params.id), { isActive: false });
  await audit(req, 'DEACTIVATE', 'feeStructures', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ INVOICES ══════════════════════ */
router.get('/invoices', requirePermission('fees:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.studentId) where.studentId = oid(req.query.studentId as string);
  if (req.query.status) where.status = req.query.status;
  // students/parents see only their own
  if (req.user!.role === 'STUDENT') {
    const sp = await getStudentProfileId(req.user!);
    where.studentId = sp ? oid(sp) : null;
  }
  if (req.user!.role === 'PARENT') {
    const ids = await getParentChildStudentIds(req.user!);
    where.studentId = { $in: ids.map((x) => oid(x)) };
  }

  const [total, docs] = await Promise.all([
    FeeInvoice.countDocuments(where),
    FeeInvoice.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'studentId', as: 'student', select: 'rollNo userId', populate: { path: 'userId', as: 'user', select: 'fullName' } }),
  ]);
  res.json({ total, page, limit, items: docs.map((d: any) => d.toJSON()) });
}));

// Generate invoices for all students in a section from a fee structure
router.post('/invoices/generate', requirePermission('fees:create', 'fees:manage'), validate(z.object({
  feeStructureId: z.string(), sectionId: z.string(), dueDate: z.string(),
})), wrap(async (req, res) => {
  const fs = await orElse(FeeStructure.findById(oid(req.body.feeStructureId)), 'Fee structure not found');
  const students = await StudentProfile.find({ sectionId: oid(req.body.sectionId), status: 'STUDYING' }).select('_id');
  const dueDate = new Date(req.body.dueDate);
  let created = 0;
  for (const s of students as any[]) {
    const existing = await FeeInvoice.findOne({ studentId: s._id, title: fs.name, status: { $ne: 'CANCELLED' } });
    if (existing) continue;
    await FeeInvoice.create({
      invoiceNo: genSeqNo('INV'), studentId: s._id, title: fs.name, totalAmount: fs.amount,
      dueDate, status: 'ISSUED', academicYearId: fs.academicYearId,
      items: [{ description: fs.name, amount: fs.amount }],
    });
    created++;
  }
  await audit(req, 'GENERATE', 'fees', req.body.sectionId, { created });
  res.json({ ok: true, created });
}));

router.get('/invoices/:id', requirePermission('fees:view'), wrap(async (req, res) => {
  const item = await FeeInvoice.findById(oid(req.params.id)).populate([
    { path: 'studentId', as: 'student', populate: [{ path: 'userId', as: 'user', select: 'fullName' }, { path: 'courseId', as: 'course' }, { path: 'sectionId', as: 'section' }] },
  ]);
  if (!item) throw httpError(404, 'Invoice not found');
  if (req.user!.role === 'STUDENT' || req.user!.role === 'PARENT') {
    const own = req.user!.role === 'STUDENT' ? [await getStudentProfileId(req.user!)] : await getParentChildStudentIds(req.user!);
    const ownerId = String((item.toJSON() as any).studentId);
    if (!own.filter(Boolean).map(String).includes(ownerId)) throw httpError(403, 'Not your invoice');
  }
  res.json({ item: item.toJSON() });
}));

/* ══════════════════════ PAYMENTS ══════════════════════ */
router.post('/invoices/:id/pay', requirePermission('fees:create', 'fees:manage'), validate(z.object({
  amount: z.coerce.number().min(1), method: z.enum(['CASH', 'UPI', 'CARD', 'NETBANKING', 'CHEQUE', 'DD']).default('CASH'),
  txnRef: z.string().optional(), remarks: z.string().optional(),
})), wrap(async (req, res) => {
  const inv = await orElse(FeeInvoice.findById(oid(req.params.id)), 'Invoice not found');
  if (inv.status === 'PAID' || inv.status === 'CANCELLED') throw httpError(400, `Invoice already ${inv.status.toLowerCase()}`);
  const remaining = inv.totalAmount - inv.paidAmount;
  if (req.body.amount > remaining + 0.01) throw httpError(400, `Amount exceeds due (${remaining})`);

  const paidAmount = inv.paidAmount + req.body.amount;
  const newStatus = paidAmount + 0.01 >= inv.totalAmount ? 'PAID' : 'PARTIALLY_PAID';
  const payment = {
    receiptNo: genSeqNo('RCPT'), invoiceId: String(inv._id), amount: req.body.amount,
    method: req.body.method, txnRef: req.body.txnRef, remarks: req.body.remarks,
    paidAt: new Date(), recordedBy: oid(req.user!.id),
  };
  await FeeInvoice.findByIdAndUpdate(inv._id, { $push: { payments: payment }, $set: { paidAmount, status: newStatus } });
  await audit(req, 'PAYMENT', 'fees', String(inv._id), { amount: req.body.amount, receipt: payment.receiptNo });
  res.status(201).json({ payment, invoiceStatus: newStatus });
}));

// Dues dashboard for accountant/principal
router.get('/dues', requirePermission('fees:view'), wrap(async (_req, res) => {
  const invoices = await FeeInvoice.find({ status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } })
    .populate({ path: 'studentId', as: 'student', select: 'rollNo userId departmentId', populate: { path: 'userId', as: 'user', select: 'fullName' } });
  const json = invoices.map((i: any) => i.toJSON());
  const totals = json.reduce((a: any, i: any) => ({ billed: a.billed + i.totalAmount, paid: a.paid + i.paidAmount, due: a.due + (i.totalAmount - i.paidAmount) }), { billed: 0, paid: 0, due: 0 });
  res.json({ totals, count: json.length, invoices: json.slice(0, 200) });
}));

export default router;
