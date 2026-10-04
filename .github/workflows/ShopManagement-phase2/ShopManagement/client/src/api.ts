let token = sessionStorage.getItem('token') || '';
export const setToken = (t: string) => { token = t; t ? sessionStorage.setItem('token', t) : sessionStorage.removeItem('token'); };
export const hasToken = () => !!token;

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    window.dispatchEvent(new Event('server-offline'));
    throw new ApiError('Shop Server se connection nahi hai.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.error || 'Kuch gadbad ho gayi. Dobara try karein.', res.status);
  }
  return data as T;
}

export interface User { id: number; username: string; full_name: string; role: string; permissions: string[]; }

export async function upload(path: string, blob: Blob): Promise<any> {
  let res: Response;
  try { res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': blob.type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: blob }); }
  catch { throw new ApiError('Shop Server se connection nahi hai.', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Image upload nahi ho saki.', res.status);
  return data;
}
