# 🎓 College ERP

A production-ready, fully responsive **College Enterprise Resource Planning** system for Indian colleges.

**Architecture:** React (Vite + TypeScript + Tailwind) → REST API → Node.js/Express (TypeScript) → PostgreSQL (Prisma ORM)

## ✨ Features

- **10 Roles with configurable RBAC** — SUPER_ADMIN, PRINCIPAL, ADMIN, HOD, COORDINATOR, TEACHER, EXAM_CELL, ACCOUNTANT, STUDENT, PARENT
- **Common login** with JWT + refresh-token sessions, forgot/reset/change password, account activation/deactivation
- **College structure** — Departments → Courses → Academic Years → Semesters → Sections → Students (promotion preserves history)
- **Student & Teacher management** with auto-created login accounts, profile photos
- **HOD / Coordinator assignment**, **Subject allocation** (teacher ↔ subject ↔ section)
- **Timetable builder** per section with periods, publish/draft
- **Attendance** marking per class + summaries & reports
- **Exams, marks & results** — exam calendar, per-subject weightage, score entry, publish results
- **Fees** — fee structure, invoices, payments, receipts, dues
- **Notices** (targeted by role/department/course/section), **Documents** upload
- **Dashboards per role** with real DB aggregations
- **Audit logs** for every write action + configurable **system settings**
- Every protected endpoint verifies permissions **server-side** (never trust the frontend)

## 📁 Structure

```
college-erp/
├── server/          # Express + TypeScript + Prisma REST API  (port 5000)
│   └── src/
│       ├── permissions/   # single source of truth for permission catalog
│       ├── routes/        # auth, users, roles, academic, students, ...
│       ├── middleware/    # auth (JWT), requirePermission, scope, audit, errors
│       └── lib/           # prisma client, upload, token helpers
└── client/          # React + Vite + TypeScript + Tailwind      (port 5173)
    └── src/
        ├── auth/          # AuthContext, ProtectedRoute, permission hooks
        ├── layout/        # responsive sidebar/topbar shell
        ├── components/    # generic CRUD table + form builders, ui kit
        └── pages/         # login, dashboards per role, all modules
```

## 🚀 Local Development

Prerequisites: Node 18+, PostgreSQL (a local install or a cloud URL — Supabase/Neon/RDS anything that speaks Postgres).

```bash
# 1. Backend
cd server
npm install
cp .env.example .env        # set DATABASE_URL to your Postgres URL
npx prisma migrate dev      # creates schema
npm run seed                # roles, permissions + demo college (120 students)
npm run dev                 # API on http://localhost:5000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev                 # app on http://localhost:5173
```

Open http://localhost:5173 and sign in with any seeded account (see `server/prisma/SEED_ACCOUNTS.md`).

## ☁️ Deployment (independent frontend / backend)

**Backend (Render / Railway / Fly / any Node host)**
- Set env: `DATABASE_URL` (cloud Postgres), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_ORIGIN`, `NODE_ENV=production`
- Build: `npm ci && npx prisma generate && npm run build`
- Start: `npx prisma migrate deploy && node dist/index.js`

**Frontend (Vercel / Netlify / any static host)**
- Set env: `VITE_API_URL=https://<your-api-host>`
- Build: `npm ci && npm run build` → deploy the `dist/` folder

**Database** — never a local folder like `D:\data\ERP_DATA`; use a managed/cloud PostgreSQL so the same live DB is reachable from desktop, tablet and mobile browsers anywhere.

## 🔒 Security model

- Passwords hashed with **argon2id** (bcrypt fallback supported)
- **Access token** (15 min) + **rotating refresh token** (7 days) stored hashed in DB → list & revoke sessions
- Permissions live in the database (roles are editable at runtime); the backend catalog in `server/src/permissions/catalog.ts` is the single source of truth
- Data scoping enforced server-side: HOD → own department, Coordinator → own section, TEACHER → own allocations, STUDENT → self, PARENT → own children
- Zod validation on every mutation, rate limiting on auth, audit trail on all writes
