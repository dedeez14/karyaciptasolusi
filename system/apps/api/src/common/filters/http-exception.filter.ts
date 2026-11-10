import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { RequestCtx } from '../context/request-context';
import { createCipheriv, randomBytes } from 'node:crypto';

/** Uniform error envelope. Never leaks stack traces or SQL details to clients. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = RequestCtx.get()?.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';
    let errors: Record<string, string> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      message = typeof body === 'string' ? body : Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? exception.message;
      errors = body?.errors;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation failed';
      errors = Object.fromEntries(exception.issues.map((i) => [i.path.join('.') || '_', i.message]));
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const target = (exception.meta?.target as string[] | string | undefined) ?? '';
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `A record with the same ${Array.isArray(target) ? target.filter((t) => t !== 'companyId').join(', ') : target} already exists`;
          break;
        case 'P2025':
        case 'P2023': // malformed id
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2003':
          status = HttpStatus.CONFLICT;
          message = 'This record is referenced by other data and cannot be changed';
          break;
        case 'P2010':
        default:
          this.logger.error(`[${requestId}] ${exception.code} ${exception.message}`);
      }
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError || exception instanceof Prisma.PrismaClientValidationError) {
      const raw = (exception as Error).message;
      const dbMsg = /ERROR: ([^\n]+)/.exec(raw)?.[1] ?? /message: "([^"]+)"/.exec(raw)?.[1];
      if (dbMsg && /append-only|cannot be modified|chk_/.test(dbMsg)) {
        status = HttpStatus.CONFLICT;
        message = dbMsg.replace(/^.*?: /, '');
      } else {
        this.logger.error(`[${requestId}] ${raw}`);
      }
    } else {
      this.logger.error(`[${requestId}] ${(exception as Error)?.stack ?? exception}`);
    }

    const body = { success: false, statusCode: status, message, errors, requestId };
    const t = (RequestCtx.get() as any)?.transport as { key: Buffer; nonce: string } | undefined;
    if (t && !res.headersSent) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', t.key, iv);
      c.setAAD(Buffer.from(`RES\n${t.nonce}`));
      const ct = Buffer.concat([c.update(JSON.stringify(body)), c.final(), c.getAuthTag()]);
      res.status(status).json({ __enc: 1, iv: iv.toString('base64url'), ct: ct.toString('base64url') });
      return;
    }
    res.status(status).json(body);
  }
}
