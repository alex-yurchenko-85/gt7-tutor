import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password hashing', () => {
  it('verifies_the_right_password_only', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });

  it('salts_each_hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('malformed_hash_does_not_verify', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});
