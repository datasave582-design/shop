import { useEffect, useState } from 'react';
import { api, setToken } from './api';

export function Dashboard({ name, shop, onGo, can }: { name: string; shop: string; onGo: (p: string) => void; can: (p: string) => boolean }) {
  const [st, setSt] = useState<any>(null);
  useEffect(() => { if (can('dashboard.view')) api('/dashboard/stats').then(setSt).catch(() => setSt(null)); }, []);
  const cards: [string, string, string, string][] = st ? [
    ['Total products', String(st.products), 'products', ''], ['Total stock', String(st.stock), 'products', ''],
    ['Stock value', '₹' + Number(st.stock_value).toLocaleString('en-IN'), 'products', ''],
    ['Low stock', String(st.low_stock), 'inventory', st.low_stock ? 'warn' : ''], ['Out of stock', String(st.out_of_stock), 'inventory', st.out_of_stock ? 'bad' : ''],
    ['Expiring soon', String(st.expiring_soon), 'inventory', st.expiring_soon ? 'warn' : ''], ['Expired', String(st.expired), 'inventory', st.expired ? 'bad' : ''],
  ] : [];
  return (<div>
    <h2>Dashboard</h2>
    <p className="muted">Namaste <b>{name}</b> — {shop}</p>
    <div className="chips">
      {can('products.edit') && <button onClick={() => onGo('products')}>+ Add Product</button>}
      {can('products.view') && <button className="ghost" onClick={() => onGo('products')}>🔍 Scan Barcode</button>}
      {can('inventory.adjust') && <button className="ghost" onClick={() => onGo('inventory')}>Stock Adjustment</button>}
    </div>
    <div className="cards">{cards.map(([l, v, to, cls]) => <div key={l} className={'stat ' + cls} onClick={() => onGo(to)}><div className="muted">{l}</div><div className="big">{v}</div></div>)}</div>
    <p className="muted">Sales, purchase aur profit cards Phase 3-4 mein judenge.</p>
  </div>);
}

export function Audit({ toast }: { toast: (m: string, bad?: boolean) => void }) {
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0);
  const [q, setQ] = useState(''); const [page, setPage] = useState(0); const size = 25;
  useEffect(() => {
    const t = setTimeout(async () => {
      try { const r = await api(`/audit?limit=${size}&offset=${page * size}&q=${encodeURIComponent(q)}`); setRows(r.rows); setTotal(r.total); } catch (e: any) { toast(e.message, true); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, page]);
  return (<div>
    <h2>Audit log</h2>
    <input placeholder="Search (action, user, record)…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
    <div className="tablewrap"><table>
      <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>IP</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td data-l="Time">{r.created_at} UTC</td><td data-l="User">{r.username || '-'}</td><td data-l="Action">{r.action}</td><td data-l="Record">{r.record_type ? `${r.record_type} ${r.record_id ?? ''}` : '-'}</td><td data-l="IP">{r.ip || '-'}</td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="empty">Koi record nahi mila.</td></tr>}</tbody>
    </table></div>
    <div className="row end"><span className="muted">{total} records</span>
      <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Pichla</button>
      <button className="ghost" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>Agla ›</button></div>
  </div>);
}

const FIELDS: [string, string][] = [['shop_name', 'Shop ka naam'], ['owner_name', 'Owner'], ['address', 'Address'], ['mobile', 'Mobile'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['gstin', 'GSTIN'], ['currency', 'Currency'], ['business_type', 'Business type'], ['invoice_prefix', 'Invoice prefix'], ['low_stock_threshold', 'Low stock threshold'], ['expiry_warning_days', 'Expiry warning (days)']];

export function Settings({ toast, onSaved }: { toast: (m: string, bad?: boolean) => void; onSaved: (shop: string) => void }) {
  const [s, setS] = useState<Record<string, string>>({});
  useEffect(() => { api('/settings').then(setS).catch(e => toast(e.message, true)); }, []);
  const save = async () => { try { await api('/settings', { method: 'PUT', body: s }); toast('Settings save ho gayi.'); onSaved(s.shop_name); } catch (e: any) { toast(e.message, true); } };
  return (<div>
    <h2>Shop settings</h2>
    <div className="panel">
      <div className="formgrid">{FIELDS.map(([k, l]) => <label key={k}>{l}<input value={s[k] ?? ''} onChange={e => setS({ ...s, [k]: e.target.value })} /></label>)}</div>
      <label className="chk"><input type="checkbox" checked={s.allow_expired_sale === '1'} onChange={e => setS({ ...s, allow_expired_sale: e.target.checked ? '1' : '0' })} />Expired products ki sale allow karein</label>
      <button onClick={save}>Save karein</button>
    </div>
  </div>);
}

export function Account({ toast, onLogout }: { toast: (m: string, bad?: boolean) => void; onLogout: () => void }) {
  const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  const save = async () => { try { const r = await api('/auth/change-password', { method: 'POST', body: { current: cur, next: nw } }); setToken(r.token); setCur(''); setNw(''); toast('Password badal gaya.'); } catch (e: any) { toast(e.message, true); } };
  return (<div>
    <h2>Mera account</h2>
    <div className="panel narrow">
      <label>Purana password<input type="password" value={cur} onChange={e => setCur(e.target.value)} /></label>
      <label>Naya password (8+ characters)<input type="password" value={nw} onChange={e => setNw(e.target.value)} /></label>
      <button onClick={save} disabled={!cur || nw.length < 8}>Password badlein</button>
      <hr /><button className="ghost" onClick={onLogout}>Logout</button>
    </div>
  </div>);
}
