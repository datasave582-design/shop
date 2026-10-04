import express, { Express, Request } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { Kit } from './kit';
import { findOrCreateBatch, move } from './stock';
import { HttpError, optDate, parse, r2, r3, str } from './util';

export const STATUS_SQL = `CASE WHEN p.current_stock<=0 THEN 'out'
  WHEN p.min_stock>0 AND p.current_stock<=p.min_stock*0.5 THEN 'critical'
  WHEN p.min_stock>0 AND p.current_stock<=p.min_stock THEN 'low' ELSE 'healthy' END`;

/** Batch table alias ke liye expiry filter SQL. */
export function expiryClause(alias: string, expiry: string, from: unknown, to: unknown, soonDays: number, prm: Record<string, unknown>): string {
  const today = "date('now','localtime')";
  const e = `${alias}.expiry_date`;
  if (expiry === 'expired') return `${e} IS NOT NULL AND ${e} < ${today}`;
  if (expiry === 'today') return `${e} = ${today}`;
  if (expiry === 'soon') return `${e} BETWEEN ${today} AND date('now','localtime','+${soonDays} days')`;
  if (['7', '30', '60'].includes(expiry)) return `${e} BETWEEN ${today} AND date('now','localtime','+${Number(expiry)} days')`;
  if (expiry === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
    prm.exFrom = from; prm.exTo = to; return `${e} BETWEEN @exFrom AND @exTo`;
  }
  throw new HttpError(400, 'Expiry filter sahi nahi hai.');
}

const num = (label: string) => z.number({ invalid_type_error: `${label} number hona chahiye.` }).min(0, `${label} negative nahi ho sakta.`).max(1e9);
const id = z.number().int().nullable().optional();
const productBody = z.object({
  name: str(150).min(1, 'Product ka naam likhein.'),
  sku: str(40).optional().default(''),
  barcode: str(40).optional().default(''),
  category_id: id, subcategory_id: id, brand_id: id, unit_id: id,
  description: str(1000).optional().default(''),
  purchase_price: num('Purchase price').default(0),
  selling_price: num('Selling price').default(0),
  mrp: num('MRP').default(0),
  discount_pct: num('Discount').max(100, 'Discount 100% se zyada nahi ho sakta.').default(0),
  gst_pct: num('GST').max(100, 'GST 100% se zyada nahi ho sakta.').default(0),
  min_stock: num('Minimum stock').default(0),
  max_stock: num('Maximum stock').default(0),
  rack: str(40).optional().default(''),
  status: z.enum(['active', 'inactive']).default('active'),
  opening: z.object({
    quantity: num('Opening stock'), batch_no: str(40).optional().default(''), mfg_date: optDate, expiry_date: optDate,
  }).optional(),
});

const ean13 = (productId: number) => {
  const b = '200' + String(productId).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 12; i++) sum += Number(b[i]) * (i % 2 ? 3 : 1);
  return b + ((10 - (sum % 10)) % 10);
};

function sniffImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

export function registerProducts(app: Express, { db, auth, need, audit, me, getSetting }: Kit, uploadsDir: string) {
  const soonDays = () => Math.max(1, Number(getSetting('expiry_warning_days')) || 30);
  const get = (pid: number) => db.prepare('SELECT * FROM products WHERE id=? AND deleted_at IS NULL').get(pid) as any;
  const must = (pid: number) => { const p = get(pid); if (!p) throw new HttpError(404, 'Product nahi mila.'); return p; };

  function checkRules(b: z.infer<typeof productBody>, selfId?: number) {
    if (b.mrp > 0 && b.selling_price > b.mrp) throw new HttpError(400, 'Selling price MRP se zyada nahi ho sakta.');
    if (b.max_stock > 0 && b.min_stock > b.max_stock) throw new HttpError(400, 'Minimum stock maximum se zyada nahi ho sakta.');
    if (b.opening?.mfg_date && b.opening.expiry_date && b.opening.mfg_date > b.opening.expiry_date) throw new HttpError(400, 'Expiry date manufacturing date se pehle nahi ho sakti.');
    if (b.sku && db.prepare('SELECT 1 FROM products WHERE sku=? AND deleted_at IS NULL AND id<>?').get(b.sku, selfId ?? 0)) throw new HttpError(409, 'Ye SKU kisi aur product ka hai.');
    if (b.barcode && b.barcode !== 'auto' && db.prepare('SELECT 1 FROM products WHERE barcode=? AND deleted_at IS NULL AND id<>?').get(b.barcode, selfId ?? 0)) throw new HttpError(409, 'Ye barcode kisi aur product ka hai.');
    if (b.category_id && !db.prepare('SELECT 1 FROM categories WHERE id=?').get(b.category_id)) throw new HttpError(400, 'Category sahi nahi hai.');
    if (b.subcategory_id) {
      const s = db.prepare('SELECT category_id FROM subcategories WHERE id=?').get(b.subcategory_id) as any;
      if (!s || s.category_id !== b.category_id) throw new HttpError(400, 'Subcategory is category ki nahi hai.');
    }
    if (b.brand_id && !db.prepare('SELECT 1 FROM brands WHERE id=?').get(b.brand_id)) throw new HttpError(400, 'Brand sahi nahi hai.');
    if (b.unit_id && !db.prepare('SELECT 1 FROM units WHERE id=?').get(b.unit_id)) throw new HttpError(400, 'Unit sahi nahi hai.');
  }

  function finishCodes(pid: number, sku: string, barcode: string) {
    if (!sku) {
      let s = 'P' + String(pid).padStart(6, '0');
      while (db.prepare('SELECT 1 FROM products WHERE sku=? AND id<>? AND deleted_at IS NULL').get(s, pid)) s += '-' + crypto.randomBytes(2).toString('hex');
      db.prepare('UPDATE products SET sku=? WHERE id=?').run(s, pid);
    }
    if (barcode === 'auto') db.prepare('UPDATE products SET barcode=? WHERE id=?').run(ean13(pid), pid);
  }
  const defaultUnit = () => (db.prepare("SELECT id FROM units WHERE name='Piece'").get() as any)?.id ?? null;

  // ---------- list ----------
  app.get('/api/products', auth, need('products.view'), (req, res) => {
    const q = req.query; const where = ['p.deleted_at IS NULL']; const prm: Record<string, unknown> = {};
    if (q.q) { where.push('(p.name LIKE @q OR p.sku LIKE @q OR p.barcode LIKE @q OR br.name LIKE @q)'); prm.q = `%${String(q.q).trim()}%`; }
    for (const k of ['category_id', 'subcategory_id', 'brand_id'] as const) if (q[k]) { where.push(`p.${k} = @${k}`); prm[k] = Number(q[k]); }
    if (q.status === 'active' || q.status === 'inactive') { where.push('p.status=@status'); prm.status = q.status; }
    if (q.price_min !== undefined && q.price_min !== '') { where.push('p.selling_price >= @pmin'); prm.pmin = Number(q.price_min); }
    if (q.price_max !== undefined && q.price_max !== '') { where.push('p.selling_price <= @pmax'); prm.pmax = Number(q.price_max); }
    if (q.stock) {
      if (!['out', 'critical', 'low', 'healthy', 'low_or_out'].includes(String(q.stock))) throw new HttpError(400, 'Stock filter sahi nahi hai.');
      where.push(q.stock === 'low_or_out' ? `(${STATUS_SQL}) IN ('out','critical','low')` : `(${STATUS_SQL}) = @stock`);
      if (q.stock !== 'low_or_out') prm.stock = q.stock;
    }
    if (q.expiry) where.push(`EXISTS (SELECT 1 FROM product_batches x WHERE x.product_id=p.id AND x.qty>0 AND ${expiryClause('x', String(q.expiry), q.from, q.to, soonDays(), prm)})`);
    const sorts: Record<string, string> = { name: 'p.name COLLATE NOCASE', price: 'p.selling_price', stock: 'p.current_stock', date: 'p.id' };
    const sort = sorts[String(q.sort)] || sorts.name; const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100); const offset = Math.max(Number(q.page) || 0, 0) * limit;
    const from = `FROM products p LEFT JOIN brands br ON br.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id WHERE ${where.join(' AND ')}`;
    const rows = db.prepare(`SELECT p.*, br.name brand, c.name category, u.name unit, (${STATUS_SQL}) stock_status,
        (SELECT MIN(expiry_date) FROM product_batches WHERE product_id=p.id AND qty>0 AND expiry_date IS NOT NULL) nearest_expiry
        ${from} ORDER BY ${sort} ${dir}, p.id LIMIT @limit OFFSET @offset`).all({ ...prm, limit, offset });
    const total = (db.prepare(`SELECT COUNT(*) c ${from}`).get(prm) as any).c;
    res.json({ rows, total });
  });

  // Scanner: exact barcode ya SKU. (Phase 3 POS isi ko use karega.)
  app.get('/api/products/lookup', auth, need('products.view'), (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!code) throw new HttpError(400, 'Code likhein ya scan karein.');
    const p = db.prepare(`SELECT p.*, u.name unit, (${STATUS_SQL}) stock_status FROM products p LEFT JOIN units u ON u.id=p.unit_id
      WHERE p.deleted_at IS NULL AND (p.barcode=@c OR p.sku=@c) LIMIT 1`).get({ c: code });
    if (!p) throw new HttpError(404, 'Is code ka koi product nahi mila.');
    res.json(p);
  });

  app.get('/api/products/:id', auth, need('products.view'), (req, res) => {
    const pid = Number(req.params.id); must(pid);
    const p = db.prepare(`SELECT p.*, br.name brand, c.name category, s.name subcategory, u.name unit, (${STATUS_SQL}) stock_status
      FROM products p LEFT JOIN brands br ON br.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN subcategories s ON s.id=p.subcategory_id LEFT JOIN units u ON u.id=p.unit_id WHERE p.id=?`).get(pid);
    const batches = db.prepare('SELECT * FROM product_batches WHERE product_id=? ORDER BY qty=0, expiry_date IS NULL, expiry_date, id').all(pid);
    res.json({ ...(p as object), batches });
  });

  // ---------- create / update / delete ----------
  app.post('/api/products', auth, need('products.edit'), (req, res) => {
    const b = parse(productBody, req.body); checkRules(b);
    let pid = 0;
    db.transaction(() => {
      pid = Number(db.prepare(`INSERT INTO products (name,sku,barcode,category_id,subcategory_id,brand_id,unit_id,description,purchase_price,selling_price,mrp,discount_pct,gst_pct,min_stock,max_stock,rack,status)
        VALUES (@name,@sku,@barcode,@category_id,@subcategory_id,@brand_id,@unit_id,@description,@pp,@sp,@mrp,@discount_pct,@gst_pct,@min_stock,@max_stock,@rack,@status)`).run({
        name: b.name, sku: b.sku || null, barcode: b.barcode && b.barcode !== 'auto' ? b.barcode : null,
        category_id: b.category_id ?? null, subcategory_id: b.subcategory_id ?? null, brand_id: b.brand_id ?? null, unit_id: b.unit_id ?? defaultUnit(),
        description: b.description, pp: r2(b.purchase_price), sp: r2(b.selling_price), mrp: r2(b.mrp), discount_pct: b.discount_pct, gst_pct: b.gst_pct,
        min_stock: b.min_stock, max_stock: b.max_stock, rack: b.rack, status: b.status,
      }).lastInsertRowid);
      finishCodes(pid, b.sku, b.barcode);
      // Opening stock = pehla ledger entry (har stock movement record hoti hai).
      if (b.opening && b.opening.quantity > 0) {
        const batchId = findOrCreateBatch(db, pid, b.opening.batch_no, b.opening.mfg_date, b.opening.expiry_date, r2(b.purchase_price));
        move(db, { productId: pid, batchId, type: 'opening', qty: r3(b.opening.quantity), reason: 'Opening stock', userId: me(req).id });
      }
      audit(req, me(req), 'product.create', 'product', pid, { name: b.name, opening: b.opening?.quantity ?? 0 });
    })();
    res.json({ id: pid });
  });

  // Edit mein stock nahi badalta - stock sirf Inventory movements se.
  app.put('/api/products/:id', auth, need('products.edit'), (req, res) => {
    const pid = Number(req.params.id); const old = must(pid);
    const b = parse(productBody.omit({ opening: true }), req.body); checkRules(b as any, pid);
    db.transaction(() => {
      db.prepare(`UPDATE products SET name=@name,sku=@sku,barcode=@barcode,category_id=@category_id,subcategory_id=@subcategory_id,brand_id=@brand_id,unit_id=@unit_id,
        description=@description,purchase_price=@pp,selling_price=@sp,mrp=@mrp,discount_pct=@discount_pct,gst_pct=@gst_pct,min_stock=@min_stock,max_stock=@max_stock,
        rack=@rack,status=@status,updated_at=datetime('now') WHERE id=@id`).run({
        id: pid, name: b.name, sku: b.sku || old.sku, barcode: b.barcode === 'auto' ? old.barcode : (b.barcode || null),
        category_id: b.category_id ?? null, subcategory_id: b.subcategory_id ?? null, brand_id: b.brand_id ?? null, unit_id: b.unit_id ?? old.unit_id,
        description: b.description, pp: r2(b.purchase_price), sp: r2(b.selling_price), mrp: r2(b.mrp), discount_pct: b.discount_pct, gst_pct: b.gst_pct,
        min_stock: b.min_stock, max_stock: b.max_stock, rack: b.rack, status: b.status,
      });
      if (b.barcode === 'auto' && !old.barcode) db.prepare('UPDATE products SET barcode=? WHERE id=?').run(ean13(pid), pid);
      const changed: Record<string, unknown> = {};
      for (const k of ['name', 'sku', 'selling_price', 'purchase_price', 'mrp', 'gst_pct', 'status'] as const) if ((b as any)[k] !== undefined && String((b as any)[k]) !== String(old[k]) && (b as any)[k] !== '') changed[k] = { from: old[k], to: (b as any)[k] };
      audit(req, me(req), 'product.update', 'product', pid, changed);
    })();
    res.json({ ok: true });
  });

  app.post('/api/products/:id/duplicate', auth, need('products.edit'), (req, res) => {
    const pid = Number(req.params.id); const p = must(pid); let nid = 0;
    db.transaction(() => {
      nid = Number(db.prepare(`INSERT INTO products (name,category_id,subcategory_id,brand_id,unit_id,description,purchase_price,selling_price,mrp,discount_pct,gst_pct,min_stock,max_stock,rack,status)
        SELECT name || ' (Copy)',category_id,subcategory_id,brand_id,unit_id,description,purchase_price,selling_price,mrp,discount_pct,gst_pct,min_stock,max_stock,rack,status FROM products WHERE id=?`).run(pid).lastInsertRowid);
      finishCodes(nid, '', 'auto');
      audit(req, me(req), 'product.duplicate', 'product', nid, { from: pid, name: p.name });
    })();
    res.json({ id: nid });
  });

  app.delete('/api/products/:id', auth, need('products.edit'), (req, res) => {
    const pid = Number(req.params.id); const p = must(pid);
    if (p.current_stock > 0) throw new HttpError(400, `Is product ka ${p.current_stock} stock bacha hai. Pehle stock zero karein (Damage/Stock Out).`);
    // History bachi rehti hai (soft delete); SKU/barcode dobara use ho sakte hain.
    db.transaction(() => {
      db.prepare("UPDATE products SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(pid);
      audit(req, me(req), 'product.delete', 'product', pid, { name: p.name, sku: p.sku });
    })();
    res.json({ ok: true });
  });

  // ---------- image (local file, validated by content - extension pe bharosa nahi) ----------
  app.post('/api/products/:id/image', auth, need('products.edit'),
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), (req: Request, res) => {
      const pid = Number(req.params.id); const p = must(pid);
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Sirf JPG, PNG ya WEBP image (3 MB tak) upload karein.');
      const ext = sniffImage(req.body);
      if (!ext) throw new HttpError(400, 'Ye valid image file nahi hai.');
      const dir = path.join(uploadsDir, 'products'); fs.mkdirSync(dir, { recursive: true });
      const name = `${pid}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dir, name), req.body);
      if (p.image) fs.rm(path.join(uploadsDir, p.image), () => { /* purani image */ });
      db.prepare("UPDATE products SET image=?, updated_at=datetime('now') WHERE id=?").run(`products/${name}`, pid);
      audit(req, me(req), 'product.image', 'product', pid);
      res.json({ image: `products/${name}` });
    });
}
