import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, map, Observable, switchMap } from 'rxjs';
import { RequestCtx } from '../../common/context/request-context';
import { TransportService } from './transport.service';

/** Routes that must stay plain: health/branding/handshake/QR verification, and native file opening via tickets */
const EXEMPT = /^\/api\/v1\/(health|public\/)/;

/**
 * Decrypts & verifies incoming requests and encrypts outgoing JSON (see TransportService).
 * Runs before validation pipes, so controllers always receive plain, already-authenticated data.
 */
@Injectable()
export class TransportInterceptor implements NestInterceptor {
  constructor(private readonly transport: TransportService, private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (EXEMPT.test(req.path) || typeof req.query.ticket === 'string') return next.handle();

    return from(this.transport.enabled()).pipe(
      switchMap((enabled) => {
        const clientKey = String(req.headers['x-client-key'] ?? '');
        if (!enabled && !clientKey) return next.handle();
        if (!clientKey) throw new BadRequestException('Encrypted transport required. Reload the page.');

        const ts = String(req.headers['x-ts'] ?? '');
        const nonce = String(req.headers['x-nonce'] ?? '');
        const key = this.transport.check(clientKey, ts, nonce);
        const aad = this.transport.aad(req.method, req.originalUrl, ts, nonce);

        if (this.transport.isEnvelope(req.body)) {
          const plain = this.transport.decrypt(key, req.body, aad).toString('utf8');
          req.body = plain ? JSON.parse(plain) : {};
        } else {
          this.transport.verifySig(key, String(req.headers['x-sig'] ?? ''), aad);
        }

        // response encryption key material for this request (also used by the exception filter)
        const ctx = RequestCtx.get();
        if (ctx) (ctx as any).transport = { key, nonce };
        const resAad = Buffer.from(`RES\n${nonce}`);
        const isSse = this.reflector.get<boolean>('__sse__', context.getHandler());

        return next.handle().pipe(
          map((data) => {
            if (data === undefined) return data; // streamed/binary responses written with @Res()
            if (isSse && data && typeof data === 'object' && 'data' in (data as any)) {
              const ev = data as { type?: string; data: unknown };
              return { ...ev, data: this.transport.encrypt(key, Buffer.from(JSON.stringify(ev.data)), resAad) };
            }
            return this.transport.encrypt(key, Buffer.from(JSON.stringify(data ?? null)), resAad);
          }),
        );
      }),
    );
  }
}
