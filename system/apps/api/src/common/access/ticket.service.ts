import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MemoryCache } from '../cache/memory-cache';
import { AuthUser } from '../context/request-context';

interface Ticket {
  userId: string;
  companyId: string;
  branchId: string | null;
  path: string;
}

/** Only these read-only file endpoints may be opened with a ticket */
const ALLOWED = [/^\/documents\/[A-Z]{2,3}\/[0-9a-f-]{36}\/pdf$/i, /^\/payments\/(in|out)\/[0-9a-f-]{36}\/pdf$/, /^\/hris\/payroll\/[0-9a-f-]{36}\/payslips\/[0-9a-f-]{36}\/pdf$/, /^\/files\/[0-9a-f-]{36}\/download$/];

/**
 * Short-lived, single-use, path-bound download tickets.
 * Lets the browser open a PDF / image natively (new tab or iframe) without ever putting
 * the access token in a URL. A ticket is valid for 60 seconds and for exactly one request.
 */
@Injectable()
export class TicketService {
  constructor(private readonly cache: MemoryCache) {}

  issue(user: AuthUser, path: string): string {
    if (!ALLOWED.some((r) => r.test(path))) throw new BadRequestException('This resource cannot be opened with a ticket');
    const token = randomBytes(32).toString('base64url');
    this.cache.set<Ticket>(`ticket:${token}`, { userId: user.id, companyId: user.companyId, branchId: user.branchId, path }, 60);
    return token;
  }

  consume(token: string, path: string): Ticket | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const key = `ticket:${token}`;
    const t = this.cache.get<Ticket>(key);
    this.cache.invalidate(key); // single use, even on mismatch
    return t && t.path === path ? t : null;
  }
}
