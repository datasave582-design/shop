import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
import { startServer, RunningServer } from '../src/index';
import { openRaw, seed } from '../src/db';
import { migrations } from '../src/migrations';

let srv: RunningServer; let base = ''; let dir = ''; let tok = '';
const call = async (m: string, p: string, body?: any, token = tok) => {
  const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) as any };
};
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop2-'));
  // Phase-1 jaisa purana database banao (sirf migration 1) -> upgrade test
  fs.mkdirSync(path.join(dir, 'Data'), { recursive: true });
  const old = openRaw(path.join(dir, 'Data', 'shop.db'));
  old.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  old.exec(migrations[0].sql); old.prepare('INSERT INTO schema_migrations (id,name) VALUES (1,?)').run(migrations[0].name);
  old.exec("INSERT INTO roles (name,is_system) VALUES ('Owner',1)");
  old.prepare("INSERT INTO users (username,full_name,password_hash,role_id) VALUES ('ram','Ram',?,1)").run(bcrypt.hashSync('Secret#123', 4));
  old.close();
  srv = await startServer({ dataDir: dir, clientDir: path.join(dir, 'none'), port: 0, version: '0.2.0' });
  base = `http://127.0.0.1:${srv.port}`;
  tok = (await call('POST', '/api/auth/login', { username: 'ram', password: 'Secret#123' }, '')).data.token;
});
after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const stockOf = (id: number) => call('GET', `/api/products/${id}`).then(r => r.data);

test('upgrade from Phase 1 DB keeps users, adds new tables, Owner gets new permissions', async () => {
  assert.ok(tok, 'old user can still login');
  const me = (await call('GET', '/api/auth/me')).data.user;
  assert.ok(me.permissions.includes('products.edit'));
  assert.equal((await call('GET', '/api/units')).data.length >= 9, true);
});

test('product create with opening stock, auto SKU/barcode, rules, unique', async () => {
  const cat = (await call('POST', '/api/categories', { name: 'Grocery' })).data.id;
  assert.equal((await call('POST', '/api/categories', { name: 'grocery' })).status, 409);
  const sub = (await call('POST', `/api/categories/${cat}/subcategories`, { name: 'Dairy' })).data.id;
  const r = await call('POST', '/api/products', { name: 'Milk 1L', category_id: cat, subcategory_id: sub, barcode: 'auto', purchase_price: 50, selling_price: 55, mrp: 60, gst_pct: 5, min_stock: 10,
    opening: { quantity: 20, batch_no: 'B1', expiry_date: day(10) } });
  assert.equal(r.status, 200);
  const p = await stockOf(r.data.id);
  assert.equal(p.current_stock, 20); assert.match(p.sku, /^P0000/); assert.equal(p.barcode.length, 13);
  assert.equal(p.batches.length, 1);
  assert.equal((await call('POST', '/api/products', { name: 'X', selling_price: 100, mrp: 90 })).status, 400);        // selling > MRP
  assert.equal((await call('POST', '/api/products', { name: 'Y', sku: p.sku })).status, 409);                         // dup SKU
  assert.equal((await call('POST', '/api/products', { name: 'Z', subcategory_id: sub })).status, 400);               // sub w/o category
  assert.equal((await call('POST', '/api/products', { name: 'W', opening: { quantity: 5, mfg_date: day(5), expiry_date: day(1) } })).status, 400);
  const look = await call('GET', `/api/products/lookup?code=${p.barcode}`);
  assert.equal(look.data.id, r.data.id);
  assert.equal((await call('GET', '/api/products/lookup?code=999')).status, 404);
});

test('stock in/out FEFO, no negative stock, adjust, damage; ledger == batches == product', async () => {
  const id = (await call('POST', '/api/products', { name: 'Biscuit', min_stock: 10, opening: { quantity: 5, batch_no: 'OLD', expiry_date: day(3) } })).data.id;
  await call('POST', '/api/inventory/move', { product_id: id, type: 'stock_in', quantity: 10, batch_no: 'NEW', expiry_date: day(90) });
  await call('POST', '/api/inventory/move', { product_id: id, type: 'stock_in', quantity: 4, batch_no: 'NONE' });
  let p = await stockOf(id); assert.equal(p.current_stock, 19);
  // FEFO: 7 nikalne par OLD (5) khatam, NEW se 2
  assert.equal((await call('POST', '/api/inventory/move', { product_id: id, type: 'stock_out', quantity: 7 })).status, 200);
  p = await stockOf(id);
  const q = (n: string) => p.batches.find((b: any) => b.batch_no === n).qty;
  assert.equal(q('OLD'), 0); assert.equal(q('NEW'), 8); assert.equal(q('NONE'), 4);
  assert.equal((await call('POST', '/api/inventory/move', { product_id: id, type: 'stock_out', quantity: 13 })).status, 409);   // only 12 left
  assert.equal((await call('POST', '/api/inventory/move', { product_id: id, type: 'damage', quantity: 1 })).status, 400);       // reason needed
  assert.equal((await call('POST', '/api/inventory/move', { product_id: id, type: 'damage', quantity: 1, reason: 'toot gaya' })).status, 200);
  const nb = p.batches.find((b: any) => b.batch_no === 'NEW').id;
  assert.equal((await call('POST', '/api/inventory/adjust', { product_id: id, batch_id: nb, counted: 6, reason: 'Count' })).data.diff, -1);
  p = await stockOf(id);
  const ledger = (await call('GET', `/api/stock/movements?product_id=${id}&limit=100`)).data;
  const sumLedger = ledger.rows.reduce((s: number, m: any) => s + m.qty_change, 0);
  const sumBatches = p.batches.reduce((s: number, b: any) => s + b.qty, 0);
  assert.equal(p.current_stock, sumLedger); assert.equal(p.current_stock, sumBatches); assert.equal(p.current_stock, 10);
  assert.equal(ledger.rows[0].balance_after, 10);
  // stock status
  const list = (await call('GET', `/api/products?q=Biscuit`)).data.rows[0];
  assert.equal(list.stock_status, 'low');                                                          // 10 <= min 10
});

test('filters: stock status, expiry, search; delete rules; duplicate; permissions', async () => {
  const exp = (await call('POST', '/api/products', { name: 'Purani Dahi', opening: { quantity: 3, batch_no: 'E1', expiry_date: day(-2) } })).data.id;
  const out = (await call('POST', '/api/products', { name: 'Khali Item' })).data.id;
  assert.ok((await call('GET', '/api/products?expiry=expired')).data.rows.some((r: any) => r.id === exp));
  assert.ok((await call('GET', '/api/products?expiry=30')).data.rows.some((r: any) => r.name === 'Milk 1L'));
  assert.equal((await call('GET', '/api/products?expiry=bogus')).status, 400);
  assert.ok((await call('GET', '/api/products?stock=out')).data.rows.some((r: any) => r.id === out));
  assert.ok((await call('GET', '/api/inventory/batches?expiry=expired')).data.rows.every((r: any) => r.days_left < 0));
  const st = (await call('GET', '/api/dashboard/stats')).data;
  assert.ok(st.expired >= 1 && st.out_of_stock >= 1 && st.stock_value > 0);
  // delete: stock bacha ho to mana, zero ho to soft delete aur SKU free
  assert.equal((await call('DELETE', `/api/products/${exp}`)).status, 400);
  await call('POST', '/api/inventory/move', { product_id: exp, type: 'damage', quantity: 3, reason: 'expired' });
  const sku = (await stockOf(exp)).sku;
  assert.equal((await call('DELETE', `/api/products/${exp}`)).status, 200);
  assert.equal((await call('GET', `/api/products/${exp}`)).status, 404);
  assert.equal((await call('POST', '/api/products', { name: 'Reuse', sku })).status, 200);
  const dup = await call('POST', `/api/products/${out}/duplicate`);
  assert.equal((await stockOf(dup.data.id)).current_stock, 0);
  // Billing Staff: products dekh sakta hai, edit/stock nahi
  const roles = (await call('GET', '/api/roles')).data; const bill = roles.find((r: any) => r.name === 'Billing Staff').id;
  await call('POST', '/api/users', { username: 'counter1', full_name: 'Counter 1', password: 'Counter#123', role_id: bill });
  const t2 = (await call('POST', '/api/auth/login', { username: 'counter1', password: 'Counter#123' }, '')).data.token;
  assert.equal((await call('GET', '/api/products', undefined, t2)).status, 200);
  assert.equal((await call('POST', '/api/products', { name: 'Hack' }, t2)).status, 403);
  assert.equal((await call('POST', '/api/inventory/move', { product_id: out, type: 'stock_in', quantity: 1 }, t2)).status, 403);
  // audit
  const acts = (await call('GET', '/api/audit?limit=200')).data.rows.map((r: any) => r.action);
  for (const a of ['product.create', 'stock.stock_in', 'stock.adjust', 'stock.damage', 'product.delete', 'category.create']) assert.ok(acts.includes(a), a);
});

test('image upload validates content, not extension', async () => {
  const id = (await call('POST', '/api/products', { name: 'Photo item' })).data.id;
  const up = (body: Buffer, type = 'image/jpeg') => fetch(`${base}/api/products/${id}/image`, { method: 'POST', headers: { 'Content-Type': type, Authorization: 'Bearer ' + tok }, body });
  assert.equal((await up(Buffer.from('MZ-not-an-image-just-text-padding'))).status, 400);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
  const ok = await up(jpg); assert.equal(ok.status, 200);
  const { image } = await ok.json() as any;
  assert.equal((await fetch(`${base}/uploads/${image}`)).status, 200);
  assert.equal((await up(jpg, 'application/x-msdownload')).status, 400);
});
