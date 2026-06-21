import type { Request } from 'express';

/**
 * Best-effort extraction of the originating client IP from an Express
 * request. Honours the proxy headers `x-forwarded-for` (first hop) and
 * `x-real-ip` before falling back to the socket-level remote address.
 *
 * Returns `undefined` if no address is available so callers can decide
 * whether to log it as "unknown" or just omit it.
 */
export function extractClientIp(request: Partial<Request>): string | undefined {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  const realIp = request.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp;
  }
  const socket = request.socket as { remoteAddress?: string } | undefined;
  return socket?.remoteAddress ?? request.ip;
}
