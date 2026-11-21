import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isErrorCode, type ErrorCode, type Params } from '@gt7/contracts';
import type { Response } from 'express';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503;
export type ErrorBody = { code: ErrorCode; params?: Params };

export function httpError(status: ErrorStatus, code: ErrorCode, params?: Params): HttpException {
  return new HttpException(params ? { code, params } : { code }, status);
}

function isParams(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string' || typeof item === 'number');
}

function bodyOf(exception: HttpException): ErrorBody {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null && 'code' in response && isErrorCode(response.code)) {
    const params = 'params' in response ? response.params : undefined;
    return isParams(params) ? { code: response.code, params } : { code: response.code };
  }
  const status = exception.getStatus();
  if (status === 400) return { code: 'invalid-request' };
  if (status === 404) return { code: 'not-found' };
  return { code: 'server-error' };
}

@Catch()
export class ErrorCodeFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body: ErrorBody = exception instanceof HttpException ? bodyOf(exception) : { code: 'server-error' };
    if (body.code === 'server-error') this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
