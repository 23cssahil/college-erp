# 🎓 College ERP — Use Manual (Login + Kaise Chalayein)

Ye manual aapke **College ERP** (MongoDB + Express + React) ka poora user guide hai — login se lekar har module tak, step-by-step.

---

## 1. System kya hai (ek nazar mein)

College ERP ek **role-based** college management system hai. Ek hi app, lekin aapka **role** decide karta hai aapko kaunsa menu dikhega aur aap kya kar sakte ho.

**10 Roles:**

| Role | Kaun | Kya karta hai |
|---|---|---|
| `SUPER_ADMIN` | System admin | Sab kuch (full access) |
| `PRINCIPAL` | Principal | Poore college ka overview + sab manage |
| `ADMIN` | Administrator | Students/teachers/academics/fees manage |
| `HOD` | Head of Department | Apne department ka sab |
| `COORDINATOR` | Coordinator | Apne sections / students |
| `TEACHER` | Teacher | Apni subjects, attendance, marks |
| `EXAM_CELL` | Examination Cell | Exams, results, marks entry |
| `ACCOUNTANT` | Accountant | Fees, invoices, payments |
| `STUDENT` | Student | Apni attendance, timetable, results, fees |
| `PARENT` | Parent | Apne bachche ka record |

---

## 2. Login kaise karein

### 🔹 Option A — Apne PC par (local) — abhi ke liye ye sabse aasaan

Do terminal kholo:

**Terminal 1 — Server (API):**
```powershell
cd d:\ERP-main\college-erp\server
npm run dev
```
→ `🚀 College ERP API running on http://localhost:5000`

**Terminal 2 — Client (UI):**
```powershell
cd d:\ERP-main\college-erp\client
npm install
npm run dev
```
→ Browser mein kholo: **http://localhost:5173**

(Client khud `/api` ko `localhost:5000` par bhej deta hai — kuch set karne ki zaroorat nahi.)

### 🔹 Option B — Render par (live)

Abhi **sirf backend API** Render par deploy hua hai: `https://college-erp.onrender.com/api`.
Iska **login page (frontend) abhi deploy nahi hua**. Do raste:
- **Abhi ke liye** Option A (local) use karo.
- **Live website** chahiye to frontend ko bhi Render "Static Site" par deploy karna hoga (section 8 dekho).

---

## 3. Pehla login — Credentials

> ⚠️ Database mein abhi **sirf ye 10 accounts** hain. Koi student/teacher/department ka **real data nahi** — wo aapko banana hoga (section 5).

**Har account ka password: `Admin@123`**

Login screen par **"Email / Username"** field mein ye **username** daalo:

| Username | Role |
|---|---|
| `superadmin` | SUPER_ADMIN |
| `principal` | PRINCIPAL |
| `admin` | ADMIN |
| `hod` | HOD |
| `coordinator` | COORDINATOR |
| `teacher` | TEACHER |
| `examcell` | EXAM_CELL |
| `accountant` | ACCOUNTANT |
| `student` | STUDENT |
| `parent` | PARENT |

Email se bhi login kar sakte ho: `username@college.edu` (jaise `principal@college.edu`).

**Example:**
- Username: `principal`
- Password: `Admin@123`
- **Sign in** dabao.

---

## 4. Pehle din: Password badlo 🛡️

Login ke baad upar ek **heli banner** dikhega: *"You're using a temporary password. Please change it."*

1. Header mein **amber "change it"** button dabao.
2. **Current password:** `Admin@123`
3. **New password:** kuch strong (kam se kam 8 characters), khud yaad rakh lo.
4. Save.

> Ye zaroori hai — `Admin@123` public jaisa hai, ise production mein mat chhodo.

---

## 5. Sabse pehle kya banayein (Setup Order) ⭐

Database khaali hai, isliye **is tarteeb se** data banao (Principal/Admin/Super Admin login se). Ek dusre par depend karta hai:

```
1. Departments      (Academics → Departments)   → e.g. CSE, ECE, Mechanical
2. Academic Years   (Academics → Academic Years)→ e.g. 2026-2027 (active)
3. Courses          (Academics → Courses)       → e.g. B.Tech CSE (department chuno)
4. Semesters        (Academics → Semesters)     → course ke andar sem 1..8
5. Sections         (Academics → Sections)      → semester ke andar A, B, C
6. Subjects         (Academics → Subjects)      → course+semester ke liye subjects
7. Teachers         (People → Teachers)         → teacher user account + profile banao
8. Students         (People → Students)         → student user account + profile + section
9. Subject Allocation (Subjects)                → kaunsa teacher kaunsa subject padhayega
10. Timetable        (Operations → Timetable)    → sections ke liye class schedule
11. Attendance       (Operations → Attendance)   → daily present/absent
12. Exams & Results  (Operations → Exams)        → exam banao, marks entry, result publish
13. Fees             (Operations → Fees)          → invoice + payment
14. Notices          (Content → Notices)          → announcements
15. Documents        (Content → Documents)        → files upload
```

**Report/Settings** (Content → Reports, System → Settings) har waqt available.

---

## 6. Role ke hisaab se aapko kya dikhega

Menu **permission se auto-filter** hota hai. Kuch examples:

- **Student** login karo → sirf **Dashboard, Timetable, Attendance, Exams & Results, Fees, Notices, Documents** (apna hi record). "Users", "Roles", "Departments" **nahi** dikhenge.
- **Teacher** → apni **attendance, subjects, marks entry, timetable, notices** — poore college ka users/roles nahi.
- **Accountant** → **Fees** + reports; students/teachers ka personal data limited.
- **Principal / Super Admin** → **sab menu** + Audit Logs + Settings.

> Koi menu item nahi dikh raha? = aapke role ke paas uski **permission nahi**. Super Admin → **Roles & Permissions** mein jaake us role ko permission de sakte ho (live, bina code change).

---

## 7. Module-wise quick guide

### People
- **Students / Teachers**: list + search + add/edit. Naya student/teacher banate waqt ek **login account** bhi banta hai (username + initial password). "Force password change" checkbox default ON rahe.
- **Users**: saare login accounts. Role badal sakte ho, deactivate kar sakte ho.
- **Roles & Permissions**: har role ki permission matrix — checkbox se ON/OFF. (Sirf Super Admin/Principal.)

### Academics
- **Departments → Courses → Semesters → Sections → Subjects** — ye backbone hai. Upar wala order follow karo.
- **Academic Years**: ek hi "active" year rakho.

### Operations
- **Timetable**: section chuno → day/period/subject/teacher add karo → **Publish** karo (student ko tabhi dikhega).
- **Attendance**: date + section + subject → students mark karo (Present/Absent/Late).
- **Exams & Results**: Exam banao → Exam ke andar subject-wise marks entry → result publish.

### Content
- **Notices**: title/body + audience (kaun dekhega: All / Students / Teachers / specific) + expiry.
- **Documents**: file upload (note: Render free tier par uploads **persist nahi** karte, section 8).
- **Reports**: attendance overview, enrollment breakdown.

### System
- **Audit Logs**: kisne kab kya badla (poora history).
- **Settings**: college ka naam, short name, etc.

---

## 8. Live website (frontend) Render par kaise laayein (optional)

Abhi sirf API live hai. Poora app live karne ke liye Render par ek **Static Site** banao:

1. Render → **New → Static Site** → repo `college-erp`, **Root Directory = `client`**.
2. Build Command: `npm install && npm run build`
3. Publish Directory: `dist`
4. Environment Variable:
   - `VITE_API_URL = https://college-erp.onrender.com/api`
5. Deploy → ek URL milega (jaise `https://college-erp-client.onrender.com`).
6. **Wapas API service mein** jaake `CLIENT_ORIGIN` ko us naye frontend URL par update karo (CORS ke liye), warna login fail hoga.

> **Uploads ki limit:** Render ka disk temporary hai — har deploy/restart par uploaded files (photos/PDF) reset ho jaayengi. Real files ke liye Cloudinary/S3 lagana padega baad mein.

---

## 9. Troubleshooting

| Problem | Kaaran / Solution |
|---|---|
| Login par **"Invalid credentials"** | Username/password galat. Password exactly `Admin@123` (capital A, @). |
| **"Account is INACTIVE/SUSPENDED"** | Us user ko deactivate kiya gaya — Super Admin → Users se ACTIVE karo. |
| Menu item **nahi dikh raha** | Aapke role ke paas permission nahi (section 6). |
| Live site par **CORS / network error** | API ka `CLIENT_ORIGIN` frontend URL se match nahi karta (section 8 step 6). |
| API health khaali/502 | Render par `MONGODB_URI` galat → logs mein "bad auth". Exact URI set karo. |
| `https://.../api/health` → `{"ok":true,"db":"up"}` | ✅ API bilkul theek chal rahi hai. |

---

## 10. Quick start (bas 3 step)

1. Server + Client chalao (section 2 Option A) → **http://localhost:5173**
2. `principal` / `Admin@123` se login → password badlo.
3. Section 5 ka **Setup Order** follow karke pehle Departments, Courses, Students banao.

---

*Banaya gaya: College ERP · MongoDB + Express + TypeScript + React. Kisi bhi module ka detailed walkthrough chahiye to batao.*
