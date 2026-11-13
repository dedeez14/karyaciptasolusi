import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RequestCtx } from '../context/request-context';
import { ACTIVITY } from '../decorators';
import { NotificationBus } from '../events/notification-bus';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Writes a non-blocking activity trail for every state-changing (or explicitly tagged) request. */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector, private readonly bus: NotificationBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const tagged = this.reflector.get<string>(ACTIVITY, context.getHandler());
    if (!MUTATING.has(req.method) && !tagged) return next.handle();
    const started = Date.now();
    const write = (statusCode: number) => {
      const ctx = RequestCtx.get();
      if (!ctx?.user && !tagged) return; // anonymous calls (e.g. failed login) are logged by their handlers
      this.prisma.activityLog
        .create({
          data: {
            action: tagged ?? `${context.getClass().name.replace('Controller', '')}.${context.getHandler().name}`,
            method: req.method,
            path: req.originalUrl.split('?')[0].slice(0, 255),
            statusCode,
            durationMs: Date.now() - started,
            userId: ctx?.user?.id,
            username: ctx?.user?.username,
            companyId: ctx?.user?.companyId,
            ip: ctx?.ip,
            userAgent: ctx?.userAgent?.slice(0, 255),
            requestId: ctx?.requestId,
          },
        })
        .catch(() => undefined);
    };
    return next.handle().pipe(
      tap({
        next: () => {
          write(context.switchToHttp().getResponse<Response>().statusCode);
          if (MUTATING.has(req.method)) this.bus.emit(RequestCtx.get()?.user?.companyId); // real-time notifications
        },
        error: (err) => write(err?.status ?? 500),
      }),
    );
  }
}
