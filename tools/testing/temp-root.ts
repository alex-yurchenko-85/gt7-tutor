import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEMP_ROOT_ENV = 'GT7_TEST_TEMP_ROOT';

export function testTempDir(prefix: string): string {
  return mkdtempSync(join(process.env[TEMP_ROOT_ENV] ?? tmpdir(), prefix));
}

export default function setupTempRoot(): () => void {
  const root = mkdtempSync(join(tmpdir(), 'gt7-test-'));
  process.env[TEMP_ROOT_ENV] = root;
  return () => {
    rmSync(root, { recursive: true, force: true });
    delete process.env[TEMP_ROOT_ENV];
  };
}
