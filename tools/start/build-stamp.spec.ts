import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testTempDir } from '../testing/temp-root.ts';
import { buildInputs, inputHash, needsBuild, STAMP_PATH } from './build-stamp.ts';

function put(root: string, path: string, content = path): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function repo(): string {
  const root = testTempDir('gt7-stamp-');
  for (const path of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'tools/package.json',
    'apps/web/public/brand/logo.svg',
    'tsconfig.base.json',
    'apps/server/package.json',
    'apps/server/nest-cli.json',
    'apps/server/tsconfig.json',
    'apps/server/tsconfig.build.json',
    'apps/server/src/main.ts',
    'apps/web/package.json',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'apps/web/src/app/app.ts',
    'packages/core/package.json',
    'packages/core/tsconfig.json',
    'packages/core/src/index.ts',
    'packages/core/src/deep/more.ts',
    'packages/catalogue/package.json',
    'packages/catalogue/src/index.ts',
    'content/tracks/one.json',
  ]) put(root, path);
  return root;
}

function hashOf(root: string): string {
  return inputHash(root, buildInputs(root));
}

describe('build stamp', () => {
  it('stamp_path_is_in_the_data_folder', () => {
    expect(STAMP_PATH).toBe('data/.build-stamp');
  });

  it('build_inputs_are_sorted_relative_paths_of_the_agreed_files', () => {
    const root = repo();
    const inputs = buildInputs(root);
    expect(inputs).toEqual([...inputs].sort());
    expect(inputs).toContain('pnpm-lock.yaml');
    expect(inputs).toContain('package.json');
    expect(inputs).toContain('tsconfig.base.json');
    expect(inputs).toContain('apps/server/nest-cli.json');
    expect(inputs).toContain('apps/server/tsconfig.build.json');
    expect(inputs).toContain('apps/web/index.html');
    expect(inputs).toContain('apps/web/vite.config.ts');
    expect(inputs).toContain('apps/web/src/app/app.ts');
    expect(inputs).toContain('packages/core/tsconfig.json');
    expect(inputs).toContain('packages/core/src/deep/more.ts');
    expect(inputs).toContain('content/tracks/one.json');
    expect(inputs).toHaveLength(22);
  });

  it('a_workspace_package_json_outside_apps_and_packages_counts_without_its_sources', () => {
    const root = repo();
    put(root, 'tools/start/start.ts', 'x');
    const inputs = buildInputs(root);
    expect(inputs).toContain('tools/package.json');
    expect(inputs).not.toContain('tools/start/start.ts');
  });

  it('web_public_files_count', () => {
    expect(buildInputs(repo())).toContain('apps/web/public/brand/logo.svg');
  });

  it('the_workspace_file_counts', () => {
    expect(buildInputs(repo())).toContain('pnpm-workspace.yaml');
  });

  it('same_files_same_hash', () => {
    const root = repo();
    expect(hashOf(root)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf(root)).toBe(hashOf(root));
    expect(hashOf(repo())).toBe(hashOf(root));
  });

  it('one_changed_byte_changes_the_hash', () => {
    const root = repo();
    const before = hashOf(root);
    put(root, 'packages/core/src/index.ts', 'packages/core/src/index.tt');
    expect(hashOf(root)).not.toBe(before);
  });

  it('a_moved_boundary_between_path_and_content_changes_the_hash', () => {
    const first = testTempDir('gt7-stamp-');
    put(first, 'pnpm-lock.yaml', 'ab');
    put(first, 'package.json', 'c');
    const second = testTempDir('gt7-stamp-');
    put(second, 'pnpm-lock.yaml', 'a');
    put(second, 'package.json', 'bc');
    expect(hashOf(first)).not.toBe(hashOf(second));
  });

  it('a_file_in_dist_or_node_modules_does_not_count', () => {
    const root = repo();
    const before = hashOf(root);
    const inputs = buildInputs(root);
    put(root, 'apps/server/dist/main.js', 'built');
    put(root, 'apps/web/dist/index.html', 'built');
    put(root, 'apps/web/src/dist/skipped.ts', 'built');
    put(root, 'node_modules/left/package.json', '{}');
    put(root, 'apps/web/node_modules/left/package.json', '{}');
    put(root, 'packages/core/node_modules/src/index.ts', '{}');
    put(root, 'apps/web/.cache/src/x.ts', 'x');
    put(root, '.git/config', 'x');
    put(root, '.demo/package.json', 'x');
    put(root, 'data/captures/one.bin', 'x');
    put(root, 'README.md', 'x');
    expect(buildInputs(root)).toEqual(inputs);
    expect(hashOf(root)).toBe(before);
  });

  it('a_symbolic_link_out_of_the_repository_is_not_followed', () => {
    const root = repo();
    const outside = testTempDir('gt7-outside-');
    put(outside, 'secret.ts', 'x');
    symlinkSync(outside, join(root, 'content/linked'));
    symlinkSync(join(outside, 'secret.ts'), join(root, 'apps/web/src/secret.ts'));
    expect(buildInputs(root).filter((path) => path.includes('linked') || path.includes('secret'))).toEqual([]);
  });

  it('stamp_needs_no_git', () => {
    const root = repo();
    expect(hashOf(root)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('needs_build_is_true_without_a_stamp_or_with_another_hash_or_missing_output', () => {
    const base = { stamp: 'a', hash: 'a', serverBuilt: true, webBuilt: true };
    expect(needsBuild(base)).toBe(false);
    expect(needsBuild({ ...base, stamp: null })).toBe(true);
    expect(needsBuild({ ...base, hash: 'b' })).toBe(true);
    expect(needsBuild({ ...base, serverBuilt: false })).toBe(true);
    expect(needsBuild({ ...base, webBuilt: false })).toBe(true);
  });
});
