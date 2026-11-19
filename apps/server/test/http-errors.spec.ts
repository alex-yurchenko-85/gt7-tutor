import { describe, expect, it } from 'vitest';
import { badRequest, conflict } from '../src/http-errors.js';

describe('http errors', () => {
  it('conflict_carries_a_code_and_a_reason_with_status_409', () => {
    const error = conflict('busy', 'Stop first.');
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({ code: 'busy', reason: 'Stop first.' });
  });

  it('bad_request_carries_a_code_and_a_reason_with_status_400', () => {
    const error = badRequest('no-timer-run', 'No run.');
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({ code: 'no-timer-run', reason: 'No run.' });
  });
});
