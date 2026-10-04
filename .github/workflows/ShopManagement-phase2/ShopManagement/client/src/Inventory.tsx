import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Pager, STATUS_ICON, Toast, qty, useDebounced } from './ui';
import StockDialog from './StockDialog';

const SIZE = 25;
const TYPES = ['opening', 'stock_in', 'stock_out', 'adjustment', 'damage', 'lost', 'sale', 'purchase', 'sale_return', 'purchase_return'];

export default function Inventory({ toast, canAdjust }: { toast: Toast; canAdjust: boolean }) {
  const [tab, setTab] = useState<'moves' | 'expiry' | 'low'>('moves');
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(0);
  const [f, setF] = useState({ q: '', type: '', from: '', to: '', expiry: 'expired', exFrom: '', exTo: '' });
  const [stockFor, setStockFor] = useState<any>(null);
  const dq = useDebounced(f.q);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), limit: String(SIZE) }); if (dq) p.set('q', dq);
    let path = '/stock/movements';
    if (tab === 'moves') { for (const k of ['type', 'from', 'to'] as const) if (f[k]) p.set(k, f[k]); }
    if (tab === 'expiry') { path = '/inventory/batches'; p.set('expiry', f.expiry); if (f.expiry === 'custom') { p.set('from', f.exFrom); p.set('to', f.exTo); } }
    if (tab === 'low') { path = '/products'; p.set('stock', 'low_or_out'); p.set('sort', 'stock'); }
    if (tab === 'expiry' && f.expiry === 'custom' && (!f.exFrom || !f.exTo)) { setRows([]); setTotal(0); return; }
    try { const r = await api(path + '?' + p); setRows(r.rows); setTotal(r.total); } catch (e: any) { toast(e.message, true); }
  }, [tab, page, dq, f.type, f.from, f.to, f.expiry, f.exFrom, f.exTo]);
  useEffect(() => { load(); }, [load]);
  const upd = (k: string) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(0); };

  return (<div>
    <h2>Inventory</h2>
    <div className="chips">{([['moves', '📒 Stock history'], ['expiry', '⏳ Expiry'], ['low', '⚠️ Low / Out of stock']] as const).map(([k, l]) => <button key={k} className={tab === k ? '' : 'ghost'} onClick={() => { setTab(k); setPage(0); }}>{l}</button>)}</div>
    <div className="filters">
      <input placeholder="Search product / SKU" value={f.q} onChange={upd('q')} />
      {tab === 'moves' && <><select value={f.type} onChange={upd('type')}><option value="">Sab types</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
        <input type="date" value={f.from} onChange={upd('from')} /><input type="date" value={f.to} onChange={upd('to')} /></>}
      {tab === 'expiry' && <><select value={f.expiry} onChange={upd('expiry')}><option value="expired">Expired</option><option value="today">Aaj expire</option><option value="7">7 din</option><option value="30">30 din</option><option value="60">60 din</option><option value="custom">Custom range</option></select>
        {f.expiry === 'custom' && <><input type="date" value={f.exFrom} onChange={upd('exFrom')} /><input type="date" value={f.exTo} onChange={upd('exTo')} /></>}</>}
    </div>
    <div className="tablewrap"><table>
      {tab === 'moves' && <><thead><tr><th>Time</th><th>Product</th><th>Type</th><th>Change</th><th>Balance</th><th>Batch</th><th>Reason / User</th></tr></thead>
        <tbody>{rows.map(m => <tr key={m.id}><td data-l="Time">{m.created_at}</td><td data-l="Product">{m.product}</td><td data-l="Type">{m.type}</td>
          <td data-l="Change" className={m.qty_change < 0 ? 'neg' : 'pos'}>{m.qty_change > 0 ? '+' : ''}{qty(m.qty_change)}</td><td data-l="Balance">{qty(m.balance_after)}</td>
          <td data-l="Batch">{m.batch_no || '-'}</td><td data-l="Reason">{m.reason || '-'} <span className="muted">· {m.username || '-'}</span></td></tr>)}</tbody></>}
      {tab === 'expiry' && <><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Din bache</th><th>Qty</th><th>Rack</th><th></th></tr></thead>
        <tbody>{rows.map(b => <tr key={b.id}><td data-l="Product">{b.product}</td><td data-l="Batch">{b.batch_no || 'Default'}</td><td data-l="Expiry">{b.expiry_date}</td>
          <td data-l="Din" className={b.days_left < 0 ? 'neg' : ''}>{b.days_left < 0 ? `${-b.days_left} din pehle expire` : b.days_left}</td><td data-l="Qty">{qty(b.qty)}</td><td data-l="Rack">{b.rack || '-'}</td>
          <td>{canAdjust && <button className="ghost" onClick={() => setStockFor({ id: b.product_id, name: b.product })}>Stock</button>}</td></tr>)}</tbody></>}
      {tab === 'low' && <><thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Minimum</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map(p => <tr key={p.id}><td data-l="Product">{p.name}</td><td data-l="SKU">{p.sku}</td><td data-l="Stock">{qty(p.current_stock)}</td><td data-l="Minimum">{qty(p.min_stock)}</td>
          <td data-l="Status">{STATUS_ICON[p.stock_status]}</td><td>{canAdjust && <button className="ghost" onClick={() => setStockFor(p)}>Stock In</button>}</td></tr>)}</tbody></>}
      {!rows.length && <tbody><tr><td colSpan={7} className="empty">Kuch nahi mila.</td></tr></tbody>}
    </table></div>
    <Pager page={page} total={total} size={SIZE} onPage={setPage} />
    {stockFor && <StockDialog product={stockFor} toast={toast} onClose={() => setStockFor(null)} onDone={load} />}
  </div>);
}
