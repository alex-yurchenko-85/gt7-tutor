import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { httpError } from '../http-errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isForeignOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return false;
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.headers['sec-fetch-site'] === 'cross-site' || isForeignOrigin(request.headers.origin, request.headers.host)) {
      throw httpError(403, 'cross-site');
    }
    return true;
  }
}
