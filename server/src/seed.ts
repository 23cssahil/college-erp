/**
 * Seed — idempotent bootstrap for the College ERP on MongoDB.
 *
 * This creates ONLY the real, functional backbone of the system:
 *   • the permission catalog + the 10 configurable roles (with default grants)
 *   • one login account PER ROLE (so you can immediately sign in and test RBAC)
 *   • the active academic year + basic college settings
 *
 * It deliberately does NOT fabricate students, teachers, departments, invoices,
 * attendance, etc. That data belongs to the college and is entered through the
 * app — there is no fake demo data to clean up.
 *
 * Run with:  npm run seed
 */
import { connectDb, disconnectDb } from './lib/db';
import { hashPassword } from './lib/tokens';
import { PERMISSIONS, expandGrants } from './permissions/catalog';
import { Permission, Role, User, AcademicYear, SystemSetting, RoleName } from './models';
import { env } from './config';

const ROLES: { name: (typeof RoleName)[number]; label: string }[] = [
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

// One real login per role. The initial password MUST come from the SEED_PASSWORD
// env var (never hardcoded in the repo). Accounts are flagged mustChangePwd:true.
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || '';
const SEED_USERS: { username: string; fullName: string; role: string }[] = [
  { username: 'superadmin', fullName: 'Super Administrator', role: 'SUPER_ADMIN' },
  { username: 'principal', fullName: 'Principal', role: 'PRINCIPAL' },
  { username: 'admin', fullName: 'Administrator', role: 'ADMIN' },
  { username: 'hod', fullName: 'Head of Department', role: 'HOD' },
  { username: 'coordinator', fullName: 'Coordinator', role: 'COORDINATOR' },
  { username: 'teacher', fullName: 'Teacher', role: 'TEACHER' },
  { username: 'examcell', fullName: 'Examination Cell', role: 'EXAM_CELL' },
  { username: 'accountant', fullName: 'Accountant', role: 'ACCOUNTANT' },
  { username: 'student', fullName: 'Student', role: 'STUDENT' },
  { username: 'parent', fullName: 'Parent', role: 'PARENT' },
];

async function main() {
  console.log('🌱 Seeding College ERP (MongoDB)…');
  await connectDb();

  // Wipe only the auth/RBAC backbone so the run is idempotent. Nothing else
  // (real academic data) is touched.
  await Promise.all([
    Permission.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
    SystemSetting.deleteMany({}),
    AcademicYear.deleteMany({}),
  ]);

  // ── Permissions (incl. the super wildcard) ─────────────────────────
  const permDocs = [...PERMISSIONS, { key: '*:*', module: '*', action: '*', label: 'Full system access' }];
  await Permission.insertMany(permDocs.map((p) => ({ ...p })));
  console.log(`  ✓ ${permDocs.length} permissions`);

  // ── Roles with denormalized permission keys ────────────────────────
  const roleIdByName: Record<string, any> = {};
  for (const r of ROLES) {
    const keys = expandGrants(r.name);
    const role = await Role.create({ name: r.name, label: r.label, isSystem: true, permissionKeys: keys });
    roleIdByName[r.name] = role._id;
  }
  console.log(`  ✓ ${ROLES.length} roles`);

  // ── One real user per role ─────────────────────────────────────────
  if (!DEFAULT_PASSWORD) {
    throw new Error(
      'SEED_PASSWORD env var is required. Set it in server/.env (a strong password, min 8 chars) before seeding. It is intentionally NOT hardcoded so it never leaks into the repo.',
    );
  }
  if (DEFAULT_PASSWORD.length < 8) {
    throw new Error('SEED_PASSWORD must be at least 8 characters.');
  }
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  for (const u of SEED_USERS) {
    await User.create({
      email: `${u.username}@college.edu`,
      username: u.username,
      passwordHash,
      fullName: u.fullName,
      status: 'ACTIVE',
      mustChangePwd: true,
      roleId: roleIdByName[u.role],
    });
  }
  console.log(`  ✓ ${SEED_USERS.length} user accounts (initial password from SEED_PASSWORD env; change on first login)`);

  // ── Active academic year (operational config, not fake data) ───────
  const now = new Date();
  const y = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1; // academic year starts June
  await AcademicYear.create({
    label: `${y}-${String(y + 1).slice(2)}`,
    startDate: new Date(`${y}-06-01`),
    endDate: new Date(`${y + 1}-05-31`),
    isActive: true,
  });
  console.log('  ✓ active academic year');

  // ── Basic settings (editable later from the UI) ────────────────────
  await SystemSetting.insertMany([
    { key: 'college.name', value: env.mongoDbName === 'college_erp' ? 'College ERP' : 'College ERP', label: 'College name' },
    { key: 'college.short', value: 'ERP', label: 'Short name' },
  ]);
  console.log('  ✓ system settings');

  console.log('\n✅ Seed complete. Sign in with any role username (e.g. "superadmin") and the SEED_PASSWORD you set; you\'ll be asked to change it on first login.');
}

main()
  .then(() => disconnectDb())
  .catch(async (err) => {
    console.error('❌ Seed failed:', err);
    await disconnectDb();
    process.exit(1);
  });
