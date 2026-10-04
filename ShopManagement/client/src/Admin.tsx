import { useEffect, useState } from 'react';
import { api } from './api';

interface Role { id: number; name: string; is_system: number; permissions: string[]; users: number; }
interface UserRow { id: number; username: string; full_name: string; active: number; last_login: string | null; role_id: number; role: string; }
interface Perm { key: string; label: string; }

export function Users({ toast, meId }: { toast: (m: string, bad?: boolean) => void; meId: number }) {
  const [users, setUsers] = useState<UserRow[]>([]); const [roles, setRoles] = useState<Role[]>([]);
  const [f, setF] = useState({ username: '', full_name: '', password: '', role_id: 0 });
  const load = async () => { try { const [u, r] = await Promise.all([api('/users'), api('/roles')]); setUsers(u); setRoles(r); if (!f.role_id && r.length) setF(x => ({ ...x, role_id: r[1]?.id ?? r[0].id })); } catch (e: any) { toast(e.message, true); } };
  useEffect(() => { load(); }, []);
  const add = async () => {
    try { await api('/users', { method: 'POST', body: f }); toast('User ban gaya.'); setF({ ...f, username: '', full_name: '', password: '' }); load(); } catch (e: any) { toast(e.message, true); }
  };
  const patch = async (id: number, body: object, ok: string) => { try { await api('/users/' + id, { method: 'PATCH', body }); toast(ok); load(); } catch (e: any) { toast(e.message, true); } };
  const reset = (u: UserRow) => { const p = window.prompt(`${u.username} ka naya password (8+ characters):`); if (p) patch(u.id, { password: p }, 'Password badal diya.'); };

  return (<div>
    <h2>Users</h2>
    <div className="panel">
      <h3>Naya user</h3>
      <div className="row">
        <label>Username<input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></label>
        <label>Naam<input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></label>
        <label>Password<input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
        <label>Role<select value={f.role_id} onChange={e => setF({ ...f, role_id: Number(e.target.value) })}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </div>
      <button onClick={add} disabled={!f.username || !f.full_name || !f.password}>User banayein</button>
    </div>
    <div className="tablewrap"><table>
      <thead><tr><th>Username</th><th>Naam</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
      <tbody>{users.map(u => (
        <tr key={u.id}>
          <td data-l="Username">{u.username}</td><td data-l="Naam">{u.full_name}</td>
          <td data-l="Role"><select value={u.role_id} onChange={e => patch(u.id, { role_id: Number(e.target.value) }, 'Role badal diya.')}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
          <td data-l="Status">{u.active ? '🟢 Active' : '⚪ Band'}</td>
          <td data-l="Last login">{u.last_login || '-'}</td>
          <td className="acts"><button className="ghost" onClick={() => reset(u)}>Password reset</button>
            {u.id !== meId && <button className="ghost" onClick={() => patch(u.id, { active: !u.active }, u.active ? 'User band kiya.' : 'User chalu kiya.')}>{u.active ? 'Band karein' : 'Chalu karein'}</button>}</td>
        </tr>))}</tbody>
    </table></div>
  </div>);
}

export function Roles({ toast }: { toast: (m: string, bad?: boolean) => void }) {
  const [roles, setRoles] = useState<Role[]>([]); const [perms, setPerms] = useState<Perm[]>([]);
  const [sel, setSel] = useState<Role | null>(null); const [checked, setChecked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const load = async () => { try { const [r, p] = await Promise.all([api('/roles'), api('/permissions')]); setRoles(r); setPerms(p); } catch (e: any) { toast(e.message, true); } };
  useEffect(() => { load(); }, []);
  const pick = (r: Role) => { setSel(r); setChecked(r.permissions); setName(r.name); };
  const toggle = (k: string) => setChecked(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k]);
  const save = async () => {
    try {
      if (sel) await api('/roles/' + sel.id, { method: 'PUT', body: { name, permissions: checked } });
      else await api('/roles', { method: 'POST', body: { name, permissions: checked } });
      toast('Role save ho gaya.'); setSel(null); setName(''); setChecked([]); load();
    } catch (e: any) { toast(e.message, true); }
  };
  const del = async (r: Role) => { if (!window.confirm(`"${r.name}" role delete karein?`)) return; try { await api('/roles/' + r.id, { method: 'DELETE' }); toast('Role delete ho gaya.'); setSel(null); load(); } catch (e: any) { toast(e.message, true); } };
  const locked = sel?.name === 'Owner';

  return (<div>
    <h2>Roles aur permissions</h2>
    <div className="chips">{roles.map(r => <button key={r.id} className={sel?.id === r.id ? '' : 'ghost'} onClick={() => pick(r)}>{r.name} ({r.users})</button>)}
      <button className="ghost" onClick={() => { setSel(null); setName(''); setChecked([]); }}>+ Naya role</button></div>
    <div className="panel">
      <label>Role ka naam<input value={name} onChange={e => setName(e.target.value)} disabled={!!sel?.is_system} /></label>
      <div className="permgrid">{perms.map(p => <label key={p.key} className="chk"><input type="checkbox" disabled={locked} checked={checked.includes(p.key)} onChange={() => toggle(p.key)} />{p.label}</label>)}</div>
      {locked ? <p className="muted">Owner ke paas hamesha saari permissions rehti hain.</p> : <div className="row">
        <button onClick={save} disabled={!name.trim()}>{sel ? 'Update karein' : 'Role banayein'}</button>
        {sel && !sel.is_system && <button className="ghost" onClick={() => del(sel)}>Delete</button>}</div>}
    </div>
  </div>);
}
