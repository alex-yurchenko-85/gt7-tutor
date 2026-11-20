import { describe, expect, it } from 'vitest';
import { readCookie } from '../../src/auth/session-cookie.js';

describe('session cookie', () => {
  it('reads_the_named_cookie', () => {
    expect(readCookie('a=1; gt7_session=abc; b=2', 'gt7_session')).toBe('abc');
    expect(readCookie('a=1', 'gt7_session')).toBeNull();
    expect(readCookie(undefined, 'gt7_session')).toBeNull();
  });

  it('malformed_cookie_value_is_no_session', () => {
    expect(readCookie('gt7_session=%E0%A4%A', 'gt7_session')).toBeNull();
  });
});
