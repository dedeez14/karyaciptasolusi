import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC, PERMISSION } from '../decorators';
import { AccessService } from '../access/access.service';
import { TicketService } from '../access/ticket.service';
import { RequestCtx } from '../context/request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard: authentication (JWT) -> tenant resolution (company/branch ACL) -> RBAC permission.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly access: AccessService, private readonly tickets: TicketService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    // One-time download ticket (opening PDFs / images natively in a tab or iframe)
    if (!token && req.method === 'GET' && typeof req.query.ticket === 'string') {
      const path = req.path.replace(/^\/api\/v1/, '');
      const t = this.tickets.consume(req.query.ticket, path);
      if (!t) throw new UnauthorizedException('Link expired. Please open the file again.');
      const user = await this.access.profile(t.userId, t.companyId, t.branchId);
      const ctx = RequestCtx.get();
      if (ctx) ctx.user = user;
      const required = this.reflector.getAllAndOverride<string[]>(PERMISSION, targets);
      if (required?.length && !user.isSuperAdmin && !required.some((c) => user.permissions.has(c))) throw new ForbiddenException('You do not have permission for this action');
      return true;
    }
    if (!token) throw new UnauthorizedException('Authentication required');

    let payload: { sub: string; cid?: string; typ?: string; sid?: string; iat?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Invalid token');

    const companyHeader = String(req.headers['x-company-id'] ?? '') || payload.cid || null;
    const branchHeader = String(req.headers['x-branch-id'] ?? '') || null;
    if (companyHeader && !UUID.test(companyHeader)) throw new ForbiddenException('Invalid company');
    if (branchHeader && !UUID.test(branchHeader)) throw new ForbiddenException('Invalid branch');

    const user = await this.access.profile(payload.sub, companyHeader, branchHeader);
    // an access token dies with its login (logout / revoked session) and with a password change
    if (payload.sid && !(await this.access.sessionAlive(payload.sid))) throw new UnauthorizedException('Session expired');
    const flags = await this.access.accountFlags(payload.sub);
    if (flags.passwordChangedAt && payload.iat && payload.iat * 1000 < flags.passwordChangedAt.getTime() - 1000) throw new UnauthorizedException('Session expired');
    // a temporary password (new user / reset by an administrator) only allows changing it
    if (flags.mustChangePassword && !/^\/(auth\/|notifications(\/|$))/.test(req.path.replace(/^\/api\/v1/, ''))) {
      throw new ForbiddenException({ message: 'Change your temporary password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    const ctx = RequestCtx.get();
    if (ctx) ctx.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION, targets);
    if (required?.length && !user.isSuperAdmin && !required.some((c) => user.permissions.has(c))) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}
