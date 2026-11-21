import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client.ts';
import { ApiStub } from './support.tsx';

const UNKNOWN = (status: number) => `Something went wrong in GT7 Tutor (status ${status}). Reload the page. If it happens again, attach the log of this start to an issue.`;

async function failure(): Promise<ApiError> {
  try {
    await api.raceCompare('r1', 4);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('the request did not fail');
}

describe('api errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows_the_text_of_the_code_with_its_values', async () => {
    new ApiStub().on('GET /api/races/r1/compare', { status: 400, body: { code: 'unknown-lap', params: { lap: 4 } } }).install();
    const error = await failure();
    expect(error.status).toBe(400);
    expect(error.code).toBe('unknown-lap');
    expect(error.message).toBe('Lap 4 is not in this race.');
  });

  it('shows_the_unknown_error_text_with_the_status', async () => {
    new ApiStub().on('GET /api/races/r1/compare', { status: 500, body: {} }).install();
    expect((await failure()).message).toBe(UNKNOWN(500));

    new ApiStub().on('GET /api/races/r1/compare', { status: 409, body: { code: 'no-such-code', reason: 'Server words.' } }).install();
    const unknownCode = await failure();
    expect(unknownCode.message).toBe(UNKNOWN(409));
    expect(unknownCode.code).toBe('no-such-code');

    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, text: async () => '<html><body>Bad gateway</body></html>' }));
    const html = await failure();
    expect(html.status).toBe(502);
    expect(html.code).toBeNull();
    expect(html.message).toBe(UNKNOWN(502));
  });

  it('shows_the_connection_text_when_the_server_cannot_be_reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const offline = await failure();
    expect(offline.status).toBe(0);
    expect(offline.code).toBe('no-connection');
    expect(offline.message).toBe('No connection to the GT7 Tutor server. Check that the server runs and that this device is on the same network.');
  });

  it('shows_the_server_error_text_with_the_status', async () => {
    new ApiStub().on('GET /api/races/r1/compare', { status: 500, body: { code: 'server-error' } }).install();
    expect((await failure()).message).toBe(UNKNOWN(500));
  });
});
