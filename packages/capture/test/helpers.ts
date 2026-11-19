import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}.ndjson`, import.meta.url));
}

export function tempDir(): string {
  return mkdtempSync(join(process.env.GT7_TEST_TEMP_ROOT ?? tmpdir(), 'gt7-capture-'));
}

export function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for condition'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}
