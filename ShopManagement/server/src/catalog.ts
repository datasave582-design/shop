import { Express } from 'express';
import { z } from 'zod';
import { Kit } from './kit';
import { HttpError, parse, str } from './util';

const nameBody = z.object({ name: str(60).min(1, 'Naam likhein.') });

export function registerCatalog(app: Express, { db, auth, need, audit, me }: Kit) {
  const dupMsg = 'Ye naam pehle se maujood hai.';

  // ---- generic simple list (brands, units) ----
  function simple(path: string, table: string, label: string, usedBy: string, protectSystem: boolean) {
    app.get(`/api/${path}`, auth, need('products.view'), (_q, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY name COLLATE NOCASE`).all()));
    app.post(`/api/${path}`, auth, need('products.edit'), (req, res) => {
      const b = parse(nameBody, req.body);
      if (db.prepare(`SELECT 1 FROM ${table} WHERE name=?`).get(b.name)) throw new HttpError(409, dupMsg);
      const id = Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(b.name).lastInsertRowid);
      audit(req, me(req), `${label}.create`, label, id, b);
      res.json({ id });
    });
    app.put(`/api/${path}/:id`, auth, need('products.edit'), (req, res) => {
      const id = Number(req.params.id); const b = parse(nameBody, req.body);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
      if (!row) throw new HttpError(404, 'Nahi mila.');
      if (protectSystem && row.is_system) throw new HttpError(400, 'Default item rename nahi ho sakta.');
      if (db.prepare(`SELECT 1 FROM ${table} WHERE name=? AND id<>?`).get(b.name, id)) throw new HttpError(409, dupMsg);
      db.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(b.name, id);
      audit(req, me(req), `${label}.update`, label, id, b);
      res.json({ ok: true });
    });
    app.delete(`/api/${path}/:id`, auth, need('products.edit'), (req, res) => {
      const id = Number(req.params.id);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
      if (!row) throw new HttpError(404, 'Nahi mila.');
      if (protectSystem && row.is_system) throw new HttpError(400, 'Default item delete nahi ho sakta.');
      if (db.prepare(`SELECT 1 FROM products WHERE ${usedBy}=? AND deleted_at IS NULL`).get(id)) throw new HttpError(400, 'Ye products mein use ho raha hai. Pehle products badlein.');
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      audit(req, me(req), `${label}.delete`, label, id, { name: row.name });
      res.json({ ok: true });
    });
  }
  simple('brands', 'brands', 'brand', 'brand_id', false);
  simple('units', 'units', 'unit', 'unit_id', true);

  // ---- categories + subcategories ----
  app.get('/api/categories', auth, need('products.view'), (_q, res) => {
    const cats = db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE').all() as any[];
    const subs = db.prepare('SELECT * FROM subcategories ORDER BY name COLLATE NOCASE').all() as any[];
    res.json(cats.map(c => ({ ...c, subcategories: subs.filter(s => s.category_id === c.id) })));
  });
  app.post('/api/categories', auth, need('products.edit'), (req, res) => {
    const b = parse(nameBody, req.body);
    if (db.prepare('SELECT 1 FROM categories WHERE name=?').get(b.name)) throw new HttpError(409, dupMsg);
    const id = Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(b.name).lastInsertRowid);
    audit(req, me(req), 'category.create', 'category', id, b); res.json({ id });
  });
  app.put('/api/categories/:id', auth, need('products.edit'), (req, res) => {
    const id = Number(req.params.id); const b = parse(nameBody, req.body);
    if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(id)) throw new HttpError(404, 'Nahi mila.');
    if (db.prepare('SELECT 1 FROM categories WHERE name=? AND id<>?').get(b.name, id)) throw new HttpError(409, dupMsg);
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(b.name, id);
    audit(req, me(req), 'category.update', 'category', id, b); res.json({ ok: true });
  });
  app.delete('/api/categories/:id', auth, need('products.edit'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM categories WHERE id=?').get(id) as any;
    if (!c) throw new HttpError(404, 'Nahi mila.');
    if (db.prepare('SELECT 1 FROM products WHERE category_id=? AND deleted_at IS NULL').get(id)) throw new HttpError(400, 'Is category mein products hain. Pehle unki category badlein.');
    db.transaction(() => { db.prepare('DELETE FROM categories WHERE id=?').run(id); audit(req, me(req), 'category.delete', 'category', id, { name: c.name }); })();
    res.json({ ok: true });
  });
  app.post('/api/categories/:id/subcategories', auth, need('products.edit'), (req, res) => {
    const cid = Number(req.params.id); const b = parse(nameBody, req.body);
    if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(cid)) throw new HttpError(404, 'Category nahi mili.');
    if (db.prepare('SELECT 1 FROM subcategories WHERE category_id=? AND name=?').get(cid, b.name)) throw new HttpError(409, dupMsg);
    const id = Number(db.prepare('INSERT INTO subcategories (category_id,name) VALUES (?,?)').run(cid, b.name).lastInsertRowid);
    audit(req, me(req), 'subcategory.create', 'subcategory', id, { ...b, category_id: cid }); res.json({ id });
  });
  app.put('/api/subcategories/:id', auth, need('products.edit'), (req, res) => {
    const id = Number(req.params.id); const b = parse(nameBody, req.body);
    const s = db.prepare('SELECT * FROM subcategories WHERE id=?').get(id) as any;
    if (!s) throw new HttpError(404, 'Nahi mila.');
    if (db.prepare('SELECT 1 FROM subcategories WHERE category_id=? AND name=? AND id<>?').get(s.category_id, b.name, id)) throw new HttpError(409, dupMsg);
    db.prepare('UPDATE subcategories SET name=? WHERE id=?').run(b.name, id);
    audit(req, me(req), 'subcategory.update', 'subcategory', id, b); res.json({ ok: true });
  });
  app.delete('/api/subcategories/:id', auth, need('products.edit'), (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM subcategories WHERE id=?').get(id) as any;
    if (!s) throw new HttpError(404, 'Nahi mila.');
    if (db.prepare('SELECT 1 FROM products WHERE subcategory_id=? AND deleted_at IS NULL').get(id)) throw new HttpError(400, 'Ye subcategory products mein use ho rahi hai.');
    db.prepare('DELETE FROM subcategories WHERE id=?').run(id);
    audit(req, me(req), 'subcategory.delete', 'subcategory', id, { name: s.name }); res.json({ ok: true });
  });
}
