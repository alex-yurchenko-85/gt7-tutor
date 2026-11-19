import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const STAMP_PATH = 'data/.build-stamp';

const SKIPPED_FOLDERS = new Set(['node_modules', 'dist']);
const WALKED_FOLDERS = ['apps', 'packages', 'content'];

const INPUT_PATTERNS = [
  /^pnpm-(lock|workspace)\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /(^|\/)package\.json$/,
  /^(apps|packages)\/[^/]+\/src\//,
  /^content\//,
  /^apps\/web\/(index\.html|public\/)/,
  /^apps\/[^/]+\/(vite\.config\.[^/]+|nest-cli\.json)$/,
  /^(apps|packages)\/[^/]+\/tsconfig[^/]*\.json$/,
];

function walk(root: string, folder: string, found: string[]): void {
  for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) walk(root, path, found);
    } else if (entry.isFile()) found.push(path);
  }
}

function hasFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function buildInputs(repoRoot: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.')) found.push(entry.name);
    else if (entry.isDirectory() && WALKED_FOLDERS.includes(entry.name)) walk(repoRoot, entry.name, found);
    else if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name) && hasFile(join(repoRoot, entry.name, 'package.json'))) found.push(`${entry.name}/package.json`);
  }
  return found.filter((path) => INPUT_PATTERNS.some((pattern) => pattern.test(path))).sort();
}

export function inputHash(repoRoot: string, paths: string[]): string {
  const hash = createHash('sha256');
  for (const path of paths) {
    const content = readFileSync(join(repoRoot, path));
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

export function needsBuild(input: { stamp: string | null; hash: string; serverBuilt: boolean; webBuilt: boolean }): boolean {
  return input.stamp !== input.hash || !input.serverBuilt || !input.webBuilt;
}
