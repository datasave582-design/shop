import { Db } from './db';
import { HttpError, r3 } from './util';

export type MoveType = 'opening' | 'stock_in' | 'stock_out' | 'adjustment' | 'damage' | 'lost'
  | 'sale' | 'purchase' | 'sale_return' | 'purchase_return';

export interface MoveInput {
  productId: number; batchId: number; type: MoveType; qty: number; // signed
  reason?: string; refType?: string; refId?: string | number; userId?: number;
}

/** Batch dhoondo ya banao. batch_no '' = default (batch-less) stock. */
export function findOrCreateBatch(db: Db, productId: number, batchNo: string | undefined, mfg?: string | null, exp?: string | null, price = 0): number {
  const no = (batchNo || '').trim();
  const b = db.prepare('SELECT id, mfg_date, expiry_date FROM product_batches WHERE product_id=? AND batch_no=?').get(productId, no) as any;
  if (b) {
    if ((exp && b.expiry_date && exp !== b.expiry_date) || (mfg && b.mfg_date && mfg !== b.mfg_date))
      throw new HttpError(409, 'Is batch number ki dates pehle se alag hain. Naya batch number use karein.');
    if ((!b.expiry_date && exp) || (!b.mfg_date && mfg))
      db.prepare('UPDATE product_batches SET mfg_date=COALESCE(mfg_date,?), expiry_date=COALESCE(expiry_date,?) WHERE id=?').run(mfg ?? null, exp ?? null, b.id);
    return b.id;
  }
  return Number(db.prepare('INSERT INTO product_batches (product_id,batch_no,mfg_date,expiry_date,purchase_price) VALUES (?,?,?,?,?)').run(productId, no, mfg ?? null, exp ?? null, price).lastInsertRowid);
}

/**
 * EK stock movement. Hamesha transaction ke andar chalao (caller ki zimmedari).
 * Batch qty, product current_stock aur stock_movements ledger teeno ek saath badalte hain;
 * negative stock kabhi allow nahi.
 */
export function move(db: Db, m: MoveInput): number {
  const batch = db.prepare('SELECT id, qty, product_id FROM product_batches WHERE id=?').get(m.batchId) as any;
  if (!batch || batch.product_id !== m.productId) throw new HttpError(404, 'Batch nahi mila.');
  const nq = r3(batch.qty + m.qty);
  if (nq < 0) throw new HttpError(409, `Stock kam hai. Is batch mein sirf ${batch.qty} bacha hai.`);
  db.prepare('UPDATE product_batches SET qty=? WHERE id=?').run(nq, m.batchId);
  const p = db.prepare('SELECT current_stock FROM products WHERE id=?').get(m.productId) as any;
  if (!p) throw new HttpError(404, 'Product nahi mila.');
  const bal = r3(p.current_stock + m.qty);
  db.prepare("UPDATE products SET current_stock=?, updated_at=datetime('now') WHERE id=?").run(bal, m.productId);
  db.prepare('INSERT INTO stock_movements (product_id,batch_id,type,qty_change,balance_after,reason,ref_type,ref_id,user_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(m.productId, m.batchId, m.type, m.qty, bal, m.reason ?? '', m.refType ?? null, m.refId != null ? String(m.refId) : null, m.userId ?? null);
  return bal;
}

/** Stock out FEFO: pehle jiski expiry jaldi (bina expiry wale aakhir mein). Phase 3 POS yehi use karega. */
export function moveOutFefo(db: Db, o: { productId: number; qty: number; type: MoveType; reason?: string; refType?: string; refId?: string | number; userId?: number; skipExpired?: boolean }) {
  const batches = db.prepare(`SELECT id, qty FROM product_batches WHERE product_id=? AND qty>0
      ${o.skipExpired ? "AND (expiry_date IS NULL OR expiry_date >= date('now','localtime'))" : ''}
      ORDER BY expiry_date IS NULL, expiry_date, id`).all(o.productId) as { id: number; qty: number }[];
  const total = r3(batches.reduce((s, b) => s + b.qty, 0));
  if (total < o.qty) throw new HttpError(409, `Stock kam hai. Sirf ${total} available hai.`);
  let left = r3(o.qty);
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    move(db, { productId: o.productId, batchId: b.id, type: o.type, qty: -take, reason: o.reason, refType: o.refType, refId: o.refId, userId: o.userId });
    left = r3(left - take);
  }
}
