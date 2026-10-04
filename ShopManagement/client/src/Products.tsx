import { useCallback, useEffect, useState } from 'react';
import { api, upload } from './api';
import { Modal, Pager, STATUS_ICON, Toast, money, qty, useDebounced } from './ui';
import StockDialog from './StockDialog';

const SIZE = 25;
const EMPTY = { name: '', sku: '', barcode: '', category_id: '', subcategory_id: '', brand_id: '', unit_id: '', description: '', purchase_price: '', selling_price: '', mrp: '', discount_pct: '', gst_pct: '', min_stock: '', max_stock: '', rack: '', status: 'active', op_qty: '', op_batch: '', op_mfg: '', op_exp: '' };

async function resize(file: File, max = 600): Promise<Blob> {
  const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('image'))), 'image/jpeg', 0.8));
}

export default function Products({ toast, canEdit, canStock }: { toast: Toast; canEdit: boolean; canStock: boolean }) {
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(0);
  const [f, setF] = useState({ q: '', category_id: '', brand_id: '', stock: '', expiry: '', status: '', sort: 'name', dir: 'asc' });
  const [cats, setCats] = useState<any[]>([]); const [brands, setBrands] = useState<any[]>([]); const [units, setUnits] = useState<any[]>([]); const [settings, setSettings] = useState<Record<string, string>>({});
  const [form, setForm] = useState<{ id?: number; v: typeof EMPTY; image?: string } | null>(null);
  const [view, setView] = useState<any>(null); const [stockFor, setStockFor] = useState<any>(null);
  const dq = useDebounced(f.q);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), limit: String(SIZE), sort: f.sort, dir: f.dir });
    for (const k of ['category_id', 'brand_id', 'stock', 'expiry', 'status'] as const) if (f[k]) p.set(k, f[k]);
    if (dq) p.set('q', dq);
    try { const r = await api('/products?' + p); setRows(r.rows); setTotal(r.total); } catch (e: any) { toast(e.message, true); }
  }, [page, dq, f.category_id, f.brand_id, f.stock, f.expiry, f.status, f.sort, f.dir]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { Promise.all([api('/categories'), api('/brands'), api('/units'), api('/settings')]).then(([c, b, u, s]) => { setCats(c); setBrands(b); setUnits(u); setSettings(s); }).catch(e => toast(e.message, true)); }, []);

  const flt = (k: string) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(0); };

  // USB scanner keyboard ki tarah type karke Enter dabata hai
  const onSearchKey = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !f.q.trim()) return;
    try { const p = await api('/products/lookup?code=' + encodeURIComponent(f.q.trim())); openView(p.id); setF({ ...f, q: '' }); } catch { /* normal search chalta rahega */ }
  };
  const openView = async (id: number) => { try { setView(await api('/products/' + id)); } catch (e: any) { toast(e.message, true); } };

  const openForm = async (id?: number) => {
    if (!id) return setForm({ v: { ...EMPTY, min_stock: settings.low_stock_threshold || '' } });
    try {
      const p = await api('/products/' + id); const v: any = { ...EMPTY };
      for (const k of Object.keys(EMPTY)) if (p[k] !== undefined && p[k] !== null && !k.startsWith('op_')) v[k] = String(p[k]);
      setForm({ id, v, image: p.image });
    } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (p: any) => { if (!window.confirm(`"${p.name}" delete karein?`)) return; try { await api('/products/' + p.id, { method: 'DELETE' }); toast('Product delete ho gaya.'); load(); } catch (e: any) { toast(e.message, true); } };
  const dup = async (p: any) => { try { await api(`/products/${p.id}/duplicate`, { method: 'POST' }); toast('Duplicate ban gaya.'); load(); } catch (e: any) { toast(e.message, true); } };

  return (<div>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><h2>Products</h2>{canEdit && <button onClick={() => openForm()}>+ Naya product</button>}</div>
    <div className="filters">
      <input placeholder="Search ya barcode scan karein + Enter" value={f.q} onChange={flt('q')} onKeyDown={onSearchKey} autoFocus />
      <select value={f.category_id} onChange={flt('category_id')}><option value="">Sab categories</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select value={f.brand_id} onChange={flt('brand_id')}><option value="">Sab brands</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <select value={f.stock} onChange={flt('stock')}><option value="">Stock: sab</option><option value="out">🔴 Out</option><option value="critical">🟠 Critical</option><option value="low">🟡 Low</option><option value="healthy">🟢 Healthy</option></select>
      <select value={f.expiry} onChange={flt('expiry')}><option value="">Expiry: sab</option><option value="expired">Expired</option><option value="today">Aaj</option><option value="7">7 din</option><option value="30">30 din</option><option value="60">60 din</option></select>
      <select value={f.status} onChange={flt('status')}><option value="">Status: sab</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      <select value={f.sort + ':' + f.dir} onChange={e => { const [s, d] = e.target.value.split(':'); setF({ ...f, sort: s, dir: d }); }}>
        <option value="name:asc">Naam A→Z</option><option value="price:asc">Price ↑</option><option value="price:desc">Price ↓</option><option value="stock:asc">Stock ↑</option><option value="stock:desc">Stock ↓</option><option value="date:desc">Naye pehle</option></select>
    </div>
    <div className="tablewrap"><table>
      <thead><tr><th>Naam</th><th>SKU / Barcode</th><th>Category</th><th>Price</th><th>Stock</th><th>Expiry</th><th></th></tr></thead>
      <tbody>{rows.map(p => (<tr key={p.id} className={p.status === 'inactive' ? 'dim' : ''}>
        <td data-l="Naam"><a onClick={() => openView(p.id)}>{p.name}</a>{p.brand && <div className="muted">{p.brand}</div>}</td>
        <td data-l="SKU">{p.sku}<div className="muted">{p.barcode || '-'}</div></td>
        <td data-l="Category">{p.category || '-'}</td>
        <td data-l="Price">{money(p.selling_price)}<div className="muted">MRP {money(p.mrp)}</div></td>
        <td data-l="Stock"><b>{qty(p.current_stock)}</b> {p.unit}<div className="muted">{STATUS_ICON[p.stock_status]}</div></td>
        <td data-l="Expiry">{p.nearest_expiry || '-'}</td>
        <td className="acts">
          {canStock && <button className="ghost" onClick={() => setStockFor(p)}>Stock</button>}
          {canEdit && <><button className="ghost" onClick={() => openForm(p.id)}>Edit</button><button className="ghost" onClick={() => dup(p)}>Copy</button><button className="ghost" onClick={() => remove(p)}>Delete</button></>}
        </td></tr>))}
        {!rows.length && <tr><td colSpan={7} className="empty">Koi product nahi mila.</td></tr>}</tbody>
    </table></div>
    <Pager page={page} total={total} size={SIZE} onPage={setPage} />

    {form && <ProductForm {...form} cats={cats} brands={brands} units={units} toast={toast} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    {view && <Modal title={view.name} onClose={() => setView(null)} wide>
      <div className="row">{view.image && <img className="pimg" src={'/uploads/' + view.image} alt="" />}
        <div style={{ flex: 1, minWidth: 220 }}>
          <p>SKU: <b>{view.sku}</b> · Barcode: <b>{view.barcode || '-'}</b></p>
          <p>{view.category || '-'}{view.subcategory ? ' › ' + view.subcategory : ''} · {view.brand || 'No brand'} · Rack: {view.rack || '-'}</p>
          <p>Purchase {money(view.purchase_price)} · Selling <b>{money(view.selling_price)}</b> · MRP {money(view.mrp)} · GST {view.gst_pct}% · Discount {view.discount_pct}%</p>
          <p>Stock: <b>{qty(view.current_stock)} {view.unit}</b> ({STATUS_ICON[view.stock_status]}) · Min {qty(view.min_stock)} · Max {qty(view.max_stock)}</p>
          {view.description && <p className="muted">{view.description}</p>}</div></div>
      <h3>Batches</h3>
      <div className="tablewrap"><table><thead><tr><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Qty</th></tr></thead>
        <tbody>{view.batches.map((b: any) => <tr key={b.id}><td data-l="Batch">{b.batch_no || 'Default'}</td><td data-l="Mfg">{b.mfg_date || '-'}</td><td data-l="Expiry">{b.expiry_date || '-'}</td><td data-l="Qty">{qty(b.qty)}</td></tr>)}
          {!view.batches.length && <tr><td colSpan={4} className="empty">Abhi koi stock nahi.</td></tr>}</tbody></table></div>
    </Modal>}
    {stockFor && <StockDialog product={stockFor} toast={toast} onClose={() => setStockFor(null)} onDone={load} />}
  </div>);
}

function ProductForm({ id, v: init, image, cats, brands, units, toast, onClose, onSaved }: any) {
  const [v, setV] = useState<typeof EMPTY>(init); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const subs = cats.find((c: any) => String(c.id) === v.category_id)?.subcategories || [];
  const n = (s: string) => (s === '' ? 0 : Number(s)); const idv = (s: string) => (s ? Number(s) : null);

  const save = async () => {
    setBusy(true);
    try {
      const body: any = { name: v.name, sku: v.sku, barcode: v.barcode, category_id: idv(v.category_id), subcategory_id: idv(v.subcategory_id), brand_id: idv(v.brand_id), unit_id: idv(v.unit_id),
        description: v.description, purchase_price: n(v.purchase_price), selling_price: n(v.selling_price), mrp: n(v.mrp), discount_pct: n(v.discount_pct), gst_pct: n(v.gst_pct),
        min_stock: n(v.min_stock), max_stock: n(v.max_stock), rack: v.rack, status: v.status };
      if (!id && n(v.op_qty) > 0) body.opening = { quantity: n(v.op_qty), batch_no: v.op_batch, mfg_date: v.op_mfg, expiry_date: v.op_exp };
      const r = await api(id ? '/products/' + id : '/products', { method: id ? 'PUT' : 'POST', body });
      if (file) { try { await upload(`/products/${id || r.id}/image`, await resize(file)); } catch (e: any) { toast('Product save hua, par image nahi: ' + e.message, true); } }
      toast('Product save ho gaya.'); onSaved();
    } catch (e: any) { toast(e.message, true); setBusy(false); }
  };

  return (<Modal title={id ? 'Product edit' : 'Naya product'} onClose={onClose} wide>
    <div className="formgrid">
      <label>Naam *<input value={v.name} onChange={set('name')} autoFocus /></label>
      <label>SKU (khali = auto)<input value={v.sku} onChange={set('sku')} /></label>
      <label>Barcode<div className="row" style={{ flexWrap: 'nowrap' }}><input value={v.barcode === 'auto' ? '' : v.barcode} placeholder={v.barcode === 'auto' ? 'Save par auto banega' : 'Scan / type'} onChange={set('barcode')} />
        <button className="ghost" onClick={() => setV({ ...v, barcode: 'auto' })}>Auto</button></div></label>
      <label>Category<select value={v.category_id} onChange={e => setV({ ...v, category_id: e.target.value, subcategory_id: '' })}><option value="">-</option>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Subcategory<select value={v.subcategory_id} onChange={set('subcategory_id')}><option value="">-</option>{subs.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Brand<select value={v.brand_id} onChange={set('brand_id')}><option value="">-</option>{brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Unit<select value={v.unit_id} onChange={set('unit_id')}><option value="">Piece</option>{units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Purchase price<input type="number" min="0" step="any" value={v.purchase_price} onChange={set('purchase_price')} /></label>
      <label>Selling price<input type="number" min="0" step="any" value={v.selling_price} onChange={set('selling_price')} /></label>
      <label>MRP<input type="number" min="0" step="any" value={v.mrp} onChange={set('mrp')} /></label>
      <label>Discount %<input type="number" min="0" max="100" step="any" value={v.discount_pct} onChange={set('discount_pct')} /></label>
      <label>GST %<input type="number" min="0" max="100" step="any" value={v.gst_pct} onChange={set('gst_pct')} /></label>
      <label>Minimum stock<input type="number" min="0" step="any" value={v.min_stock} onChange={set('min_stock')} /></label>
      <label>Maximum stock<input type="number" min="0" step="any" value={v.max_stock} onChange={set('max_stock')} /></label>
      <label>Rack / location<input value={v.rack} onChange={set('rack')} /></label>
      <label>Status<select value={v.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label>Image {image && !file ? '(purani rahegi)' : ''}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
    </div>
    <label>Description<textarea rows={2} value={v.description} onChange={set('description')} /></label>
    {!id && <div className="panel"><h3>Opening stock (optional)</h3>
      <div className="formgrid"><label>Quantity<input type="number" min="0" step="any" value={v.op_qty} onChange={set('op_qty')} /></label>
        <label>Batch no.<input value={v.op_batch} onChange={set('op_batch')} /></label>
        <label>Mfg date<input type="date" value={v.op_mfg} onChange={set('op_mfg')} /></label>
        <label>Expiry date<input type="date" value={v.op_exp} onChange={set('op_exp')} /></label></div></div>}
    {id && <p className="muted">Stock yahan se nahi badalta. Products list mein "Stock" button use karein, taaki har movement record ho.</p>}
    <div className="row end"><button className="ghost" onClick={onClose}>Cancel</button><button onClick={save} disabled={busy || !v.name.trim()}>{busy ? 'Save ho raha hai…' : 'Save'}</button></div>
  </Modal>);
}
