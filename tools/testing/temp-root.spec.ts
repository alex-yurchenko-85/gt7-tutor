import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import setupTempRoot, { TEMP_ROOT_ENV, testTempDir } from './temp-root.ts';

describe('test temp root', () => {
  const kept = process.env[TEMP_ROOT_ENV];

  afterEach(() => {
    if (kept === undefined) delete process.env[TEMP_ROOT_ENV];
    else process.env[TEMP_ROOT_ENV] = kept;
  });

  it('test_run_temp_root_is_removed_at_teardown', () => {
    const teardown = setupTempRoot();
    const root = process.env[TEMP_ROOT_ENV]!;
    expect(existsSync(root)).toBe(true);
    const dir = testTempDir('server-');
    expect(dir.startsWith(join(root, 'server-'))).toBe(true);
    mkdirSync(join(dir, 'raw'));
    writeFileSync(join(dir, 'raw', 'capture.ndjson'), '{}\n');
    teardown();
    expect(existsSync(root)).toBe(false);
    expect(process.env[TEMP_ROOT_ENV]).toBeUndefined();
  });

  it('test_temp_dir_falls_back_to_the_system_temp_folder', () => {
    delete process.env[TEMP_ROOT_ENV];
    const dir = testTempDir('gt7-fallback-');
    expect(existsSync(dir)).toBe(true);
    rmSync(dir, { recursive: true });
  });
});
