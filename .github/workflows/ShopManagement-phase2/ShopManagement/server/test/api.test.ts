import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startServer, RunningServer } from '../src/index';

let srv: RunningServer; let base = ''; let dir = '';
const call = async (m: string, p: string, body?: any, token?: string) => {
  const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) as any };
};
const setup = { shopName: 'Test Shop', ownerName: 'Owner', username: 'admin', password: 'Secret#123', mode: 'single' };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-'));
  srv = await startServer({ dataDir: dir, clientDir: path.join(dir, 'none'), port: 0, version: '1.0.0' });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('setup, login, wrong password, setup twice', async () => {
  assert.equal((await call('GET', '/api/setup/status')).data.needsSetup, true);
  assert.equal((await call('POST', '/api/setup', { ...setup, password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/setup', setup)).status, 200);
  assert.equal((await call('POST', '/api/setup', setup)).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  const ok = await call('POST', '/api/auth/login', { username: 'admin', password: setup.password });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.user.permissions.includes('users.manage'));
  assert.equal(JSON.stringify(ok.data).includes('password_hash'), false);
});

test('protected routes, roles & permissions, audit, last owner', async () => {
  assert.equal((await call('GET', '/api/users')).status, 401);
  const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: setup.password })).data;
  const roles = (await call('GET', '/api/roles', undefined, admin.token)).data;
  const billing = roles.find((r: any) => r.name === 'Billing Staff');
  const c = await call('POST', '/api/users', { username: 'counter1', full_name: 'Counter 1', password: 'Counter#123', role_id: billing.id }, admin.token);
  assert.equal(c.status, 200);
  const staff = (await call('POST', '/api/auth/login', { username: 'counter1', password: 'Counter#123' })).data;
  assert.equal((await call('GET', '/api/users', undefined, staff.token)).status, 403);
  assert.equal((await call('GET', '/api/audit', undefined, staff.token)).status, 403);
  // custom role
  const nr = await call('POST', '/api/roles', { name: 'Auditor', permissions: ['audit.view'] }, admin.token);
  assert.equal(nr.status, 200);
  // deactivated user's old token dies
  await call('PATCH', `/api/users/${c.data.id}`, { active: false }, admin.token);
  assert.equal((await call('GET', '/api/auth/me', undefined, staff.token)).status, 401);
  // last owner protection
  assert.equal((await call('PATCH', `/api/users/${admin.user.id}`, { active: false }, admin.token)).status, 400);
  const audit = (await call('GET', '/api/audit?limit=100', undefined, admin.token)).data;
  const actions = audit.rows.map((r: any) => r.action);
  for (const a of ['setup.complete', 'login', 'login.failed', 'user.create', 'role.create', 'user.update']) assert.ok(actions.includes(a), a);
});

test('settings + change password invalidates old token', async () => {
  const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: setup.password })).data;
  assert.equal((await call('PUT', '/api/settings', { shop_name: 'Naya Naam' }, admin.token)).status, 200);
  assert.equal((await call('GET', '/api/settings', undefined, admin.token)).data.shop_name, 'Naya Naam');
  const cp = await call('POST', '/api/auth/change-password', { current: setup.password, next: 'Another#456' }, admin.token);
  assert.equal(cp.status, 200);
  assert.equal((await call('GET', '/api/auth/me', undefined, admin.token)).status, 401);
  assert.equal((await call('GET', '/api/auth/me', undefined, cp.data.token)).status, 200);
});
