import { useCallback, useEffect, useRef, useState } from 'react';
import { api, hasToken, setToken, User } from './api';
import Setup from './Setup';
import Login from './Login';
import { Users, Roles } from './Admin';
import { Account, Audit, Dashboard, Settings } from './Misc';
import Products from './Products';
import Inventory from './Inventory';
import Masters from './Masters';

const IDLE_MS = 30 * 60 * 1000; // 30 min idle = auto logout

export default function App() {
  const [boot, setBoot] = useState<'loading' | 'offline' | 'ready'>('loading');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [shop, setShop] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState('dashboard');
  const [notice, setNotice] = useState('');
  const [toastMsg, setToastMsg] = useState<{ m: string; bad?: boolean } | null>(null);
  const [offline, setOffline] = useState(false);
  const [dark, setDark] = useState(localStorage.getItem('theme') === 'dark');
  const idle = useRef<number>();

  const toast = useCallback((m: string, bad?: boolean) => { setToastMsg({ m, bad }); setTimeout(() => setToastMsg(null), 3500); }, []);

  const init = useCallback(async () => {
    setBoot('loading');
    try {
      const st = await api('/setup/status');
      setNeedsSetup(st.needsSetup); setShop(st.shopName);
      if (!st.needsSetup && hasToken()) { try { setUser((await api('/auth/me')).user); } catch { setToken(''); } }
      setBoot('ready');
    } catch { setBoot('offline'); }
  }, []);
  useEffect(() => { init(); }, [init]);

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : ''; localStorage.setItem('theme', dark ? 'dark' : 'light'); }, [dark]);

  const logout = useCallback(async (msg = '') => {
    try { if (hasToken()) await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setToken(''); setUser(null); setNotice(msg); setPage('dashboard');
  }, []);

  useEffect(() => {
    const expired = () => { setToken(''); setUser(null); setNotice('Session khatam ho gaya. Dobara login karein.'); };
    const off = () => setOffline(true); const on = () => setOffline(false);
    window.addEventListener('session-expired', expired); window.addEventListener('server-offline', off);
    return () => { window.removeEventListener('session-expired', expired); window.removeEventListener('server-offline', off); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const reset = () => { window.clearTimeout(idle.current); idle.current = window.setTimeout(() => logout('Kaafi der se koi kaam nahi hua, isliye logout kar diya.'), IDLE_MS); };
    const ev = ['mousedown', 'keydown', 'touchstart']; ev.forEach(e => window.addEventListener(e, reset)); reset();
    return () => { ev.forEach(e => window.removeEventListener(e, reset)); window.clearTimeout(idle.current); };
  }, [user, logout]);

  const retry = async () => { setOffline(false); try { await api('/setup/status'); if (boot === 'offline') init(); } catch { /* banner stays */ } };

  if (boot === 'loading') return <div className="center"><p>Load ho raha hai…</p></div>;
  if (boot === 'offline') return <div className="center"><div className="card"><h2>🔴 Server Offline</h2><p>Shop Server se connection nahi hai.</p><button onClick={init}>Retry</button></div></div>;
  if (needsSetup) return <Setup onDone={() => { setNeedsSetup(false); init(); }} />;
  if (!user) return <Login shopName={shop} notice={notice} onLogin={u => { setNotice(''); setUser(u); }} />;

  const can = (p: string) => user.permissions.includes(p);
  const nav: [string, string, boolean][] = [
    ['dashboard', '📊 Dashboard', true], ['products', '📦 Products', can('products.view')], ['inventory', '🗃️ Inventory', can('inventory.view')], ['masters', '🏷️ Categories', can('products.edit')], ['users', '👤 Users', can('users.manage')], ['roles', '🔐 Roles', can('users.manage')],
    ['audit', '📜 Audit', can('audit.view')], ['settings', '⚙️ Settings', can('settings.edit')], ['account', '🙂 Account', true],
  ];
  const allowed = nav.filter(n => n[2]);

  return (
    <div className="shell">
      <aside>
        <div className="brand">{shop || 'Shop Management'}</div>
        {allowed.map(([k, l]) => <button key={k} className={page === k ? 'nav on' : 'nav'} onClick={() => setPage(k)}>{l}</button>)}
        <div className="grow" />
        <button className="nav" onClick={() => setDark(!dark)}>{dark ? '☀️ Light' : '🌙 Dark'}</button>
        <button className="nav" onClick={() => logout()}>🚪 Logout</button>
        <div className="who">{user.full_name} · {user.role}</div>
      </aside>
      <main>
        {offline && <div className="banner">🔴 Shop Server se connection nahi hai. <button onClick={retry}>Retry</button></div>}
        {page === 'dashboard' && <Dashboard name={user.full_name} shop={shop} onGo={setPage} can={can} />}
        {page === 'products' && can('products.view') && <Products toast={toast} canEdit={can('products.edit')} canStock={can('inventory.adjust')} />}
        {page === 'inventory' && can('inventory.view') && <Inventory toast={toast} canAdjust={can('inventory.adjust')} />}
        {page === 'masters' && can('products.edit') && <Masters toast={toast} />}
        {page === 'users' && can('users.manage') && <Users toast={toast} meId={user.id} />}
        {page === 'roles' && can('users.manage') && <Roles toast={toast} />}
        {page === 'audit' && can('audit.view') && <Audit toast={toast} />}
        {page === 'settings' && can('settings.edit') && <Settings toast={toast} onSaved={setShop} />}
        {page === 'account' && <Account toast={toast} onLogout={() => logout()} />}
      </main>
      {toastMsg && <div className={toastMsg.bad ? 'toast bad' : 'toast'}>{toastMsg.m}</div>}
    </div>
  );
}
