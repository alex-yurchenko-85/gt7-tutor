import { fileURLToPath } from 'node:url';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/${name}.ndjson`, import.meta.url));
}
