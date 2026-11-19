import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogVersion, KEEP_LOGS, LOG_DIR, lastLines, logFileName, logHeader, logsToRemove } from './logs.ts';

const CHANGELOG = join(import.meta.dirname, '..', '..', 'CHANGELOG.md');
const START = new Date(2026, 10, 19, 12, 4, 31);

function logNames(count: number): string[] {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const minute = String(index).padStart(2, '0');
    names.push(`2026-11-19_12-${minute}-00.log`);
  }
  return names;
}

describe('logs', () => {
  it('log_dir_and_keep_count', () => {
    expect(LOG_DIR).toBe('data/logs');
    expect(KEEP_LOGS).toBe(10);
  });

  it('log_file_name_for_normal_and_demo_mode_uses_local_time', () => {
    expect(logFileName(START, false)).toBe('2026-11-19_12-04-31.log');
    expect(logFileName(START, true)).toBe('2026-11-19_12-04-31-demo.log');
  });

  it('log_file_name_pads_every_field', () => {
    expect(logFileName(new Date(2026, 0, 2, 3, 4, 5), false)).toBe('2026-01-02_03-04-05.log');
  });

  it('logs_to_remove_keeps_the_newest_ten', () => {
    const names = logNames(12);
    expect(logsToRemove(names, KEEP_LOGS)).toEqual([names[0], names[1]]);
  });

  it('logs_to_remove_ignores_other_files', () => {
    const names = [...logNames(11), 'notes.txt'];
    expect(logsToRemove(names, KEEP_LOGS)).toEqual([names[0]]);
  });

  it('logs_to_remove_is_empty_when_nothing_is_over_the_limit', () => {
    expect(logsToRemove(logNames(10), KEEP_LOGS)).toEqual([]);
    expect(logsToRemove([], KEEP_LOGS)).toEqual([]);
  });

  it('logs_to_remove_counts_demo_and_normal_logs_together_by_time', () => {
    const names = [
      '2026-11-19_10-00-00-demo.log',
      '2026-11-19_10-30-00.log',
      '2026-11-19_11-00-00-demo.log',
      '2026-11-19_11-30-00.log',
    ];
    expect(logsToRemove(names, 2)).toEqual(['2026-11-19_10-00-00-demo.log', '2026-11-19_10-30-00.log']);
  });

  it('logs_to_remove_returns_oldest_first_and_ignores_names_that_only_look_alike', () => {
    const names = [
      '2026-11-19_12-00-00.log.bak',
      '2026-11-19_12-00-01-demo.logx',
      '2026-11-19_12-00-03.log',
      '2026-11-19_12-00-02.log',
    ];
    expect(logsToRemove(names, 1)).toEqual(['2026-11-19_12-00-02.log']);
  });

  it('changelog_version_of_the_changelog_head_is_a_patch_release', () => {
    const text = '# Changelog\n\n## [1.3.1](https://example.test/compare/v1.3.0...v1.3.1) (2026-11-19)\n\n### Bug Fixes\n';
    expect(changelogVersion(text)).toBe('1.3.1');
  });

  it('changelog_version_of_the_repository_changelog_is_a_version_number', () => {
    const text = readFileSync(CHANGELOG, 'utf8');
    expect(changelogVersion(text)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('changelog_version_takes_the_first_release_heading_of_either_level', () => {
    const text = '# [1.4.0](https://example.test/compare) (2026-11-20)\n\n## [1.3.1](https://example.test/x) (2026-11-19)\n';
    expect(changelogVersion(text)).toBe('1.4.0');
  });

  it('changelog_version_of_null_or_without_a_release_is_unknown', () => {
    expect(changelogVersion(null)).toBe('unknown');
    expect(changelogVersion('# Changelog\n\nNothing released.\n')).toBe('unknown');
  });

  it('log_header_is_one_line_with_the_build_hash_cut_to_twelve_characters', () => {
    const header = logHeader({
      start: START,
      version: '1.3.1',
      buildHash: 'abcdef0123456789abcdef0123456789',
      node: '26.0.0',
      platform: 'darwin',
    });
    expect(header).toBe(
      `GT7 Tutor 1.3.1 · build abcdef012345 · Node 26.0.0 · darwin · started ${START.toISOString()}`,
    );
    expect(header.includes('\n')).toBe(false);
  });

  it('last_lines_ignores_a_trailing_newline', () => {
    expect(lastLines('one\ntwo\nthree\n', 2)).toEqual(['two', 'three']);
  });

  it('last_lines_returns_all_lines_when_there_are_fewer', () => {
    expect(lastLines('one\ntwo', 5)).toEqual(['one', 'two']);
  });

  it('last_lines_of_an_empty_text_is_empty', () => {
    expect(lastLines('', 3)).toEqual([]);
  });
});
