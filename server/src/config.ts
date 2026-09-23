import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  // MongoDB connection string (Atlas srv or standard seedlist form).
  mongoUri: process.env.MONGODB_URI || '',
  mongoDbName: process.env.MONGODB_DB || 'college_erp',
  accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  accessMinutes: Number(process.env.ACCESS_TOKEN_MINUTES || 15),
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 5),
};
