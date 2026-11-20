import { describe, expect, it } from 'vitest';
import { SIGN_IN_FAILURE_LIMIT, SignInLimiter } from '../../src/auth/sign-in-limiter.js';

describe('SignInLimiter', () => {
  it('names_that_differ_in_case_have_separate_limits', () => {
    const limiter = new SignInLimiter();
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i++) limiter.recordFailure('alex', '10.0.0.2', 1000);
    expect(limiter.isBlocked('alex', '10.0.0.2', 1001)).toBe(true);
    expect(limiter.isBlocked('Alex', '10.0.0.2', 1001)).toBe(false);
  });
});
