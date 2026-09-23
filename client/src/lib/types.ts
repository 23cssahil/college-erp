export type RoleName =
  | 'SUPER_ADMIN' | 'PRINCIPAL' | 'ADMIN' | 'HOD' | 'COORDINATOR'
  | 'TEACHER' | 'EXAM_CELL' | 'ACCOUNTANT' | 'STUDENT' | 'PARENT';

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone?: string | null;
  photoUrl?: string | null;
  status: string;
  mustChangePwd: boolean;
  role: { id: number; name: RoleName; label: string };
  permissions: string[];
  student?: any;
  teacher?: any;
}

export interface DashboardCard {
  label: string;
  value: string | number;
  tone?: 'good' | 'warn' | 'info' | 'bad';
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  priority: string;
  publishAt: string;
  author?: { fullName: string };
  isRead?: boolean;
}
