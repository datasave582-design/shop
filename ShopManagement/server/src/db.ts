import Database from 'better-sqlite3';
import { migrations } from './migrations';
import { PERMISSIONS, ROLE_DEFAULTS } from './permissions';

export type Db = Database.Database;

export function openRaw(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function hasData(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
}

export function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map(r => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
    })();
  }
}

// Idempotent: naye permissions future phases mein apne aap add ho jaate hain.
export function seed(db: Db) {
  db.transaction(() => {
    const addUnit = db.prepare('INSERT OR IGNORE INTO units (name, is_system) VALUES (?, 1)');
    for (const u of ['Piece', 'Box', 'Packet', 'Kg', 'Gram', 'Litre', 'ml', 'Meter', 'Dozen']) addUnit.run(u);
    const addPerm = db.prepare('INSERT OR IGNORE INTO permissions (key, label) VALUES (?, ?)');
    for (const [k, l] of PERMISSIONS) addPerm.run(k, l);
    const getRole = db.prepare('SELECT id FROM roles WHERE name = ?');
    const linkPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?');
    for (const [name, perms] of Object.entries(ROLE_DEFAULTS)) {
      let role = getRole.get(name) as { id: number } | undefined;
      const isNew = !role;
      if (!role) {
        const r = db.prepare('INSERT INTO roles (name, is_system) VALUES (?, 1)').run(name);
        role = { id: Number(r.lastInsertRowid) };
      }
      // Owner ko hamesha saari permissions; baaki roles ko sirf pehli baar defaults.
      if (isNew || name === 'Owner') for (const p of perms) linkPerm.run(role.id, p);
    }
  })();
}
