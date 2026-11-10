import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DataScope } from '@prisma/client';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  isSuperAdmin: boolean;
  companyId: string;
  branchId: string | null;
  /** branches the user may access in the active company; null = all branches */
  branchIds: string[] | null;
  dataScope: DataScope;
  permissions: Set<string>;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestCtx = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Authenticated user or throw */
  user(): AuthUser {
    const u = storage.getStore()?.user;
    if (!u) throw new UnauthorizedException();
    return u;
  },
  companyId(): string {
    return RequestCtx.user().companyId;
  },
  can(code: string): boolean {
    const u = storage.getStore()?.user;
    return !!u && (u.isSuperAdmin || u.permissions.has(code));
  },
  assert(code: string): void {
    if (!RequestCtx.can(code)) throw new ForbiddenException(`Missing permission: ${code}`);
  },
};
