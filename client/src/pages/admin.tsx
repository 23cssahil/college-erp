import { useMemo, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Resource, useLoad, FieldCfg } from '../components/Resource';
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui';

const ROLE_OPT: FieldCfg = {
  name: 'roleId', label: 'Role', type: 'select', required: true,
  optionUrl: '/roles', optionLabelKey: 'label',
};

/* ══════════════════════ USERS ══════════════════════ */
export function UsersPage() {
  return (
    <Resource
      endpoint="/users" title="Users" subtitle="All accounts; activate/deactivate and manage roles"
      searchable paginate canEditKey="users:edit" canDeleteKey="users:delete"
      canCreateKey="users:create"
      filters={[{ name: 'status', label: 'Status', type: 'select', options: [
        { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'SUSPENDED', label: 'Suspended' },
      ] }]}
      columns={[
        { key: 'fullName', label: 'Name' },
        { key: 'username', label: 'Username' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', render: (r) => <Badge tone="blue">{r.role?.label}</Badge> },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'green' : r.status === 'SUSPENDED' ? 'red' : 'slate'}>{r.status}</Badge> },
      ]}
      createFields={[
        { name: 'fullName', label: 'Full name', required: true },
        { name: 'username', label: 'Username', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone' },
        ROLE_OPT,
        { name: 'password', label: 'Password', type: 'password', required: true, hint: 'min 8 characters' },
        { name: 'mustChangePwd', label: 'Force password change on first login', type: 'checkbox', default: true },
      ]}
      editFields={[
        { name: 'fullName', label: 'Full name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone' },
        ROLE_OPT,
        { name: 'status', label: 'Status', type: 'select', options: [
          { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'SUSPENDED', label: 'Suspended' } ] },
      ]}
      transformForm={(row) => ({ fullName: row.fullName, email: row.email, phone: row.phone, roleId: row.roleId, status: row.status })}
      rowActions={(row, { reload }) => (
        row.status === 'ACTIVE'
          ? <button className="btn-ghost !px-2 !py-1 text-xs text-rose-600" onClick={() => toggle(row, 'INACTIVE', reload)}>Deactivate</button>
          : <button className="btn-ghost !px-2 !py-1 text-xs text-emerald-600" onClick={() => toggle(row, 'ACTIVE', reload)}>Activate</button>
      )}
    />
  );
}

async function toggle(row: any, status: string, reload: () => void) {
  try { await api.put(`/users/${row.id}`, { status }); reload(); }
  catch (e) { alert(errMsg(e)); }
}

/* ══════════════════════ ROLES & PERMISSIONS ══════════════════════ */
export function RolesPage() {
  const { data, loading, reload } = useLoad<any>(async () => {
    const [r, p] = await Promise.all([api.get('/roles'), api.get('/roles/permissions')]);
    return { roles: r.data.roles, permissions: p.data.permissions };
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const byModule = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of data?.permissions || []) {
      const mod = p.key.split(':')[0];
      (map[mod] ||= []).push(p.key);
    }
    return map;
  }, [data]);

  if (loading || !data) return <Spinner />;
  const role = data.roles.find((r: any) => r.id === selected);
  const current = draft ?? role?.permissions ?? [];

  function pick(r: any) { setSelected(r.id); setDraft(null); setMsg(''); }
  function toggleKey(k: string) {
    if (!role) return;
    const base = draft ?? role.permissions;
    setDraft(base.includes(k) ? base.filter((x: string) => x !== k) : [...base, k]);
  }

  async function save() {
    if (!role) return;
    setSaving(true); setMsg('');
    try {
      await api.put(`/roles/${role.id}/permissions`, { permissions: current });
      reload(); setMsg('Permissions saved.');
    } catch (e) { setMsg(errMsg(e)); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle="Configurable RBAC — permissions are enforced on the backend" />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit !p-3">
          {data.roles.map((r: any) => (
            <button key={r.id} onClick={() => pick(r)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selected === r.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-50'}`}>
              <span className="font-medium">{r.label}</span>
              <span className={selected === r.id ? 'text-brand-100' : 'text-slate-400'}>{r.userCount}👤</span>
            </button>
          ))}
        </Card>

        <div>
          {!role ? <Card><p className="text-sm text-slate-500">Select a role to view and edit its permissions.</p></Card> : (
            <Card
              title={`${role.label} · ${current.length} permission${current.length === 1 ? '' : 's'}`}
              action={role.name !== 'SUPER_ADMIN' && (
                <div className="flex gap-2">
                  {draft && <Button variant="secondary" onClick={() => setDraft(null)}>Reset</Button>}
                  <Button onClick={save} disabled={saving || !draft}>{saving ? 'Saving…' : 'Save changes'}</Button>
                </div>
              )}
            >
              {msg && <div className={`mb-3 rounded-lg px-4 py-2.5 text-sm ring-1 ${msg.includes('saved') ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>{msg}</div>}
              {role.name === 'SUPER_ADMIN' && (
                <div className="mb-3 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-700 ring-1 ring-brand-200">
                  Super Admin has unrestricted access (<code>*:*</code>) and cannot be edited.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(byModule).map(([mod, keys]) => (
                  <div key={mod}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-bold capitalize text-slate-700">{mod.replace(/([A-Z])/g, ' $1')}</span>
                      {role.name !== 'SUPER_ADMIN' && (
                        <button className="text-xs text-brand-600 hover:underline"
                          onClick={() => setDraft(Array.from(new Set([...current, ...keys])))}>all</button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {keys.map((k) => (
                        <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-sm hover:bg-slate-50">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={role.name === 'SUPER_ADMIN'}
                            checked={current.includes(k)} onChange={() => toggleKey(k)} />
                          <span className="text-slate-600">{k.split(':')[1]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
