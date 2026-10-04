import { Express } from 'express';
import { z } from 'zod';
import { Kit } from './kit';
import { expiryClause, STATUS_SQL } from './products';
import { findOrCreateBatch, move, moveOutFefo } from './stock';
import { HttpError, optDate, parse, r2, r3, str } from './util';

export function registerInventory(app: Express, { db, auth, need, audit, me, getSetting }: Kit) {
  const soonDays = () => Math.max(1, Number(getSetting('expiry_warning_days')) || 30);
  const product = (id: number) => { const p = db.prepare('SELECT id,name,current_stock FROM products WHERE id=? AND deleted_at IS NULL').get(id) as any; if (!p) throw new HttpError(404, 'Product nahi mila.'); return p; };

  const moveBody = z.object({
    product_id: z.number().int(),
    type: z.enum(['stock_in', 'stock_out', 'damage', 'lost']),
    quantity: z.number({ invalid_type_error: 'Quantity number honi chahiye.' }).positive('Quantity zero se zyada honi chahiye.').max(1e9),
    batch_id: z.number().int().optional(),
    batch_no: str(40).optional().default(''), mfg_date: optDate, expiry_date: optDate,
    purchase_price: z.number().min(0).optional(),
    reason: str(200).optional().default(''),
  });

  // Stock In / Out / Damage / Lost
  app.post('/api/inventory/move', auth, need('inventory.adjust'), (req, res) => {
    const b = parse(moveBody, req.body); const user = me(req); product(b.product_id);
    if (b.type !== 'stock_in' && b.type !== 'stock_out' && !b.reason) throw new HttpError(400, 'Damage/Lost ka reason likhein.');
    if (b.mfg_date && b.expiry_date && b.mfg_date > b.expiry_date) throw new HttpError(400, 'Expiry date manufacturing date se pehle nahi ho sakti.');
    const qty = r3(b.quantity); let balance = 0;
    db.transaction(() => {
      if (b.type === 'stock_in') {
        const batchId = findOrCreateBatch(db, b.product_id, b.batch_no, b.mfg_date, b.expiry_date, b.purchase_price ?? 0);
        balance = move(db, { productId: b.product_id, batchId, type: 'stock_in', qty, reason: b.reason, userId: user.id });
      } else if (b.batch_id) {
        balance = move(db, { productId: b.product_id, batchId: b.batch_id, type: b.type, qty: -qty, reason: b.reason, userId: user.id });
      } else {
        moveOutFefo(db, { productId: b.product_id, qty, type: b.type, reason: b.reason, userId: user.id });
        balance = product(b.product_id).current_stock;
      }
      audit(req, me(req), `stock.${b.type}`, 'product', b.product_id, { qty, reason: b.reason, batch_id: b.batch_id, batch_no: b.batch_no });
    })();
    res.json({ balance });
  });

  // Physical count: batch ko counted quantity par set karo (difference ledger mein jaata hai).
  app.post('/api/inventory/adjust', auth, need('inventory.adjust'), (req, res) => {
    const b = parse(z.object({
      product_id: z.number().int(), batch_id: z.number().int(),
      counted: z.number().min(0, 'Count negative nahi ho sakta.').max(1e9),
      reason: str(200).min(1, 'Adjustment ka reason likhein.'),
    }), req.body);
    product(b.product_id);
    let diff = 0;
    db.transaction(() => {
      const batch = db.prepare('SELECT qty FROM product_batches WHERE id=? AND product_id=?').get(b.batch_id, b.product_id) as any;
      if (!batch) throw new HttpError(404, 'Batch nahi mila.');
      diff = r3(r3(b.counted) - batch.qty);
      if (diff === 0) throw new HttpError(400, 'Count pehle jaisa hi hai, koi change nahi.');
      move(db, { productId: b.product_id, batchId: b.batch_id, type: 'adjustment', qty: diff, reason: b.reason, userId: me(req).id });
      audit(req, me(req), 'stock.adjust', 'product', b.product_id, { batch_id: b.batch_id, from: batch.qty, to: b.counted, reason: b.reason });
    })();
    res.json({ diff });
  });

  // Stock history
  app.get('/api/stock/movements', auth, need('inventory.view'), (req, res) => {
    const q = req.query; const where = ['1=1']; const prm: Record<string, unknown> = {};
    if (q.product_id) { where.push('m.product_id=@pid'); prm.pid = Number(q.product_id); }
    if (q.type) { where.push('m.type=@type'); prm.type = String(q.type); }
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(String(q.from))) { where.push('m.created_at >= @from'); prm.from = String(q.from) + ' 00:00:00'; }
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(String(q.to))) { where.push('m.created_at <= @to'); prm.to = String(q.to) + ' 23:59:59'; }
    if (q.q) { where.push('(p.name LIKE @q OR p.sku LIKE @q OR p.barcode LIKE @q)'); prm.q = `%${String(q.q).trim()}%`; }
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100); const offset = Math.max(Number(q.page) || 0, 0) * limit;
    const from = `FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN product_batches b ON b.id=m.batch_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where.join(' AND ')}`;
    const rows = db.prepare(`SELECT m.*, p.name product, p.sku, b.batch_no, u.username ${from} ORDER BY m.id DESC LIMIT @limit OFFSET @offset`).all({ ...prm, limit, offset });
    res.json({ rows, total: (db.prepare(`SELECT COUNT(*) c ${from}`).get(prm) as any).c });
  });

  // Batch / expiry stock
  app.get('/api/inventory/batches', auth, need('inventory.view'), (req, res) => {
    const q = req.query; const where = ['b.qty>0', 'p.deleted_at IS NULL']; const prm: Record<string, unknown> = {};
    if (q.expiry) where.push(expiryClause('b', String(q.expiry), q.from, q.to, soonDays(), prm));
    if (q.q) { where.push('(p.name LIKE @q OR p.sku LIKE @q OR b.batch_no LIKE @q)'); prm.q = `%${String(q.q).trim()}%`; }
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100); const offset = Math.max(Number(q.page) || 0, 0) * limit;
    const from = `FROM product_batches b JOIN products p ON p.id=b.product_id WHERE ${where.join(' AND ')}`;
    const rows = db.prepare(`SELECT b.*, p.name product, p.sku, p.rack,
      CASE WHEN b.expiry_date IS NULL THEN NULL ELSE CAST(julianday(b.expiry_date) - julianday(date('now','localtime')) AS INTEGER) END days_left
      ${from} ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id LIMIT @limit OFFSET @offset`).all({ ...prm, limit, offset });
    res.json({ rows, total: (db.prepare(`SELECT COUNT(*) c ${from}`).get(prm) as any).c });
  });

  // Dashboard stock cards
  app.get('/api/dashboard/stats', auth, need('dashboard.view'), (_q, res) => {
    const one = (sql: string, prm: object = {}) => db.prepare(sql).get(prm) as any;
    const prm: Record<string, unknown> = {};
    const soon = expiryClause('b', 'soon', null, null, soonDays(), prm);
    const exp = expiryClause('b', 'expired', null, null, soonDays(), prm);
    const t = one(`SELECT COUNT(*) products, COALESCE(SUM(current_stock),0) stock, COALESCE(SUM(current_stock*purchase_price),0) value,
      SUM(CASE WHEN current_stock<=0 THEN 1 ELSE 0 END) out_of_stock,
      SUM(CASE WHEN current_stock>0 AND min_stock>0 AND current_stock<=min_stock THEN 1 ELSE 0 END) low_stock
      FROM products p WHERE deleted_at IS NULL AND status='active'`);
    const batchCount = (cond: string) => one(`SELECT COUNT(*) c FROM product_batches b JOIN products p ON p.id=b.product_id WHERE b.qty>0 AND p.deleted_at IS NULL AND ${cond}`, prm).c;
    res.json({
      products: t.products, stock: r3(t.stock), stock_value: r2(t.value), out_of_stock: t.out_of_stock || 0, low_stock: t.low_stock || 0,
      expiring_soon: batchCount(soon), expired: batchCount(exp),
    });
  });
}
