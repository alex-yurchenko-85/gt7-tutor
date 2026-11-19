import { describe, expect, it } from 'vitest';
import { api } from '../src/api/client.ts';
import { ApiStub } from './support.tsx';

function count(stub: ApiStub, route: string): number {
  return stub.calls.filter(call => `${call.method} ${call.path}` === route).length;
}

describe('api client', () => {
  it('api_shares_one_request_per_reference', async () => {
    const stub = new ApiStub()
      .on('GET /api/references/r1/path', { gridM: 2 })
      .on('GET /api/references/r1/corners', [])
      .on('GET /api/references/r1/clips', ['brake'])
      .on('GET /api/references/r1/cues', [])
      .on('GET /api/references/r2/path', { gridM: 4 })
      .install();
    const first = await Promise.all([api.referenceTrace('r1'), api.referenceTrace('r1'), api.referenceCorners('r1'), api.referenceClips('r1'), api.referenceCues('r1'), api.referenceCues('r1')]);
    const again = await Promise.all([api.referenceTrace('r1'), api.referenceCorners('r1'), api.referenceClips('r1')]);
    expect(first[0]).toEqual({ gridM: 2 });
    expect(again).toEqual([first[0], first[2], first[3]]);
    expect(await api.referenceTrace('r2')).toEqual({ gridM: 4 });
    expect(count(stub, 'GET /api/references/r1/path')).toBe(1);
    expect(count(stub, 'GET /api/references/r1/corners')).toBe(1);
    expect(count(stub, 'GET /api/references/r1/clips')).toBe(1);
    expect(count(stub, 'GET /api/references/r1/cues')).toBe(1);
    expect(count(stub, 'GET /api/references/r2/path')).toBe(1);
  });

  it('failed_reference_request_is_tried_again', async () => {
    let fail = true;
    const stub = new ApiStub().on('GET /api/references/r1/path', () => (fail ? { status: 500, body: { reason: 'Busy' } } : { gridM: 2 })).install();
    await expect(api.referenceTrace('r1')).rejects.toThrow('Busy');
    fail = false;
    expect(await api.referenceTrace('r1')).toEqual({ gridM: 2 });
    expect(count(stub, 'GET /api/references/r1/path')).toBe(2);
  });

  it('reference_cues_are_read_again_after_the_shared_request', async () => {
    let muted = false;
    const stub = new ApiStub().on('GET /api/references/r1/cues', () => [{ key: 'brake@100', muted }]).install();
    expect(await api.referenceCues('r1')).toEqual([{ key: 'brake@100', muted: false }]);
    muted = true;
    expect(await api.referenceCues('r1')).toEqual([{ key: 'brake@100', muted: true }]);
    expect(count(stub, 'GET /api/references/r1/cues')).toBe(2);
  });

  it('sign_out_forgets_the_shared_reference_data', async () => {
    const stub = new ApiStub().on('GET /api/references/r1/corners', []).on('POST /api/auth/sign-out', { body: undefined }).install();
    await api.referenceCorners('r1');
    await api.signOut();
    await api.referenceCorners('r1');
    expect(count(stub, 'GET /api/references/r1/corners')).toBe(2);
  });

  it('an_error_without_a_reason_says_what_to_do', async () => {
    new ApiStub().on('GET /api/references/r1/path', { status: 500, body: {} }).install();
    await expect(api.referenceTrace('r1')).rejects.toThrow('Something went wrong in GT7 Tutor (status 500). Reload the page. If it happens again, attach the log of this start to an issue.');
  });
});
