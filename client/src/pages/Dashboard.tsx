import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useLoad, Pie } from '../components/Resource';
import { Badge, Card, Empty, PageHeader, Spinner, StatCard } from '../components/ui';
import type { DashboardCard, Notice } from '../lib/types';

interface DashData {
  role: string;
  cards?: DashboardCard[];
  notices?: Notice[];
  activeYear?: { label: string };
  profile?: Record<string, any>;
  deptBreakdown?: { id: string; name: string; code: string; _count: { students: number; teachers: number } }[];
  allocations?: { subject: string; section: string }[];
  sections?: any[];
  children?: { id: string; name: string; rollNo: string; course?: { name: string }; section?: { name: string } }[];
  timetable?: { day: string; periodNumber: number; subject?: { name: string; code: string }; teacher?: { user?: { fullName: string } }; room?: string | null }[];
  upcomingExams?: { id: string; name: string; type: string; startDate: string; endDate: string }[];
  department?: { code: string; name: string };
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const priTone: Record<string, string> = { URGENT: 'red', HIGH: 'amber', NORMAL: 'blue' };

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error } = useLoad<DashData>(async () => (await api.get('/dashboard')).data, []);

  if (loading) return <Spinner />;
  if (error) return <div className="card text-sm text-rose-600">{error}</div>;
  const d = data!;

  const quickLinks: { label: string; to: string; show: boolean }[] = [
    { label: 'Mark attendance', to: '/attendance', show: !!(user?.permissions.includes('attendance:create') || user?.permissions.includes('attendance:manage') || user?.permissions.includes('*:*')) },
    { label: 'Enter marks', to: '/exams', show: !!(user?.permissions.includes('marks:create') || user?.permissions.includes('*:*')) },
    { label: 'Collect fee', to: '/fees', show: !!(user?.permissions.includes('fees:create') || user?.permissions.includes('*:*')) },
    { label: 'Post notice', to: '/notices', show: !!(user?.permissions.includes('notices:create') || user?.permissions.includes('*:*')) },
  ].filter((q) => q.show);

  return (
    <div>
      <PageHeader
        title={`Hello, ${user?.fullName?.split(' ')[0]} 👋`}
        subtitle={[user?.role?.label, d.activeYear && `Academic year ${d.activeYear.label}`, d.department && `${d.department.code} department`].filter(Boolean).join(' · ')}
      />

      {/* stat cards */}
      {!!d.cards?.length && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {d.cards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} tone={c.tone} />)}
        </div>
      )}

      {/* student profile strip */}
      {d.role === 'STUDENT' && d.profile && (
        <Card className="mb-6">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span><b className="text-slate-800">{d.profile.rollNo}</b></span>
            <span className="text-slate-500">{d.profile.course}</span>
            <span className="text-slate-500">Sem {d.profile.semester}</span>
            <span className="text-slate-500">Section {d.profile.section || '—'}</span>
            <span className="text-slate-500">Dept {d.profile.department}</span>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* admin dept breakdown */}
          {!!d.deptBreakdown?.length && (
            <Card title="Department-wise headcount">
              <Pie parts={d.deptBreakdown.map((x, i) => ({
                label: `${x.name} (${x._count.students} students)`,
                value: x._count.students,
                color: ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 6],
              }))} />
            </Card>
          )}

          {/* student timetable */}
          {d.role === 'STUDENT' && !!d.timetable?.length && (
            <Card title="My timetable (published)">
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>Day</th><th>Period</th><th>Subject</th><th>Teacher</th></tr></thead>
                  <tbody>
                    {d.timetable.map((s, i) => (
                      <tr key={i}>
                        <td>{DAYS.indexOf(s.day) + 1}·{s.day}</td>
                        <td>P{s.periodNumber}</td>
                        <td className="font-medium">{s.subject?.name || '—'}</td>
                        <td>{s.teacher?.user?.fullName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* teacher allocations */}
          {d.role === 'TEACHER' && (
            <Card title="My subject allocations">
              {d.allocations?.length ? (
                <div className="flex flex-wrap gap-2">
                  {d.allocations.map((a, i) => <Badge key={i} tone="blue">{a.subject} · Sec {a.section}</Badge>)}
                </div>
              ) : <Empty text="No allocations assigned yet" />}
            </Card>
          )}

          {/* parent children */}
          {d.role === 'PARENT' && (
            <Card title="My children">
              {d.children?.length ? d.children.map((c) => (
                <div key={c.id} className="mb-2 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-700">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.rollNo} · {c.course?.name} · Sec {c.section?.name}</div>
                  </div>
                  <Link to="/notices" className="btn-secondary !py-1 text-xs">View updates</Link>
                </div>
              )) : <Empty text="No linked students" />}
            </Card>
          )}

          {/* upcoming exams for students */}
          {d.role === 'STUDENT' && (
            <Card title="Upcoming exams">
              {d.upcomingExams?.length ? (
                <ul className="space-y-2 text-sm">
                  {d.upcomingExams.map((e) => (
                    <li key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-slate-500">{new Date(e.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(e.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty text="No exams scheduled" />}
            </Card>
          )}
        </div>

        {/* notices + quick links */}
        <div className="space-y-6">
          <Card title="Latest notices" action={<Link to="/notices" className="text-sm font-semibold text-brand-600 hover:underline">View all</Link>}>
            {d.notices?.length ? (
              <ul className="space-y-3">
                {d.notices.map((n) => (
                  <li key={n.id} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-700">{n.title}</span>
                      <Badge tone={priTone[n.priority] || 'slate'}>{n.priority}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty text="No notices" />}
          </Card>

          {!!quickLinks.length && (
            <Card title="Quick actions">
              <div className="grid grid-cols-2 gap-2">
                {quickLinks.map((q) => (
                  <Link key={q.to} to={q.to} className="rounded-lg bg-brand-50 px-3 py-2.5 text-center text-sm font-semibold text-brand-700 hover:bg-brand-100">
                    {q.label}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
