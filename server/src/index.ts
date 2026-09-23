import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config';
import { connectDb } from './lib/db';
import { SystemSetting } from './models';
import { uploadsDir } from './lib/upload';
import { notFound, errorHandler } from './middleware/error';
import { authenticate } from './middleware/auth';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import roleRoutes from './routes/roles';
import academicRoutes from './routes/academic';
import studentRoutes from './routes/students';
import teacherRoutes from './routes/teachers';
import subjectRoutes from './routes/subjects';
import allocationRoutes from './routes/allocations';
import operationsRoutes from './routes/operations';
import examRoutes from './routes/exams';
import feeRoutes from './routes/fees';
import contentRoutes from './routes/content';
import systemRoutes from './routes/system';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientOrigins.includes('*') ? true : env.clientOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// uploaded files (dev/local). In production, replace with S3/GCS/Cloudinary.
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', async (_req, res) => {
  const up = mongoose.connection.readyState === 1;
  if (up) res.json({ ok: true, service: 'college-erp-api', db: 'up', time: new Date().toISOString() });
  else res.status(500).json({ ok: false, db: 'down' });
});

// public branding for the login screen
app.get('/api/public-config', async (_req, res) => {
  const settings = await SystemSetting.find();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value || '';
  res.json({ collegeName: map['college.name'] || 'College ERP', collegeShort: map['college.short'] || 'ERP' });
});

app.use('/api/auth', authRoutes);
// Everything below the login endpoint is authenticated; individual routes then
// enforce fine-grained permissions with requirePermission(...).
app.use('/api/users', authenticate, userRoutes);
app.use('/api/roles', authenticate, roleRoutes);
app.use('/api/academic', authenticate, academicRoutes);
app.use('/api/students', authenticate, studentRoutes);
app.use('/api/teachers', authenticate, teacherRoutes);
app.use('/api/subjects', authenticate, subjectRoutes);
app.use('/api/allocations', authenticate, allocationRoutes); // teacher ↔ subject ↔ section
app.use('/api', authenticate, operationsRoutes); // periods, timetable, attendance
app.use('/api/exams', authenticate, examRoutes); // exams, marks, results
app.use('/api/fees', authenticate, feeRoutes);
app.use('/api', authenticate, contentRoutes); // notices, documents
app.use('/api', authenticate, systemRoutes); // dashboard, reports, audit, settings

app.use(notFound);
app.use(errorHandler);

async function main() {
  // safety: ensure DB is reachable before opening the port
  try {
    await connectDb();
  } catch (e: any) {
    console.error('⚠️  Database connection failed. Check MONGODB_URI in .env —', e.message);
    process.exit(1);
  }
  app.listen(env.port, () => {
    console.log(`🚀 College ERP API running on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

if (require.main === module) main();

export default app;
