import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { hasData, migrate, openRaw, seed } from './db';
import { createApp } from './app';

export interface StartOptions {
  dataDir: string;
  clientDir: string;
  port?: number;       // 0 = random (tests)
  host?: string;       // Phase 1: sirf 127.0.0.1. LAN mode Phase 6 mein.
  version?: string;
}
export interface RunningServer { port: number; dataDir: string; close: () => Promise<void>; }

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const root = opts.dataDir;
  const dirs = { data: path.join(root, 'Data'), backups: path.join(root, 'Backups'), logs: path.join(root, 'Logs'), uploads: path.join(root, 'Uploads'), exports: path.join(root, 'Exports') };
  Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));

  const logFile = path.join(dirs.logs, 'server.log');
  const logError = (e: unknown, where = '') => {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${where} ${(e as Error)?.stack || e}\n`); } catch { /* ignore */ }
  };

  // config.json: secret sirf server ke paas, frontend ko kabhi nahi jaata.
  const cfgFile = path.join(root, 'config.json');
  let cfg: { secret?: string; lastVersion?: string } = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* first run */ }
  if (!cfg.secret) cfg.secret = crypto.randomBytes(48).toString('hex');

  const db = openRaw(path.join(dirs.data, 'shop.db'));

  // Update se pehle automatic safety backup (migrations se pehle).
  if (opts.version && cfg.lastVersion && cfg.lastVersion !== opts.version && hasData(db)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await db.backup(path.join(dirs.backups, `pre-update-${cfg.lastVersion}-to-${opts.version}-${stamp}.db`));
  }
  migrate(db);
  seed(db);
  if (opts.version) cfg.lastVersion = opts.version;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });

  const app = createApp({ db, secret: cfg.secret, clientDir: opts.clientDir, uploadsDir: dirs.uploads, logError });
  const server = http.createServer(app);
  const host = opts.host || '127.0.0.1';
  const start = opts.port ?? 3000;

  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve((server.address() as any).port); });
  });
  let port = 0;
  for (let p = start; ; p++) {
    try { port = await listen(p); break; }
    catch (e: any) { if (e.code !== 'EADDRINUSE' || start === 0 || p > start + 10) throw e; }
  }

  return {
    port, dataDir: root,
    close: () => new Promise(r => { server.close(() => { try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* ignore */ } r(); }); server.closeAllConnections?.(); }),
  };
}
