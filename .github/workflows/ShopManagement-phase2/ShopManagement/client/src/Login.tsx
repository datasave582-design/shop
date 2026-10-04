import { useState } from 'react';
import { api, setToken, User } from './api';

export default function Login({ shopName, onLogin, notice }: { shopName: string; onLogin: (u: User) => void; notice?: string }) {
  const [username, setU] = useState(''); const [password, setP] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/auth/login', { method: 'POST', body: { username, password } }); setToken(r.token); onLogin(r.user); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="center"><div className="card">
      <h1>{shopName || 'Shop Management'}</h1>
      <p className="muted">Login karein</p>
      {notice && <div className="error">{notice}</div>}
      <label>Username<input value={username} onChange={e => setU(e.target.value)} autoFocus autoCapitalize="none" /></label>
      <label>Password<input type="password" value={password} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></label>
      {err && <div className="error">{err}</div>}
      <button onClick={submit} disabled={busy || !username || !password}>{busy ? '…' : 'Login'}</button>
    </div></div>
  );
}
