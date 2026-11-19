import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['start.ts', 'flow.ts', 'options.ts', 'build-stamp.ts', 'logs.ts', 'ready.ts', 'database.ts'];

function staticSources(text: string): string[] {
  const pattern = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  return [...text.matchAll(pattern)].map(match => (match[1] ?? match[2])!);
}

describe('start script imports', () => {
  it('finds_static_imports_and_exports', () => {
    const text = ["import knex from 'knex';", "import type { A } from './a.ts';", "export { b } from 'b';", "import 'c';", "const x = await import('uqr');"].join('\n');
    expect(staticSources(text)).toEqual(['knex', './a.ts', 'b', 'c']);
  });

  it.each(FILES)('%s_loads_only_node_and_relative_modules_before_install', file => {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const sources = staticSources(text);
    expect(sources.filter(source => !source.startsWith('node:') && !source.startsWith('.'))).toEqual([]);
  });
});
