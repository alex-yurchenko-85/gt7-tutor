import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/password.js', () => ({
  hashPassword: vi.fn(() => Promise.reject(new Error('scrypt unavailable'))),
  verifyPassword: vi.fn(() => Promise.resolve(false))
}));

describe('AuthService construction', () => {
  it('construction_starts_no_password_hash', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    const { AuthService } = await import('../src/auth/auth.service.js');
    const { SignInLimiter } = await import('../src/auth/sign-in-limiter.js');
    new AuthService({} as never, new SignInLimiter());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
