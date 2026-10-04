import { useEffect, useState } from 'react';
import { api } from './api';
import { Toast } from './ui';

function Add({ placeholder, onAdd }: { placeholder: string; onAdd: (n: string) => Promise<void> }) {
  const [n, setN] = useState('');
  const go = async () => { if (!n.trim()) return; await onAdd(n.trim()); setN(''); };
  return <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 10 }}><input placeholder={placeholder} value={n} onChange={e => setN(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} /><button onClick={go}>Add</button></div>;
}

export default function Masters({ toast }: { toast: Toast }) {
  const [cats, setCats] = useState<any[]>([]); const [brands, setBrands] = useState<any[]>([]); const [units, setUnits] = useState<any[]>([]);
  const load = () => Promise.all([api('/categories'), api('/brands'), api('/units')]).then(([c, b, u]) => { setCats(c); setBrands(b); setUnits(u); }).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); load(); } catch (e: any) { toast(e.message, true); } };
  const rename = (path: string, cur: string) => { const n = window.prompt('Naya naam:', cur); if (n && n.trim() && n.trim() !== cur) run(() => api(path, { method: 'PUT', body: { name: n.trim() } }), 'Naam badal diya.'); };
  const del = (path: string, name: string) => { if (window.confirm(`"${name}" delete karein?`)) run(() => api(path, { method: 'DELETE' }), 'Delete ho gaya.'); };

  return (<div>
    <h2>Categories, Brands, Units</h2>
    <div className="cols">
      <div className="panel"><h3>Categories</h3>
        <Add placeholder="Nayi category" onAdd={n => run(() => api('/categories', { method: 'POST', body: { name: n } }), 'Category ban gayi.')} />
        {cats.map(c => (<div key={c.id} className="item"><div className="row between"><b>{c.name}</b>
          <span><button className="ghost" onClick={() => rename('/categories/' + c.id, c.name)}>Rename</button> <button className="ghost" onClick={() => del('/categories/' + c.id, c.name)}>Delete</button></span></div>
          {c.subcategories.map((s: any) => <div key={s.id} className="row between sub"><span>↳ {s.name}</span>
            <span><button className="ghost" onClick={() => rename('/subcategories/' + s.id, s.name)}>Rename</button> <button className="ghost" onClick={() => del('/subcategories/' + s.id, s.name)}>Delete</button></span></div>)}
          <Add placeholder="Nayi subcategory" onAdd={n => run(() => api(`/categories/${c.id}/subcategories`, { method: 'POST', body: { name: n } }), 'Subcategory ban gayi.')} /></div>))}
        {!cats.length && <p className="muted">Abhi koi category nahi.</p>}</div>
      <div className="panel"><h3>Brands</h3>
        <Add placeholder="Naya brand" onAdd={n => run(() => api('/brands', { method: 'POST', body: { name: n } }), 'Brand ban gaya.')} />
        {brands.map(b => <div key={b.id} className="row between item"><span>{b.name}</span><span><button className="ghost" onClick={() => rename('/brands/' + b.id, b.name)}>Rename</button> <button className="ghost" onClick={() => del('/brands/' + b.id, b.name)}>Delete</button></span></div>)}
        {!brands.length && <p className="muted">Abhi koi brand nahi.</p>}</div>
      <div className="panel"><h3>Units</h3>
        <Add placeholder="Custom unit" onAdd={n => run(() => api('/units', { method: 'POST', body: { name: n } }), 'Unit ban gayi.')} />
        {units.map(u => <div key={u.id} className="row between item"><span>{u.name}{u.is_system ? <span className="muted"> · default</span> : ''}</span>
          {!u.is_system && <span><button className="ghost" onClick={() => rename('/units/' + u.id, u.name)}>Rename</button> <button className="ghost" onClick={() => del('/units/' + u.id, u.name)}>Delete</button></span>}</div>)}</div>
    </div>
  </div>);
}
