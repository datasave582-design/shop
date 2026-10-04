import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { Db } from './db';
import { HttpError, parse, str } from './util';
import { Kit } from './kit';
import { registerCatalog } from './catalog';
import { registerProducts } from './products';
import { registerInventory } from './inventory';

export interface Ctx { db: Db; secret: string; clientDir: string; uploadsDir: string; logError: (e: unknown, where?: string) => void; }
interface AuthUser { id: number; username: string; full_name: string; role_id: number; role: string; permissions: string[]; }


const SETTING_KEYS = ['shop_name', 'owner_name', 'address', 'mobile', 'whatsapp', 'email', 'gstin', 'currency',
  'business_type', 'mode', 'invoice_prefix', 'low_stock_threshold', 'expiry_warning_days', 'allow_expired_sale'];
const TOKEN_HOURS = 12;

const password = z.string().min(8, 'Password kam se kam 8 characters ka hona chahiye.').max(100);

export function createApp(ctx: Ctx) {
  const { db } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  const getSetting = (k: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as { value: string } | undefined)?.value;
  const setSetting = db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')");
  const userCount = () => (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;

  const audit = (req: Request | null, user: { id?: number; username?: string } | null, action: string, type?: string, id?: string | number, details?: unknown) => {
    db.prepare('INSERT INTO audit_logs (user_id,username,action,record_type,record_id,details,ip) VALUES (?,?,?,?,?,?,?)')
      .run(user?.id ?? null, user?.username ?? null, action, type ?? null, id != null ? String(id) : null, details ? JSON.stringify(details) : null, req?.ip ?? null);
  };

  const loadPerms = (roleId: number) => (db.prepare('SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?').all(roleId) as { key: string }[]).map(r => r.key);
  const sign = (u: { id: number; session_version: number }) => jwt.sign({ uid: u.id, sv: u.session_version }, ctx.secret, { expiresIn: `${TOKEN_HOURS}h` });

  const auth = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const h = req.headers.authorization || '';
      if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Pehle login karein.');
      let payload: any;
      try { payload = jwt.verify(h.slice(7), ctx.secret); } catch { throw new HttpError(401, 'Session khatam ho gaya. Dobara login karein.'); }
      const u = db.prepare('SELECT u.id,u.username,u.full_name,u.role_id,u.active,u.session_version,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(payload.uid) as any;
      if (!u || !u.active || u.session_version !== payload.sv) throw new HttpError(401, 'Session khatam ho gaya. Dobara login karein.');
      (req as any).user = { id: u.id, username: u.username, full_name: u.full_name, role_id: u.role_id, role: u.role, permissions: loadPerms(u.role_id) } as AuthUser;
      next();
    } catch (e) { next(e); }
  };
  const need = (perm: string) => (req: Request, _res: Response, next: NextFunction) => {
    const u = (req as any).user as AuthUser;
    if (!u.permissions.includes(perm)) return next(new HttpError(403, 'Aapko is kaam ki permission nahi hai.'));
    next();
  };
  const me = (req: Request) => (req as any).user as AuthUser;

  // ---------- health / setup ----------
  app.get('/api/health', (_q, r) => r.json({ ok: true }));

  app.get('/api/setup/status', (_q, r) => r.json({ needsSetup: userCount() === 0, shopName: getSetting('shop_name') || '' }));

  app.post('/api/setup', (req, res) => {
    if (userCount() > 0) throw new HttpError(409, 'Setup pehle hi ho chuka hai.');
    const b = parse(z.object({
      shopName: str().min(1, 'Shop ka naam likhein.'),
      ownerName: str().min(1, 'Owner ka naam likhein.'),
      username: z.string().trim().min(3, 'Username kam se kam 3 characters ka ho.').max(40).regex(/^[A-Za-z0-9._-]+$/, 'Username mein sirf letters, numbers, . _ - allowed hain.'),
      password,
      address: str(400).default(''), mobile: str(20).default(''), whatsapp: str(20).default(''),
      gstin: str(20).default(''), currency: str(10).default('INR'),
      businessType: str(60).default('General Store'),
      mode: z.enum(['single', 'lan']).default('single'),
    }), req.body);
    const owner = db.prepare("SELECT id FROM roles WHERE name='Owner'").get() as { id: number };
    const hash = bcrypt.hashSync(b.password, 10);
    let uid = 0;
    db.transaction(() => {
      const defaults: Record<string, string> = {
        shop_name: b.shopName, owner_name: b.ownerName, address: b.address, mobile: b.mobile, whatsapp: b.whatsapp, email: '',
        gstin: b.gstin, currency: b.currency, business_type: b.businessType, mode: b.mode,
        invoice_prefix: 'INV', low_stock_threshold: '10', expiry_warning_days: '30', allow_expired_sale: '0',
      };
      for (const [k, v] of Object.entries(defaults)) setSetting.run(k, v);
      uid = Number(db.prepare('INSERT INTO users (username,full_name,password_hash,role_id) VALUES (?,?,?,?)').run(b.username, b.ownerName, hash, owner.id).lastInsertRowid);
      audit(req, { id: uid, username: b.username }, 'setup.complete', 'settings', null as any, { mode: b.mode });
    })();
    res.json({ ok: true });
  });

  // ---------- auth ----------
  const attempts = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/login', (req, res) => {
    const b = parse(z.object({ username: str(80).min(1, 'Username likhein.'), password: z.string().min(1, 'Password likhein.').max(100) }), req.body);
    const key = `${req.ip}|${b.username.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.until > Date.now()) throw new HttpError(429, 'Bahut zyada galat try. Thodi der baad dobara try karein.');
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(b.username) as any;
    if (!u || !u.active || !bcrypt.compareSync(b.password, u.password_hash)) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(key, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      audit(req, { username: b.username }, 'login.failed');
      throw new HttpError(401, 'Username ya password galat hai.');
    }
    attempts.delete(key);
    db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
    audit(req, u, 'login');
    const role = (db.prepare('SELECT name FROM roles WHERE id=?').get(u.role_id) as { name: string }).name;
    res.json({ token: sign(u), user: { id: u.id, username: u.username, full_name: u.full_name, role, permissions: loadPerms(u.role_id) } });
  });

  app.get('/api/auth/me', auth, (req, res) => { const { id, username, full_name, role, permissions } = me(req); res.json({ user: { id, username, full_name, role, permissions } }); });

  app.post('/api/auth/logout', auth, (req, res) => { audit(req, me(req), 'logout'); res.json({ ok: true }); });

  app.post('/api/auth/change-password', auth, (req, res) => {
    const b = parse(z.object({ current: z.string().min(1).max(100), next: password }), req.body);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(me(req).id) as any;
    if (!bcrypt.compareSync(b.current, u.password_hash)) throw new HttpError(400, 'Purana password galat hai.');
    db.prepare("UPDATE users SET password_hash=?, session_version=session_version+1, updated_at=datetime('now') WHERE id=?").run(bcrypt.hashSync(b.next, 10), u.id);
    audit(req, u, 'password.change', 'user', u.id);
    const fresh = db.prepare('SELECT id,session_version FROM users WHERE id=?').get(u.id) as any;
    res.json({ ok: true, token: sign(fresh) });
  });

  // ---------- settings ----------
  app.get('/api/settings', auth, (_q, res) => {
    const out: Record<string, string> = {};
    for (const r of db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[]) out[r.key] = r.value;
    res.json(out);
  });
  app.put('/api/settings', auth, need('settings.edit'), (req, res) => {
    const body = parse(z.record(z.string().max(500)), req.body);
    const changed: Record<string, string> = {};
    db.transaction(() => {
      for (const [k, v] of Object.entries(body)) {
        if (!SETTING_KEYS.includes(k)) continue;
        if (k === 'shop_name' && !v.trim()) throw new HttpError(400, 'Shop ka naam khali nahi ho sakta.');
        setSetting.run(k, v.trim()); changed[k] = v.trim();
      }
      audit(req, me(req), 'settings.update', 'settings', null as any, changed);
    })();
    res.json({ ok: true });
  });

  // ---------- roles & users ----------
  app.get('/api/permissions', auth, need('users.manage'), (_q, res) => res.json(db.prepare('SELECT key,label FROM permissions ORDER BY id').all()));

  app.get('/api/roles', auth, need('users.manage'), (_q, res) => {
    const roles = db.prepare('SELECT id,name,is_system FROM roles ORDER BY id').all() as any[];
    res.json(roles.map(r => ({ ...r, permissions: loadPerms(r.id), users: (db.prepare('SELECT COUNT(*) c FROM users WHERE role_id=?').get(r.id) as any).c })));
  });

  const roleBody = z.object({ name: str(40).min(2, 'Role ka naam likhein.'), permissions: z.array(z.string()).max(200) });
  const setRolePerms = (roleId: number, perms: string[]) => {
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id,permission_id) SELECT ?, id FROM permissions WHERE key=?');
    for (const p of perms) ins.run(roleId, p);
  };

  app.post('/api/roles', auth, need('users.manage'), (req, res) => {
    const b = parse(roleBody, req.body);
    if (db.prepare('SELECT 1 FROM roles WHERE name=? COLLATE NOCASE').get(b.name)) throw new HttpError(409, 'Is naam ka role pehle se hai.');
    let id = 0;
    db.transaction(() => {
      id = Number(db.prepare('INSERT INTO roles (name,is_system) VALUES (?,0)').run(b.name).lastInsertRowid);
      setRolePerms(id, b.permissions);
      audit(req, me(req), 'role.create', 'role', id, { name: b.name, permissions: b.permissions });
    })();
    res.json({ id });
  });

  app.put('/api/roles/:id', auth, need('users.manage'), (req, res) => {
    const id = Number(req.params.id);
    const role = db.prepare('SELECT * FROM roles WHERE id=?').get(id) as any;
    if (!role) throw new HttpError(404, 'Role nahi mila.');
    if (role.name === 'Owner') throw new HttpError(400, 'Owner role ki permissions change nahi ho sakti.');
    const b = parse(roleBody, req.body);
    db.transaction(() => {
      if (!role.is_system) db.prepare('UPDATE roles SET name=? WHERE id=?').run(b.name, id);
      setRolePerms(id, b.permissions);
      db.prepare('UPDATE users SET session_version=session_version+1 WHERE role_id=?').run(id);
      audit(req, me(req), 'permission.change', 'role', id, { permissions: b.permissions });
    })();
    res.json({ ok: true });
  });

  app.delete('/api/roles/:id', auth, need('users.manage'), (req, res) => {
    const id = Number(req.params.id);
    const role = db.prepare('SELECT * FROM roles WHERE id=?').get(id) as any;
    if (!role) throw new HttpError(404, 'Role nahi mila.');
    if (role.is_system) throw new HttpError(400, 'Default role delete nahi ho sakta.');
    if ((db.prepare('SELECT COUNT(*) c FROM users WHERE role_id=?').get(id) as any).c) throw new HttpError(400, 'Is role ke users hain. Pehle unka role badlein.');
    db.transaction(() => { db.prepare('DELETE FROM roles WHERE id=?').run(id); audit(req, me(req), 'role.delete', 'role', id, { name: role.name }); })();
    res.json({ ok: true });
  });

  app.get('/api/users', auth, need('users.manage'), (_q, res) => {
    res.json(db.prepare('SELECT u.id,u.username,u.full_name,u.active,u.last_login,u.created_at,u.role_id,r.name role FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id').all());
  });

  app.post('/api/users', auth, need('users.manage'), (req, res) => {
    const b = parse(z.object({
      username: z.string().trim().min(3, 'Username kam se kam 3 characters ka ho.').max(40).regex(/^[A-Za-z0-9._-]+$/, 'Username mein sirf letters, numbers, . _ - allowed hain.'),
      full_name: str(80).min(1, 'Naam likhein.'), password, role_id: z.number().int(),
    }), req.body);
    if (!db.prepare('SELECT 1 FROM roles WHERE id=?').get(b.role_id)) throw new HttpError(400, 'Role sahi nahi hai.');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(b.username)) throw new HttpError(409, 'Ye username pehle se hai.');
    let id = 0;
    db.transaction(() => {
      id = Number(db.prepare('INSERT INTO users (username,full_name,password_hash,role_id) VALUES (?,?,?,?)').run(b.username, b.full_name, bcrypt.hashSync(b.password, 10), b.role_id).lastInsertRowid);
      audit(req, me(req), 'user.create', 'user', id, { username: b.username, role_id: b.role_id });
    })();
    res.json({ id });
  });

  app.patch('/api/users/:id', auth, need('users.manage'), (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(id) as any;
    if (!u) throw new HttpError(404, 'User nahi mila.');
    const b = parse(z.object({ full_name: str(80).min(1).optional(), role_id: z.number().int().optional(), active: z.boolean().optional(), password: password.optional() }), req.body);
    const newRole = b.role_id ?? u.role_id;
    const newActive = b.active ?? !!u.active;
    if (id === me(req).id && !newActive) throw new HttpError(400, 'Aap khud ko deactivate nahi kar sakte.');
    if (u.role === 'Owner' && (!newActive || newRole !== u.role_id)) {
      const owners = (db.prepare("SELECT COUNT(*) c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Owner' AND u.active=1").get() as any).c;
      if (owners <= 1) throw new HttpError(400, 'Kam se kam ek active Owner hona zaroori hai.');
    }
    if (!db.prepare('SELECT 1 FROM roles WHERE id=?').get(newRole)) throw new HttpError(400, 'Role sahi nahi hai.');
    db.transaction(() => {
      const bump = b.password || newRole !== u.role_id || newActive !== !!u.active;
      db.prepare(`UPDATE users SET full_name=?, role_id=?, active=?, password_hash=?, session_version=session_version+?, updated_at=datetime('now') WHERE id=?`)
        .run(b.full_name ?? u.full_name, newRole, newActive ? 1 : 0, b.password ? bcrypt.hashSync(b.password, 10) : u.password_hash, bump ? 1 : 0, id);
      audit(req, me(req), 'user.update', 'user', id, { full_name: b.full_name, role_id: b.role_id, active: b.active, password_reset: !!b.password });
    })();
    res.json({ ok: true });
  });

  // ---------- audit ----------
  app.get('/api/audit', auth, need('audit.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE action LIKE @q OR username LIKE @q OR record_type LIKE @q OR record_id LIKE @q' : '';
    const params = { q: `%${q}%`, limit, offset };
    const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all(params);
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_logs ${where}`).get(q ? { q: params.q } : {}) as any).c;
    res.json({ rows, total });
  });

  const kit: Kit = { db, auth, need, audit, me, getSetting };
  registerCatalog(app, kit);
  registerProducts(app, kit, ctx.uploadsDir);
  registerInventory(app, kit);

  app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Ye API maujood nahi hai.')));

  app.use('/uploads', express.static(ctx.uploadsDir, { dotfiles: 'ignore', maxAge: '1h' }));

  // ---------- static client ----------
  if (fs.existsSync(ctx.clientDir)) {
    app.use(express.static(ctx.clientDir));
    app.get('*', (_q, res) => res.sendFile(path.join(ctx.clientDir, 'index.html')));
  }

  // ---------- errors (raw technical errors kabhi user ko nahi dikhte) ----------
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Data sahi nahi hai.' });
    ctx.logError(err, `${req.method} ${req.path}`);
    res.status(500).json({ error: 'Kuch gadbad ho gayi. Please dobara try karein.' });
  });

  return app;
}
