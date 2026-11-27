import type { Request } from 'express';
import { env, isProd } from '../../config/env';
import { RequestCtx } from './request-context';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * True only for a request made on this computer to a development server: not production, opened as
 * http://localhost, coming from the loopback address and not through any proxy (a reverse proxy or tunnel
 * on the same machine adds forwarding headers, so internet traffic can never pass this check).
 */
export function isLocalDevRequest(req: Request): boolean {
  if (isProd) return false;
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  const proxied = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip'] || req.headers.forwarded);
  return !proxied && LOOPBACK.test(req.socket.remoteAddress ?? '') && LOCAL_HOSTS.includes(host);
}

/** DEV_SKIP_MFA: no two-factor step while developing on this computer (never in production, never remotely) */
export function devMfaSkipped(): boolean {
  return !isProd && env.DEV_SKIP_MFA && RequestCtx.get()?.localDev === true;
}
