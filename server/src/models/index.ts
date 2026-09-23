import mongoose, { Schema, Types } from 'mongoose';

/**
 * Mongoose model layer for the College ERP.
 *
 * Design notes (mirrors the old Prisma/Postgres schema, adapted to Mongo):
 *  - Every document uses an ObjectId `_id`, serialized to a string `id`
 *    (so the frontend's JSON contract is byte-for-byte compatible with the
 *    old cuid-based ids).
 *  - Relations are stored as ObjectId refs. Nested objects in API responses are
 *    produced at query time with `populate({ path, as })`, so a stored
 *    `courseId` still surfaces as a `course` object exactly like Prisma's
 *    `include` did.
 *  - Role→permission grants are denormalized into `role.permissionKeys`
 *    (Mongo-idiomatic; drops the old RolePermission join table).
 *  - Fee invoice items + payments are embedded sub-documents.
 */

// ─────────────────────────────── ENUMS ───────────────────────────────
export const RoleName = ['SUPER_ADMIN', 'PRINCIPAL', 'ADMIN', 'HOD', 'COORDINATOR', 'TEACHER', 'EXAM_CELL', 'ACCOUNTANT', 'STUDENT', 'PARENT'] as const;
export const UserStatus = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const Gender = ['MALE', 'FEMALE', 'OTHER'] as const;
export const CourseType = ['THEORY', 'LAB', 'THEORY_LAB'] as const;
export const ExamType = ['INTERNAL', 'MID_SEM', 'FINAL_SEM', 'SUPPLEMENTARY', 'PRACTICAL'] as const;
export const ResultStatus = ['PASS', 'FAIL', 'ABSENT', 'WITHHELD'] as const;
export const InvoiceStatus = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export const PaymentMethod = ['CASH', 'UPI', 'CARD', 'NETBANKING', 'CHEQUE', 'DD'] as const;
export const DocCategory = ['NOTICE', 'RESULT', 'FEE_RECEIPT', 'SYLLABUS', 'FORM', 'GOVERNMENT', 'OTHER'] as const;
export const AttendanceStatus = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export const DayOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const O = Schema.Types.ObjectId;

/** Case-insensitive "contains" regex with escaped user input. */
export const iRegex = (s: string) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * Mongoose 9 does not honour `populate({ as })`, so a populated ref simply
 * *replaces* its FK field (e.g. `courseId` becomes the Course document). This
 * runs on every serialized document and restores the Prisma-style shape:
 *   - `course`  → the populated object
 *   - `courseId`→ back to the plain id string (the FK scalar)
 * Only single populated refs (objects carrying a string `id`) are touched;
 * arrays (e.g. `rolesVisible`) and embedded sub-docs are left as-is.
 */
const RELATION_ALIAS: Record<string, string> = {
  createdBy: 'author',
  uploadedBy: 'uploader',
  markedBy: 'markedByUser',
  enteredBy: 'enteredByUser',
};
function reshapePopulated(ret: any) {
  for (const key of Object.keys(ret)) {
    const v = ret[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string') {
      const alias = RELATION_ALIAS[key] || (key.endsWith('Id') ? key.slice(0, -2) : undefined);
      if (alias && !(alias in ret)) {
        ret[alias] = v;
        ret[key] = v.id;
      }
    }
  }
}

/** Shared serializer so responses match the old Prisma shape (`id`, no `_id`/`__v`). */
function serialize(schema: Schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      delete ret._id;
      reshapePopulated(ret);
      return ret;
    },
  });
  schema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      delete ret._id;
      reshapePopulated(ret);
      return ret;
    },
  });
}

// ─────────────────────────────── AUTH & RBAC ───────────────────────────────
const PermissionSchema = new Schema(
  { key: { type: String, required: true, unique: true }, module: String, action: String, label: String },
  { timestamps: true },
);
serialize(PermissionSchema);

const RoleSchema = new Schema(
  {
    name: { type: String, enum: RoleName, required: true, unique: true },
    label: { type: String, required: true },
    isSystem: { type: Boolean, default: true },
    permissionKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);
serialize(RoleSchema);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: String,
    photoUrl: String,
    status: { type: String, enum: UserStatus, default: 'ACTIVE' },
    isVerified: { type: Boolean, default: false },
    mustChangePwd: { type: Boolean, default: false },
    lastLoginAt: Date,
    roleId: { type: O, ref: 'Role', required: true },
  },
  { timestamps: true },
);
UserSchema.index({ createdAt: -1 });
serialize(UserSchema);

const RefreshTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: O, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    userAgent: String,
    ip: String,
  },
  { timestamps: true },
);
serialize(RefreshTokenSchema);

const UserSessionInfoSchema = new Schema(
  {
    userId: { type: O, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    device: String,
    ip: String,
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
serialize(UserSessionInfoSchema);

const PasswordResetTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: O, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);
serialize(PasswordResetTokenSchema);

// ─────────────────────────────── COLLEGE STRUCTURE ───────────────────────────────
const AcademicYearSchema = new Schema(
  {
    label: { type: String, required: true, unique: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);
serialize(AcademicYearSchema);

const DepartmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    isActive: { type: Boolean, default: true },
    // A user may lead at most one department. Kept as an explicit partial index
    // (not the field `unique` shorthand) because Mongoose drops
    // `partialFilterExpression` from field-level unique — a plain unique index
    // indexes MISSING hodId as null, so the 2nd unassigned dept collides (E11000 → 409).
    hodId: { type: O, ref: 'User' },
    academicYearId: { type: O, ref: 'AcademicYear' },
  },
  { timestamps: true },
);
// unique among real users only — partial filter excludes null/missing hodId
DepartmentSchema.index({ hodId: 1 }, { unique: true, partialFilterExpression: { hodId: { $type: 'objectId' } } });
serialize(DepartmentSchema);

const CourseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, default: 'DEGREE' },
    durationSemesters: { type: Number, default: 8 },
    isActive: { type: Boolean, default: true },
    departmentId: { type: O, ref: 'Department', required: true },
  },
  { timestamps: true },
);
serialize(CourseSchema);

const SemesterSchema = new Schema(
  {
    number: { type: Number, required: true },
    name: String,
    isActive: { type: Boolean, default: true },
    courseId: { type: O, ref: 'Course', required: true },
  },
  { timestamps: true },
);
SemesterSchema.index({ courseId: 1, number: 1 }, { unique: true });
serialize(SemesterSchema);

const SectionSchema = new Schema(
  {
    name: { type: String, required: true },
    capacity: { type: Number, default: 60 },
    isActive: { type: Boolean, default: true },
    semesterId: { type: O, ref: 'Semester', required: true },
    coordinatorId: { type: O, ref: 'User' },
  },
  { timestamps: true },
);
SectionSchema.index({ semesterId: 1, name: 1 }, { unique: true });
serialize(SectionSchema);

// ─────────────────────────────── PEOPLE ───────────────────────────────
const StudentProfileSchema = new Schema(
  {
    enrollmentNo: { type: String, required: true, unique: true },
    rollNo: { type: String, required: true },
    dob: Date,
    gender: { type: String, enum: Gender },
    fatherName: String,
    motherName: String,
    guardianPhone: String,
    address: String,
    admissionDate: { type: Date, default: Date.now },
    status: { type: String, default: 'STUDYING' },
    userId: { type: O, ref: 'User', required: true, unique: true },
    courseId: { type: O, ref: 'Course', required: true },
    departmentId: { type: O, ref: 'Department', required: true },
    semesterId: { type: O, ref: 'Semester', required: true },
    sectionId: { type: O, ref: 'Section' },
    batchId: { type: O, ref: 'AcademicYear' },
  },
  { timestamps: true },
);
StudentProfileSchema.index({ sectionId: 1, rollNo: 1 }, { unique: true });
serialize(StudentProfileSchema);

const AcademicRecordSchema = new Schema(
  {
    studentId: { type: O, ref: 'StudentProfile', required: true },
    academicYearId: { type: O, ref: 'AcademicYear' },
    semesterId: { type: O, ref: 'Semester' },
    sectionId: { type: O, ref: 'Section' },
    remark: String,
    datedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
serialize(AcademicRecordSchema);

const ParentLinkSchema = new Schema(
  {
    parentId: { type: O, ref: 'User', required: true },
    studentId: { type: O, ref: 'StudentProfile', required: true },
    relation: { type: String, default: 'GUARDIAN' },
  },
  { timestamps: true },
);
ParentLinkSchema.index({ parentId: 1, studentId: 1 }, { unique: true });
serialize(ParentLinkSchema);

const TeacherProfileSchema = new Schema(
  {
    employeeCode: { type: String, required: true, unique: true },
    departmentId: { type: O, ref: 'Department', required: true },
    designation: { type: String, default: 'Assistant Professor' },
    qualification: String,
    specialization: String,
    joiningDate: Date,
    status: { type: String, default: 'ACTIVE' },
    userId: { type: O, ref: 'User', required: true, unique: true },
  },
  { timestamps: true },
);
serialize(TeacherProfileSchema);

const TeacherAllocationSchema = new Schema(
  {
    teacherId: { type: O, ref: 'TeacherProfile', required: true },
    subjectId: { type: O, ref: 'Subject', required: true },
    sectionId: { type: O, ref: 'Section', required: true },
    role: { type: String, default: 'PRIMARY' },
    academicYearId: { type: O, ref: 'AcademicYear' },
  },
  { timestamps: true },
);
TeacherAllocationSchema.index({ teacherId: 1, subjectId: 1, sectionId: 1, role: 1 }, { unique: true });
serialize(TeacherAllocationSchema);

// ─────────────────────────────── ACADEMICS ───────────────────────────────
const SubjectSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    credits: { type: Number, default: 3 },
    type: { type: String, enum: CourseType, default: 'THEORY' },
    ltp: String,
    isActive: { type: Boolean, default: true },
    courseId: { type: O, ref: 'Course', required: true },
    departmentId: { type: O, ref: 'Department', required: true },
    semesterId: { type: O, ref: 'Semester', required: true },
  },
  { timestamps: true },
);
serialize(SubjectSchema);

const PeriodSchema = new Schema(
  {
    number: { type: Number, required: true, unique: true },
    label: { type: String, default: 'P1' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakAfter: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
serialize(PeriodSchema);

const TimetableSlotSchema = new Schema(
  {
    day: { type: String, enum: DayOfWeek, required: true },
    periodNumber: { type: Number, required: true },
    subjectId: { type: O, ref: 'Subject' },
    teacherId: { type: O, ref: 'TeacherProfile' },
    sectionId: { type: O, ref: 'Section', required: true },
    room: String,
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true },
);
TimetableSlotSchema.index({ sectionId: 1, day: 1, periodNumber: 1 }, { unique: true });
serialize(TimetableSlotSchema);

const AttendanceRecordSchema = new Schema(
  {
    studentId: { type: O, ref: 'StudentProfile', required: true },
    date: { type: Date, required: true },
    periodNumber: { type: Number, required: true },
    sectionId: { type: O, ref: 'Section', required: true },
    subjectId: { type: O, ref: 'Subject' },
    status: { type: String, enum: AttendanceStatus, default: 'PRESENT' },
    remarks: String,
    markedBy: { type: O, ref: 'User' },
  },
  { timestamps: true },
);
AttendanceRecordSchema.index({ studentId: 1, date: 1, periodNumber: 1 }, { unique: true });
serialize(AttendanceRecordSchema);

// ─────────────────────────────── EXAMS & RESULTS ───────────────────────────────
const ExamSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ExamType, required: true },
    academicYearId: { type: O, ref: 'AcademicYear', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, default: 'SCHEDULED' },
  },
  { timestamps: true },
);
serialize(ExamSchema);

const ExamSubjectSchema = new Schema(
  {
    examId: { type: O, ref: 'Exam', required: true },
    subjectId: { type: O, ref: 'Subject', required: true },
    date: Date,
    startTime: String,
    endTime: String,
    maxMarks: { type: Number, default: 100 },
    passMarks: { type: Number, default: 40 },
    weightage: { type: Number, default: 100 },
    examCenter: String,
  },
  { timestamps: true },
);
ExamSubjectSchema.index({ examId: 1, subjectId: 1 }, { unique: true });
serialize(ExamSubjectSchema);

const ExamResultSchema = new Schema(
  {
    examSubjectId: { type: O, ref: 'ExamSubject', required: true },
    studentId: { type: O, ref: 'StudentProfile', required: true },
    marksObtained: Number,
    grade: String,
    status: { type: String, enum: ResultStatus, default: 'WITHHELD' },
    isPublished: { type: Boolean, default: false },
    enteredBy: { type: O, ref: 'User' },
  },
  { timestamps: true },
);
ExamResultSchema.index({ examSubjectId: 1, studentId: 1 }, { unique: true });
serialize(ExamResultSchema);

// ─────────────────────────────── FEES ───────────────────────────────
const FeeStructureSchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    courseId: { type: O, ref: 'Course' },
    semesterId: { type: O, ref: 'Semester' },
    academicYearId: { type: O, ref: 'AcademicYear' },
    isMandatory: { type: Boolean, default: true },
    dueDayOfMonth: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
serialize(FeeStructureSchema);

const InvoiceItemSchema = new Schema(
  { description: String, amount: Number },
  { _id: false },
);
const PaymentSchema = new Schema(
  {
    receiptNo: String,
    amount: Number,
    method: String,
    txnRef: String,
    paidAt: { type: Date, default: Date.now },
    recordedBy: { type: O, ref: 'User' },
    remarks: String,
  },
  { _id: false },
);
const FeeInvoiceSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    studentId: { type: O, ref: 'StudentProfile', required: true },
    title: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: InvoiceStatus, default: 'DRAFT' },
    academicYearId: { type: O, ref: 'AcademicYear' },
    items: { type: [InvoiceItemSchema], default: [] },
    payments: { type: [PaymentSchema], default: [] },
  },
  { timestamps: true },
);
serialize(FeeInvoiceSchema);

// ─────────────────────────────── NOTICES & DOCS ───────────────────────────────
const NoticeSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    priority: { type: String, default: 'NORMAL' },
    publishAt: { type: Date, default: Date.now },
    expiryAt: Date,
    createdBy: { type: O, ref: 'User', required: true },
    rolesVisible: { type: [O], ref: 'Role', default: [] },
    deptsVisible: { type: [O], ref: 'Department', default: [] },
    coursesVisible: { type: [O], ref: 'Course', default: [] },
    sectionsVisible: { type: [O], ref: 'Section', default: [] },
  },
  { timestamps: true },
);
serialize(NoticeSchema);

const NoticeReadSchema = new Schema(
  {
    noticeId: { type: O, ref: 'Notice', required: true },
    userId: { type: O, ref: 'User', required: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
NoticeReadSchema.index({ noticeId: 1, userId: 1 }, { unique: true });
serialize(NoticeReadSchema);

const DocumentSchema = new Schema(
  {
    title: { type: String, required: true },
    category: { type: String, enum: DocCategory, default: 'OTHER' },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    mimeType: String,
    sizeKB: Number,
    uploadedBy: { type: O, ref: 'User', required: true },
    academicYearId: { type: O, ref: 'AcademicYear' },
    rolesVisible: { type: [O], ref: 'Role', default: [] },
  },
  { timestamps: true },
);
serialize(DocumentSchema);

// ─────────────────────────────── SYSTEM ───────────────────────────────
const AuditLogSchema = new Schema(
  {
    userId: { type: O, ref: 'User' },
    action: String,
    entity: String,
    entityId: String,
    detail: String,
    ip: String,
  },
  { timestamps: true },
);
AuditLogSchema.index({ entity: 1, entityId: 1 });
AuditLogSchema.index({ createdAt: -1 });
serialize(AuditLogSchema);

const SystemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: String,
    label: String,
  },
  { timestamps: true },
);
serialize(SystemSettingSchema);

// ─────────────────────────────── EXPORTS ───────────────────────────────
export const Permission = mongoose.model('Permission', PermissionSchema);
export const Role = mongoose.model('Role', RoleSchema);
export const User = mongoose.model('User', UserSchema);
export const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema);
export const UserSessionInfo = mongoose.model('UserSessionInfo', UserSessionInfoSchema);
export const PasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
export const AcademicYear = mongoose.model('AcademicYear', AcademicYearSchema);
export const Department = mongoose.model('Department', DepartmentSchema);
export const Course = mongoose.model('Course', CourseSchema);
export const Semester = mongoose.model('Semester', SemesterSchema);
export const Section = mongoose.model('Section', SectionSchema);
export const StudentProfile = mongoose.model('StudentProfile', StudentProfileSchema);
export const AcademicRecord = mongoose.model('AcademicRecord', AcademicRecordSchema);
export const ParentLink = mongoose.model('ParentLink', ParentLinkSchema);
export const TeacherProfile = mongoose.model('TeacherProfile', TeacherProfileSchema);
export const TeacherAllocation = mongoose.model('TeacherAllocation', TeacherAllocationSchema);
export const Subject = mongoose.model('Subject', SubjectSchema);
export const Period = mongoose.model('Period', PeriodSchema);
export const TimetableSlot = mongoose.model('TimetableSlot', TimetableSlotSchema);
export const AttendanceRecord = mongoose.model('AttendanceRecord', AttendanceRecordSchema);
export const Exam = mongoose.model('Exam', ExamSchema);
export const ExamSubject = mongoose.model('ExamSubject', ExamSubjectSchema);
export const ExamResult = mongoose.model('ExamResult', ExamResultSchema);
export const FeeStructure = mongoose.model('FeeStructure', FeeStructureSchema);
export const FeeInvoice = mongoose.model('FeeInvoice', FeeInvoiceSchema);
export const Notice = mongoose.model('Notice', NoticeSchema);
export const NoticeRead = mongoose.model('NoticeRead', NoticeReadSchema);
export const Document = mongoose.model('Document', DocumentSchema);
export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
export const SystemSetting = mongoose.model('SystemSetting', SystemSettingSchema);

export type OID = Types.ObjectId;
