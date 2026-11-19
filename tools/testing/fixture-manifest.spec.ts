import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Row = Record<string, unknown>;

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../fixtures/manifest.json'), 'utf8')) as { fixtures: Row[] };

describe('fixture manifest', () => {
  it('has_no_start_cue_field_in_any_row', () => {
    expect(manifest.fixtures.length).toBeGreaterThan(0);
    for (const row of manifest.fixtures) {
      expect(Object.keys(row).sort()).toEqual(['file', 'name', 'note', 'peerIp', 'range', 'rows', 'source']);
    }
  });
});
