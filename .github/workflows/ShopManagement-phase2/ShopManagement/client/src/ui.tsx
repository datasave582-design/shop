import { ReactNode, useEffect, useState } from 'react';

export function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (<div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={wide ? 'modal wide' : 'modal'}><div className="mhead"><h3>{title}</h3><button className="ghost" onClick={onClose}>✕</button></div>{children}</div></div>);
}
export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  return (<div className="row end"><span className="muted">{total} records</span>
    <button className="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Pichla</button>
    <span className="muted">{page + 1} / {Math.max(1, Math.ceil(total / size))}</span>
    <button className="ghost" disabled={(page + 1) * size >= total} onClick={() => onPage(page + 1)}>Agla ›</button></div>);
}
export const STATUS_ICON: Record<string, string> = { out: '🔴 Out of stock', critical: '🟠 Critical', low: '🟡 Low', healthy: '🟢 Healthy' };
export const money = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const qty = (n: number) => String(Math.round((Number(n) || 0) * 1000) / 1000);
export type Toast = (m: string, bad?: boolean) => void;
