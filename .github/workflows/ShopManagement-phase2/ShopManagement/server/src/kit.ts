import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Db } from './db';

export interface AuthUser { id: number; username: string; full_name: string; role_id: number; role: string; permissions: string[]; }
export interface Kit {
  db: Db;
  auth: RequestHandler;
  need: (perm: string) => (req: Request, res: Response, next: NextFunction) => void;
  audit: (req: Request | null, user: { id?: number; username?: string } | null, action: string, type?: string, id?: string | number, details?: unknown) => void;
  me: (req: Request) => AuthUser;
  getSetting: (k: string) => string | undefined;
}
