import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || 'Data sahi nahi hai.');
  return r.data;
};
export const str = (max = 200) => z.string().trim().max(max);
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const validDate = (s: string) => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD format mein ho.').refine(validDate, 'Date sahi nahi hai.');
export const optDate = z.preprocess(v => (v === '' ? null : v), dateStr.nullable().optional());
