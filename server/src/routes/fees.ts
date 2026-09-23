import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination, genSeqNo } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ FEE STRUCTURES ══════════════════════ */
const fsSchema = z.object({
  name: z.string().min(2), amount: z.coerce.number().min(0),
  courseId: z.string().optional(), semesterId: z.string().optional(), academicYearId: z.string().optional(),
  dueDayOfMonth: z.coerce.number().int().min(1).max(28).default(10), isMandatory: z.boolean().optional(),
});
router.get('/structures', requirePermission('fees:view'), wrap(async (_req, res) => {
  const items = await prisma.feeStructure.findMany({ include: { course: { select: { name: true } }, semester: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ items });
}));
router.post('/structures', requirePermission('fees:create', 'fees:manage'), validate(fsSchema), wrap(async (req, res) => {
  const data: any = { ...req.body, courseId: req.body.courseId || undefined, semesterId: req.body.semesterId || undefined, academicYearId: req.body.academicYearId || undefined };
  const item = await prisma.feeStructure.create({ data });
  await audit(req, 'CREATE', 'feeStructures', item.id, { name: item.name });
  res.status(201).json({ item });
}));
router.delete('/structures/:id', requirePermission('fees:delete', 'fees:manage'), wrap(async (req, res) => {
  await prisma.feeStructure.update({ where: { id: req.params.id }, data: { isActive: false } });
  await audit(req, 'DEACTIVATE', 'feeStructures', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ INVOICES ══════════════════════ */
router.get('/invoices', requirePermission('fees:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.studentId) where.studentId = req.query.studentId;
  if (req.query.status) where.status = req.query.status;
  // students/parents see only their own
  if (req.user!.role === 'STUDENT') where.studentId = (await getStudentProfileId(req.user!)) || '__none__';
  if (req.user!.role === 'PARENT') where.studentId = { in: await getParentChildStudentIds(req.user!) };

  const [total, items] = await prisma.$transaction([
    prisma.feeInvoice.count({ where }),
    prisma.feeInvoice.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { student: { select: { rollNo: true, user: { select: { fullName: true } } } }, items: true, payments: true },
    }),
  ]);
  res.json({ total, page, limit, items });
}));

// Generate invoices for all students in a section from a fee structure
router.post('/invoices/generate', requirePermission('fees:create', 'fees:manage'), validate(z.object({
  feeStructureId: z.string(), sectionId: z.string(), dueDate: z.string(),
})), wrap(async (req, res) => {
  const fs = await prisma.feeStructure.findUniqueOrThrow({ where: { id: req.body.feeStructureId } });
  const students = await prisma.studentProfile.findMany({ where: { sectionId: req.body.sectionId, status: 'STUDYING' }, select: { id: true } });
  const dueDate = new Date(req.body.dueDate);
  let created = 0;
  for (const s of students) {
    const existing = await prisma.feeInvoice.findFirst({ where: { studentId: s.id, title: fs.name, status: { not: 'CANCELLED' } } });
    if (existing) continue;
    await prisma.feeInvoice.create({
      data: {
        invoiceNo: genSeqNo('INV'), studentId: s.id, title: fs.name, totalAmount: fs.amount,
        dueDate, status: 'ISSUED', academicYearId: fs.academicYearId,
        items: { create: [{ description: fs.name, amount: fs.amount }] },
      },
    });
    created++;
  }
  await audit(req, 'GENERATE', 'fees', req.body.sectionId, { created });
  res.json({ ok: true, created });
}));

router.get('/invoices/:id', requirePermission('fees:view'), wrap(async (req, res) => {
  const item = await prisma.feeInvoice.findUnique({ where: { id: req.params.id }, include: { student: { include: { user: { select: { fullName: true } }, course: true, section: true } }, items: true, payments: true } });
  if (!item) throw httpError(404, 'Invoice not found');
  if ((req.user!.role === 'STUDENT' || req.user!.role === 'PARENT')) {
    const own = req.user!.role === 'STUDENT' ? [await getStudentProfileId(req.user!)] : await getParentChildStudentIds(req.user!);
    if (!own.filter(Boolean).includes(item.studentId)) throw httpError(403, 'Not your invoice');
  }
  res.json({ item });
}));

/* ══════════════════════ PAYMENTS ══════════════════════ */
router.post('/invoices/:id/pay', requirePermission('fees:create', 'fees:manage'), validate(z.object({
  amount: z.coerce.number().min(1), method: z.enum(['CASH', 'UPI', 'CARD', 'NETBANKING', 'CHEQUE', 'DD']).default('CASH'),
  txnRef: z.string().optional(), remarks: z.string().optional(),
})), wrap(async (req, res) => {
  const inv = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: req.params.id } });
  if (inv.status === 'PAID' || inv.status === 'CANCELLED') throw httpError(400, `Invoice already ${inv.status.toLowerCase()}`);
  const remaining = inv.totalAmount - inv.paidAmount;
  if (req.body.amount > remaining + 0.01) throw httpError(400, `Amount exceeds due (${remaining})`);

  const paidAmount = inv.paidAmount + req.body.amount;
  const newStatus = paidAmount + 0.01 >= inv.totalAmount ? 'PAID' : 'PARTIALLY_PAID';
  const payment = await prisma.$transaction(async (tx: any) => {
    const p = await tx.feePayment.create({
      data: { receiptNo: genSeqNo('RCPT'), invoiceId: inv.id, amount: req.body.amount, method: req.body.method, txnRef: req.body.txnRef, remarks: req.body.remarks, recordedBy: req.user!.id },
    });
    await tx.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount, status: newStatus } });
    return p;
  });
  await audit(req, 'PAYMENT', 'fees', inv.id, { amount: req.body.amount, receipt: payment.receiptNo });
  res.status(201).json({ payment, invoiceStatus: newStatus });
}));

// Dues dashboard for accountant/principal
router.get('/dues', requirePermission('fees:view'), wrap(async (_req, res) => {
  const invoices = await prisma.feeInvoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, include: { student: { select: { rollNo: true, user: { select: { fullName: true } }, departmentId: true } } } });
  const totals = invoices.reduce((a: any, i: any) => ({ billed: a.billed + i.totalAmount, paid: a.paid + i.paidAmount, due: a.due + (i.totalAmount - i.paidAmount) }), { billed: 0, paid: 0, due: 0 });
  res.json({ totals, count: invoices.length, invoices: invoices.slice(0, 200) });
}));

export default router;
