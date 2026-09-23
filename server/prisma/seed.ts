/* eslint-disable no-console */
import { PrismaClient, RoleName, Gender, DayOfWeek, AttendanceStatus } from '@prisma/client';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_GRANTS, expandGrants } from '../src/permissions/catalog';

const prisma = new PrismaClient();
const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Priya', 'Rahul', 'Neha', 'Karan', 'Pooja', 'Siddharth', 'Meera', 'Yash', 'Aisha', 'Riya', 'Aditya', 'Nisha', 'Varun', 'Tara', 'Kris', 'Anika', 'Dev', 'Ira', 'Jai', 'Lakshmi'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Kumar', 'Reddy', 'Nair', 'Iyer', 'Das', 'Mehta', 'Joshi', 'Rao', ' Bose', 'Chopra', 'Malhotra', 'Kapoor', 'Pillai', 'Menon', 'Bhatt'];
const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const pad = (n: number, l = 3) => String(n).padStart(l, '0');

async function main() {
  console.log('🌱 Seeding College ERP…');

  // reset (order matters for FKs)
  await prisma.$transaction([
    prisma.attendanceRecord.deleteMany(),
    prisma.examResult.deleteMany(),
    prisma.examSubject.deleteMany(),
    prisma.exam.deleteMany(),
    prisma.feePayment.deleteMany(),
    prisma.feeInvoiceItem.deleteMany(),
    prisma.feeInvoice.deleteMany(),
    prisma.feeStructure.deleteMany(),
    prisma.noticeRead.deleteMany(),
    prisma.notice.deleteMany(),
    prisma.document.deleteMany(),
    prisma.timetableSlot.deleteMany(),
    prisma.period.deleteMany(),
    prisma.teacherAllocation.deleteMany(),
    prisma.academicRecord.deleteMany(),
    prisma.parentLink.deleteMany(),
    prisma.studentProfile.deleteMany(),
    prisma.teacherProfile.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.sections.deleteMany(),
    prisma.semester.deleteMany(),
    prisma.course.deleteMany(),
    prisma.department.deleteMany(),
    prisma.academicYear.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.userSessionInfo.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.user.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
    prisma.systemSetting.deleteMany(),
  ]);

  // ── Permissions + Roles ────────────────────────────────────────────
  const permIdByKey: Record<string, number> = {};
  for (const p of PERMISSIONS) {
    const created = await prisma.permission.create({ data: p });
    permIdByKey[p.key] = created.id;
  }
  const roles: Record<string, number> = {};
  const roleMeta: { name: RoleName; label: string }[] = [
    { name: 'SUPER_ADMIN', label: 'Super Administrator' },
    { name: 'PRINCIPAL', label: 'Principal' },
    { name: 'ADMIN', label: 'Administrator' },
    { name: 'HOD', label: 'Head of Department' },
    { name: 'COORDINATOR', label: 'Coordinator' },
    { name: 'TEACHER', label: 'Teacher' },
    { name: 'EXAM_CELL', label: 'Examination Cell' },
    { name: 'ACCOUNTANT', label: 'Accountant' },
    { name: 'STUDENT', label: 'Student' },
    { name: 'PARENT', label: 'Parent' },
  ];
  for (const r of roleMeta) {
    const role = await prisma.role.create({ data: { name: r.name, label: r.label, isSystem: true } });
    roles[r.name] = role.id;
    const keys = expandGrants(r.name);
    await prisma.rolePermission.createMany({
      data: keys.map((k) => ({ roleId: role.id, permissionId: permIdByKey[k] })).filter((x) => x.permissionId),
    });
  }
  // SUPER_ADMIN wildcard — middleware treats '*:*' as full access
  const wildcard = await prisma.permission.upsert({
    where: { key: '*:*' },
    create: { key: '*:*', module: '*', action: '*', label: 'Full system access' },
    update: {},
  });
  await prisma.rolePermission.create({ data: { roleId: roles.SUPER_ADMIN, permissionId: wildcard.id } });

  // ── System settings ────────────────────────────────────────────────
  await prisma.systemSetting.createMany({
    data: [
      { key: 'college.name', value: 'Vidya Pratishthan Institute of Technology' },
      { key: 'college.short', value: 'VPIT' },
      { key: 'college.city', value: 'Pune, Maharashtra' },
      { key: 'college.affiliation', value: 'AKTU' },
    ],
  });

  // ── Academic year ──────────────────────────────────────────────────
  const ay = await prisma.academicYear.create({
    data: { label: '2026-27', startDate: new Date('2026-06-01'), endDate: new Date('2027-05-31'), isActive: true },
  });
  await prisma.academicYear.create({ data: { label: '2025-26', startDate: new Date('2025-06-01'), endDate: new Date('2026-05-31'), isActive: false } });

  // ── Departments, courses, semesters, sections ──────────────────────
  const deptDefs = [
    { code: 'CSE', name: 'Computer Science & Engineering' },
    { code: 'ECE', name: 'Electronics & Communication' },
    { code: 'ME', name: 'Mechanical Engineering' },
  ];
  const departments: any[] = [];
  for (const d of deptDefs) departments.push(await prisma.department.create({ data: d }));

  const courses: any[] = [];
  const courseDefs = [
    { code: 'BTCE', name: 'B.Tech CSE', dept: 'CSE' },
    { code: 'BTEC', name: 'B.Tech ECE', dept: 'ECE' },
    { code: 'BTME', name: 'B.Tech ME', dept: 'ME' },
  ];
  for (const c of courseDefs) {
    const dept = departments.find((d) => d.code === c.dept)!;
    const course = await prisma.course.create({ data: { code: c.code, name: c.name, departmentId: dept.id, durationSemesters: 4 } });
    // bootstrap 4 semesters for the demo
    for (let n = 1; n <= 4; n++) await prisma.semester.create({ data: { courseId: course.id, number: n, name: `Semester ${n}` } });
    courses.push(course);
  }

  // sections: A & B for semester 1 of each course (the fresh intake)
  const sections: any[] = [];
  for (const course of courses) {
    const sem1 = await prisma.semester.findFirst({ where: { courseId: course.id, number: 1 } });
    for (const name of ['A', 'B']) {
      const created = await prisma.sections.create({ data: { semesterId: sem1!.id, name, capacity: 60 } });
      sections.push({ ...created, courseId: course.id, departmentId: course.departmentId });
    }
  }

  // ── Teachers (incl. HODs & a coordinator) ──────────────────────────
  const teacherUsers: any[] = [];
  async function makeTeacher(code: string, deptId: string, designation: string, pw = 'teacher123') {
    const fullName = `${rnd(FIRST)} ${rnd(LAST)}`.trim();
    const email = `${code.toLowerCase()}@vpit.edu`;
    const user = await prisma.user.create({ data: { email, username: code, fullName, roleId: roles.TEACHER, passwordHash: await hash(pw), status: 'ACTIVE', mustChangePwd: false } });
    const tp = await prisma.teacherProfile.create({ data: { employeeCode: code, departmentId: deptId, designation, userId: user.id, qualification: 'M.Tech', joiningDate: new Date('2020-07-01') } });
    return { user, tp, fullName };
  }

  for (const dept of departments) {
    // 1 HOD + 3 faculty per department
    const hod = await makeTeacher(`EMP-${dept.code}-01`, dept.id, 'Professor & HOD');
    await prisma.department.update({ where: { id: dept.id }, data: { hodId: hod.user.id } });
    // promote that teacher user to HOD role too (keeps the person, elevates the role)
    await prisma.user.update({ where: { id: hod.user.id }, data: { roleId: roles.HOD } });
    for (let i = 2; i <= 4; i++) teacherUsers.push(await makeTeacher(`EMP-${dept.code}-0${i}`, dept.id, 'Assistant Professor'));
  }

  // ── Subjects (4 per course semester-1) ─────────────────────────────
  const subjectBank: Record<string, { code: string; name: string }[]> = {
    BTCE: [{ code: 'CS101', name: 'Programming in C' }, { code: 'CS102', name: 'Engineering Mathematics I' }, { code: 'CS103', name: 'Digital Logic' }, { code: 'CS104', name: 'Problem Solving Lab' }],
    BTEC: [{ code: 'EC101', name: 'Circuit Theory' }, { code: 'EC102', name: 'Engineering Mathematics I' }, { code: 'EC103', name: 'Signals & Systems' }, { code: 'EC104', name: 'Electronics Lab' }],
    BTME: [{ code: 'ME101', name: 'Engineering Mechanics' }, { code: 'ME102', name: 'Engineering Mathematics I' }, { code: 'ME103', name: 'Thermodynamics' }, { code: 'ME104', name: 'Workshop Lab' }],
  };
  const subjects: any[] = [];
  for (const course of courses) {
    const sem1 = await prisma.semester.findFirst({ where: { courseId: course.id, number: 1 } });
    for (const s of subjectBank[course.code]) {
      subjects.push(await prisma.subject.create({ data: { code: s.code, name: s.name, courseId: course.id, departmentId: course.departmentId, semesterId: sem1!.id, credits: s.name.includes('Lab') ? 2 : 3, type: s.name.includes('Lab') ? 'LAB' : 'THEORY' } }));
    }
  }

  // ── Allocations: assign each dept subject to its faculty ───────────
  for (const course of courses) {
    const deptTeachers = await prisma.teacherProfile.findMany({ where: { departmentId: course.departmentId } });
    const courseSubjects = subjects.filter((s) => s.courseId === course.id);
    const courseSections = sections.filter((sec) => sec.courseId === course.id);
    let ti = 0;
    for (const sec of courseSections) {
      for (const sub of courseSubjects) {
        const teacher = deptTeachers[ti % deptTeachers.length];
        await prisma.teacherAllocation.create({ data: { teacherId: teacher.id, subjectId: sub.id, sectionId: sec.id, role: 'PRIMARY' } });
        ti++;
      }
    }
    // coordinator: first section of the course handled by first teacher
    if (courseSections[0]) {
      await prisma.sections.update({ where: { id: courseSections[0].id }, data: { coordinatorId: deptTeachers[0].userId } });
      await prisma.user.update({ where: { id: deptTeachers[0].userId }, data: { roleId: roles.COORDINATOR } });
    }
  }

  // ── Periods + a sample timetable for every section ─────────────────
  const periods = [
    { number: 1, label: 'P1', startTime: '09:00', endTime: '09:50' },
    { number: 2, label: 'P2', startTime: '09:50', endTime: '10:40' },
    { number: 3, label: 'P3', startTime: '11:00', endTime: '11:50', breakAfter: true },
    { number: 4, label: 'P4', startTime: '11:50', endTime: '12:40' },
    { number: 5, label: 'P5', startTime: '13:30', endTime: '14:20' },
  ];
  for (const p of periods) await prisma.period.create({ data: p });
  const days = [DayOfWeek.MON, DayOfWeek.TUE, DayOfWeek.WED, DayOfWeek.THU, DayOfWeek.FRI];
  for (const sec of sections) {
    const allocs = await prisma.teacherAllocation.findMany({ where: { sectionId: sec.id }, include: { subject: true } });
    let k = 0;
    for (const day of days) {
      for (let pn = 1; pn <= 5; pn++) {
        const a = allocs[k % allocs.length];
        k++;
        if (!a) continue;
        await prisma.timetableSlot.create({ data: { sectionId: sec.id, day, periodNumber: pn, subjectId: a.subjectId, teacherId: a.teacherId, room: `${sec.name}-${pn}`, isPublished: true } });
      }
    }
  }

  // ── Students: 120 across the 6 sections ────────────────────────────
  const perSection = Math.ceil(120 / sections.length);
  let enrolled = 0;
  const allStudents: any[] = [];
  for (const sec of sections) {
    const sem = await prisma.semester.findUnique({ where: { id: sec.semesterId }, include: { course: true } });
    for (let i = 1; i <= perSection && enrolled < 120; i++) {
      enrolled++;
      const fullName = `${rnd(FIRST)} ${rnd(LAST)}`.trim();
      const rollNo = `${sem!.course.code}-${sec.name}-${pad(i)}`;
      const email = `roll.${rollNo.toLowerCase()}@student.vpit.edu`;
      const gender = Math.random() > 0.5 ? Gender.MALE : Gender.FEMALE;
      const user = await prisma.user.create({ data: { email, username: rollNo, fullName, roleId: roles.STUDENT, passwordHash: await hash('student123'), status: 'ACTIVE', mustChangePwd: false } });
      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id, enrollmentNo: `ENR${pad(100000 + enrolled, 6)}`, rollNo,
          courseId: sem!.courseId, departmentId: sem!.course.departmentId, semesterId: sem!.id, sectionId: sec.id, batchId: ay.id,
          gender, dob: new Date(2007, Math.floor(Math.random() * 12), 10), admissionDate: new Date('2026-06-15'),
          fatherName: `${rnd(FIRST)} ${rnd(LAST)}`, motherName: `${rnd(FIRST)} ${rnd(LAST)}`, guardianPhone: `98${pad(Math.floor(Math.random() * 999999), 8)}`,
          address: rnd(['Pune', 'Nashik', 'Nagpur', 'Mumbai', 'Navi Mumbai']) + ', MH',
        },
      });
      allStudents.push(student);
    }
  }

  // ── Attendance: last 20 working days, ~88% present ─────────────────
  const attendanceDates: Date[] = [];
  let cur = new Date(); cur.setHours(0, 0, 0, 0);
  while (attendanceDates.length < 20) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) attendanceDates.push(new Date(cur));
    cur.setDate(cur.getDate() - 1);
  }
  for (const sec of sections) {
    const secStudents = allStudents.filter((s) => s.sectionId === sec.id);
    const secAllocs = await prisma.teacherAllocation.findMany({ where: { sectionId: sec.id } });
    const markerId = secAllocs[0]?.teacherId;
    const markerUser = markerId ? (await prisma.teacherProfile.findUnique({ where: { id: markerId } }))?.userId : null;
    for (const date of attendanceDates) {
      for (let pn = 1; pn <= 5; pn++) {
        for (const s of secStudents) {
          const roll = Math.random();
          const status: AttendanceStatus = roll < 0.86 ? AttendanceStatus.PRESENT : roll < 0.94 ? AttendanceStatus.ABSENT : roll < 0.98 ? AttendanceStatus.LATE : AttendanceStatus.EXCUSED;
          await prisma.attendanceRecord.create({ data: { studentId: s.id, date, periodNumber: pn, sectionId: sec.id, status, markedBy: markerUser || undefined } });
        }
      }
    }
  }

  // ── Exam + marks + results ─────────────────────────────────────────
  const exam = await prisma.exam.create({ data: { name: 'Mid Semester I – 2026-27', type: 'MID_SEM', academicYearId: ay.id, startDate: new Date('2026-09-10'), endDate: new Date('2026-09-20'), status: 'RESULT_PUBLISHED' } });
  const sem1Subjects = subjects.filter((s) => s.name.includes('Math') || true).slice(0, 4);
  for (const course of courses) {
    const courseSubs = subjects.filter((s) => s.courseId === course.id).slice(0, 4);
    for (const sub of courseSubs) {
      const es = await prisma.examSubject.create({ data: { examId: exam.id, subjectId: sub.id, maxMarks: 30, passMarks: 12, weightage: 100, date: new Date('2026-09-12') } });
      const studentsInSem = allStudents.filter((s) => s.semesterId === sub.semesterId);
      for (const st of studentsInSem) {
        const absent = Math.random() < 0.03;
        const marks = absent ? null : Math.floor(Math.random() * 19) + 11; // 11..29
        const pct = marks == null ? 0 : (marks / 30) * 100;
        await prisma.examResult.create({ data: { examSubjectId: es.id, studentId: st.id, marksObtained: marks, status: absent ? 'ABSENT' : pct >= 40 ? 'PASS' : 'FAIL', grade: absent ? null : pct >= 90 ? 'O' : pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B+' : pct >= 50 ? 'B' : pct >= 40 ? 'C' : 'F', isPublished: true, enteredBy: (await prisma.user.findFirst({ where: { roleId: roles.EXAM_CELL } }))?.id } });
      }
    }
  }
  // exam cell user
  await prisma.user.create({ data: { email: 'exam.cell@vpit.edu', username: 'EXAMCELL', fullName: 'Examination Cell', roleId: roles.EXAM_CELL, passwordHash: await hash('exam12345'), mustChangePwd: false } });

  // ── Fees ───────────────────────────────────────────────────────────
  const accountant = await prisma.user.create({ data: { email: 'accounts@vpit.edu', username: 'ACCOUNTS', fullName: 'Rakesh Accounts', roleId: roles.ACCOUNTANT, passwordHash: await hash('fees12345'), mustChangePwd: false } });
  const feeStruct = await prisma.feeStructure.create({ data: { name: 'Semester 1 Tuition Fee 2026-27', amount: 45000, academicYearId: ay.id, dueDayOfMonth: 10 } });
  for (const st of allStudents) {
    const inv = await prisma.feeInvoice.create({ data: { invoiceNo: `INV-${pad(parseInt(st.enrollmentNo.replace('ENR', '')), 6)}`, studentId: st.id, title: feeStruct.name, totalAmount: feeStruct.amount, dueDate: new Date('2026-07-10'), status: 'ISSUED', academicYearId: ay.id, items: { create: [{ description: 'Tuition', amount: 35000 }, { description: 'Exam + Lab', amount: 10000 }] } } });
    if (Math.random() < 0.5) {
      const paid = Math.random() < 0.7 ? feeStruct.amount : 20000;
      await prisma.feePayment.create({ data: { receiptNo: `RCPT-${inv.invoiceNo.slice(4)}`, invoiceId: inv.id, amount: paid, method: rnd(['CASH', 'UPI', 'NETBANKING'] as any), recordedBy: accountant.id } });
      await prisma.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid >= feeStruct.amount ? 'PAID' : 'PARTIALLY_PAID' } });
    }
  }

  // ── Parents for a few students ─────────────────────────────────────
  for (const st of allStudents.slice(0, 5)) {
    const email = `parent.${st.rollNo.toLowerCase()}@gmail.com`;
    const parent = await prisma.user.create({ data: { email, username: `PARENT.${st.rollNo}`, fullName: st.fatherName || 'Parent ' + st.rollNo, roleId: roles.PARENT, passwordHash: await hash('parent123'), mustChangePwd: false } });
    await prisma.parentLink.create({ data: { parentId: parent.id, studentId: st.id, relation: 'FATHER' } });
  }

  // ── Notices ────────────────────────────────────────────────────────
  const principal = await prisma.user.create({ data: { email: 'principal@vpit.edu', username: 'PRINCIPAL', fullName: 'Dr. Anil Deshmukh', roleId: roles.PRINCIPAL, passwordHash: await hash('principal123'), mustChangePwd: false } });
  await prisma.notice.create({ data: { title: 'Welcome to Academic Year 2026-27', body: 'Classes commence from 15 June 2026. Report to your respective sections.', priority: 'HIGH', createdBy: principal.id, publishAt: new Date('2026-06-10') } });
  await prisma.notice.create({ data: { title: 'Mid Semester Examination Schedule', body: 'MID-I exams run 10–20 September. Download the timetable from the documents section.', createdBy: (await prisma.user.findFirst({ where: { roleId: roles.EXAM_CELL } }))!.id, publishAt: new Date('2026-09-01') } });
  await prisma.notice.create({ data: { title: 'Fee Payment Reminder', body: 'Kindly clear Semester 1 dues before 10 July to avoid late fee.', createdBy: accountant.id, publishAt: new Date('2026-07-01') } });

  // ── Super admin (last, so all is ready) ────────────────────────────
  await prisma.user.create({ data: { email: 'admin@vpit.edu', username: 'SUPERADMIN', fullName: 'System Administrator', roleId: roles.SUPER_ADMIN, passwordHash: await hash('admin12345'), mustChangePwd: false } });
  await prisma.user.create({ data: { email: 'office@vpit.edu', username: 'OFFICE', fullName: 'Office Administrator', roleId: roles.ADMIN, passwordHash: await hash('admin12345'), mustChangePwd: false } });

  console.log('✅ Seed complete.');
  console.log('─── Logins (username / password) ───');
  console.log('  SUPER_ADMIN : admin@vpit.edu / admin12345');
  console.log('  PRINCIPAL   : principal@vpit.edu / principal123');
  console.log('  ADMIN       : office@vpit.edu / admin12345');
  console.log('  HOD         : emp-cse-01 / teacher123');
  console.log('  COORDINATOR : see a EMP-<DEPT>-02 account / teacher123');
  console.log('  TEACHER     : emp-cse-02 / teacher123');
  console.log('  EXAM_CELL   : EXAMCELL / exam12345');
  console.log('  ACCOUNTANT  : ACCOUNTS / fees12345');
  console.log('  STUDENT     : BTCE-A-001 / student123');
  console.log('  PARENT      : PARENT.BTCE-A-001 / parent123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
