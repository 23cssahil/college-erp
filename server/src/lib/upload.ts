import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config';

const dir = path.resolve(env.uploadDir);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMB * 1024 * 1024 },
});

export const uploadsDir = dir;
