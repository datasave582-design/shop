import { useState } from 'react';
import { api } from './api';

const TYPES = ['General Store', 'Grocery', 'Cosmetics', 'Stationery', 'Electronics', 'CCTV', 'Hardware', 'Garments', 'Mobile Accessories', 'Other'];
const STEPS = ['Shop', 'Owner & Admin', 'Contact', 'Settings', 'Finish'];

export default function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ shopName: '', ownerName: '', username: '', password: '', password2: '', address: '', mobile: '', whatsapp: '', gstin: '', currency: 'INR', businessType: 'General Store', mode: 'single' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    if (step === 0 && !f.shopName.trim()) return 'Shop ka naam likhein.';
    if (step === 1) {
      if (!f.ownerName.trim()) return 'Owner ka naam likhein.';
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(f.username)) return 'Username 3+ characters (letters, numbers, . _ -).';
      if (f.password.length < 8) return 'Password kam se kam 8 characters ka ho.';
      if (f.password !== f.password2) return 'Dono password match nahi karte.';
    }
    return '';
  };
  const next = () => { const e = validate(); setErr(e); if (!e) setStep(step + 1); };
  const finish = async () => {
    setBusy(true); setErr('');
    try { const { password2, ...body } = f; await api('/setup', { method: 'POST', body }); onDone(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="center"><div className="card wide">
      <h1>Shop Management — Setup</h1>
      <div className="steps">{STEPS.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</div>
      {step === 0 && <>
        <label>Shop ka naam *<input value={f.shopName} onChange={set('shopName')} autoFocus /></label>
        <label>Business type<select value={f.businessType} onChange={set('businessType')}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
      </>}
      {step === 1 && <>
        <label>Owner ka naam *<input value={f.ownerName} onChange={set('ownerName')} autoFocus /></label>
        <label>Admin username *<input value={f.username} onChange={set('username')} autoCapitalize="none" /></label>
        <label>Admin password * (8+ characters)<input type="password" value={f.password} onChange={set('password')} /></label>
        <label>Password dobara<input type="password" value={f.password2} onChange={set('password2')} /></label>
      </>}
      {step === 2 && <>
        <label>Shop address<textarea value={f.address} onChange={set('address')} rows={2} /></label>
        <div className="row"><label>Mobile<input value={f.mobile} onChange={set('mobile')} inputMode="tel" /></label>
          <label>WhatsApp<input value={f.whatsapp} onChange={set('whatsapp')} inputMode="tel" /></label></div>
        <label>GSTIN (optional)<input value={f.gstin} onChange={set('gstin')} /></label>
      </>}
      {step === 3 && <>
        <label>Currency<select value={f.currency} onChange={set('currency')}><option>INR</option><option>USD</option><option>AED</option><option>NPR</option><option>BDT</option></select></label>
        <label>Mode
          <select value={f.mode} onChange={set('mode')}>
            <option value="single">Single PC</option>
            <option value="lan">Multi-Computer LAN (server PC)</option>
          </select></label>
        <p className="muted">LAN client connection aur server sharing Phase 6 mein jud jayegi. Abhi data sirf is PC par rahega.</p>
      </>}
      {step === 4 && <>
        <p>Database ban jayega aur <b>{f.shopName}</b> ke liye Owner account <b>{f.username}</b> create hoga. Data is PC par local rahega, internet ki zaroorat nahi.</p>
      </>}
      {err && <div className="error">{err}</div>}
      <div className="row end">
        {step > 0 && <button className="ghost" onClick={() => { setErr(''); setStep(step - 1); }} disabled={busy}>Back</button>}
        {step < 4 ? <button onClick={next}>Next</button> : <button onClick={finish} disabled={busy}>{busy ? 'Ban raha hai…' : 'Setup poora karein'}</button>}
      </div>
    </div></div>
  );
}
