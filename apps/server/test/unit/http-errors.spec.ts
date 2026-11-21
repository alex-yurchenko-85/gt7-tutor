import { BadRequestException, HttpException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodeFilter, httpError } from '../../src/http-errors.js';

function hostFor(type = 'http', headersSent = false) {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    headersSent,
    status(code: number) {
      sent.status = code;
      return response;
    },
    json(body: unknown) {
      sent.body = body;
      return response;
    }
  };
  const host = { getType: () => type, switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, sent };
}

function filtered(exception: unknown) {
  const { host, sent } = hostFor();
  new ErrorCodeFilter().catch(exception, host);
  return sent;
}

describe('http errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('http_error_carries_the_status_the_code_and_the_values', () => {
    const error = httpError(409, 'busy');
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({ code: 'busy' });
    const lap = httpError(400, 'unknown-lap', { lap: 4 });
    expect(lap.getStatus()).toBe(400);
    expect(lap.getResponse()).toEqual({ code: 'unknown-lap', params: { lap: 4 } });
  });

  it('filter_sends_the_code_and_the_values_only', () => {
    expect(filtered(httpError(400, 'unknown-lap', { lap: 4 }))).toEqual({ status: 400, body: { code: 'unknown-lap', params: { lap: 4 } } });
    expect(filtered(new HttpException({ code: 'busy', reason: 'Old words.' }, 409))).toEqual({ status: 409, body: { code: 'busy' } });
  });

  it('filter_turns_a_validation_error_into_invalid_request', () => {
    expect(filtered(new BadRequestException(['name: too short']))).toEqual({ status: 400, body: { code: 'invalid-request' } });
    expect(filtered(new BadRequestException({ code: 'not-a-code', message: 'x' }))).toEqual({ status: 400, body: { code: 'invalid-request' } });
  });

  it('filter_turns_a_bare_not_found_into_not_found', () => {
    expect(filtered(new NotFoundException('Cannot GET /api/nothing'))).toEqual({ status: 404, body: { code: 'not-found' } });
  });

  it('filter_turns_any_other_error_into_server_error_and_logs_it', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(filtered(new Error('database is down'))).toEqual({ status: 500, body: { code: 'server-error' } });
    expect(filtered(new HttpException('Payload Too Large', 413))).toEqual({ status: 413, body: { code: 'server-error' } });
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('filter_leaves_other_transports_alone', () => {
    const { host, sent } = hostFor('ws');
    const error = new Error('socket');
    expect(() => new ErrorCodeFilter().catch(error, host)).toThrow(error);
    expect(sent).toEqual({});
  });

  it('filter_sends_nothing_after_the_headers', () => {
    const { host, sent } = hostFor('http', true);
    new ErrorCodeFilter().catch(httpError(409, 'busy'), host);
    expect(sent).toEqual({});
  });
});
