import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { vi } from 'vitest';

const TEST_COST = { N: 1024, r: 8, p: 1 };
const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number, options: typeof TEST_COST) => Promise<Buffer>;

vi.mock(import('../../src/auth/password.js'), async importOriginal => ({
  ...(await importOriginal()),
  hashPassword: async (password: string) => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, 64, TEST_COST);
    return ['scrypt', TEST_COST.N, TEST_COST.r, TEST_COST.p, salt.toString('base64'), key.toString('base64')].join('$');
  }
}));
