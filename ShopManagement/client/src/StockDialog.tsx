import { useEffect, useState } from 'react';
import { api } from './api';
import { Modal, Toast } from './ui';

type Mode = 'stock_in' | 'stock_out' | 'damage' | 'lost' | 'adjust';
const LABEL: Record<Mode, string> = { stock_in: '➕ Stock In', stock_out: '➖ Stock Out', damage: '💥 Damage', lost: '❓ Lost', adjust: '🧮 Count adjust' };

export default function StockDialog({ product, onClose, onDone, toast }: { product: { id: number; name: string }; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [detail, setDetail] = useState<any>(null);
  const [mode, setMode] = useState<Mode>('stock_in');
  const [f, setF] = useState({ quantity: '', batch_no: '', mfg_date: '', expiry_date: '', purchase_price: '', reason: '', batch_id: '', counted: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/products/' + product.id).then(setDetail).catch(e => toast(e.message, true)); }, [product.id]);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const batches: any[] = (detail?.batches || []).filter((b: any) => b.qty > 0);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'adjust') {
        await api('/inventory/adjust', { method: 'POST', body: { product_id: product.id, batch_id: Number(f.batch_id), counted: Number(f.counted), reason: f.reason } });
      } else {
        await api('/inventory/move', { method: 'POST', body: {
          product_id: product.id, type: mode, quantity: Number(f.quantity), reason: f.reason,
          ...(mode === 'stock_in' ? { batch_no: f.batch_no, mfg_date: f.mfg_date, expiry_date: f.expiry_date, ...(f.purchase_price ? { purchase_price: Number(f.purchase_price) } : {}) }
            : f.batch_id ? { batch_id: Number(f.batch_id) } : {}) } });
      }
      toast('Stock update ho gaya.'); onDone(); onClose();
    } catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  const ok = mode === 'adjust' ? f.batch_id && f.counted !== '' && f.reason : Number(f.quantity) > 0 && (mode === 'stock_in' || mode === 'stock_out' || f.reason);

  return (<Modal title={`Stock: ${product.name}`} onClose={onClose}>
    <p className="muted">Abhi stock: <b>{detail ? detail.current_stock : '…'}</b> {detail?.unit}</p>
    <div className="chips">{(Object.keys(LABEL) as Mode[]).map(m => <button key={m} className={m === mode ? '' : 'ghost'} onClick={() => setMode(m)}>{LABEL[m]}</button>)}</div>
    {mode === 'stock_in' && <>
      <div className="row"><label>Quantity *<input type="number" min="0" step="any" value={f.quantity} onChange={set('quantity')} autoFocus /></label>
        <label>Batch no.<input value={f.batch_no} onChange={set('batch_no')} /></label></div>
      <div className="row"><label>Mfg date<input type="date" value={f.mfg_date} onChange={set('mfg_date')} /></label>
        <label>Expiry date<input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></label>
        <label>Purchase price<input type="number" min="0" step="any" value={f.purchase_price} onChange={set('purchase_price')} /></label></div>
    </>}
    {(mode === 'stock_out' || mode === 'damage' || mode === 'lost') && <>
      <div className="row"><label>Quantity *<input type="number" min="0" step="any" value={f.quantity} onChange={set('quantity')} autoFocus /></label>
        <label>Batch<select value={f.batch_id} onChange={set('batch_id')}><option value="">Auto (pehle expiry wala)</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.batch_no || 'Default'} · {b.qty}{b.expiry_date ? ` · exp ${b.expiry_date}` : ''}</option>)}</select></label></div>
    </>}
    {mode === 'adjust' && <div className="row">
      <label>Batch *<select value={f.batch_id} onChange={set('batch_id')}><option value="">Chunein…</option>
        {(detail?.batches || []).map((b: any) => <option key={b.id} value={b.id}>{b.batch_no || 'Default'} · system: {b.qty}</option>)}</select></label>
      <label>Gini hui quantity *<input type="number" min="0" step="any" value={f.counted} onChange={set('counted')} /></label></div>}
    <label>Reason {mode !== 'stock_in' && mode !== 'stock_out' ? '*' : '(optional)'}<input value={f.reason} onChange={set('reason')} /></label>
    <div className="row end"><button className="ghost" onClick={onClose}>Cancel</button><button onClick={submit} disabled={busy || !ok}>{busy ? '…' : 'Save'}</button></div>
  </Modal>);
}
