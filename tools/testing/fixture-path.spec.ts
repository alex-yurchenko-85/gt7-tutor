import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from './fixture-path.ts';

describe('fixture path', () => {
  it('fixture_path_points_into_the_fixtures_folder', () => {
    expect(fixturePath('ce-clean')).toMatch(/[\\/]fixtures[\\/]ce-clean\.ndjson$/);
    expect(existsSync(fixturePath('ce-clean'))).toBe(true);
  });
});
