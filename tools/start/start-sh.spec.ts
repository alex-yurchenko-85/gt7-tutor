import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testTempDir } from '../testing/temp-root.ts';

const script = fileURLToPath(new URL('../../start.sh', import.meta.url));
const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));

type Machine = { system: string; node: string | null };

function stub(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function nodeStub(version: string): string {
  return [
    'if [ "$1" = "--version" ]; then echo "' + version + '"; exit 0; fi',
    'echo "node $*" >> "$STUB_LOG"',
    'echo "cwd $(pwd -P)" >> "$STUB_LOG"'
  ].join('\n');
}

function runStart(machine: Machine, args: string[] = [], cwd?: string) {
  const dir = testTempDir('gt7-start-');
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  stub(dir, 'uname', `echo "${machine.system}"`);
  if (machine.node) stub(dir, 'node', nodeStub(machine.node));
  const result = spawnSync('/bin/sh', [script, ...args], {
    env: { PATH: dir, STUB_LOG: log, HOME: dir },
    encoding: 'utf8',
    cwd: cwd ?? dir
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}`, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

const NODE_MESSAGE = 'Install Node.js 26 or later: https://nodejs.org/en/download';

describe('start.sh', () => {
  it('stops_on_windows_like_systems', () => {
    const run = runStart({ system: 'MINGW64_NT-10.0', node: 'v26.3.0' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('GT7 Tutor runs on macOS and Linux.');
    expect(run.calls).not.toContain('tools/start/start.ts');
  });

  it('stops_without_node', () => {
    const run = runStart({ system: 'Linux', node: null });
    expect(run.code).toBe(1);
    expect(run.output).toContain(NODE_MESSAGE);
  });

  it('stops_with_an_old_node', () => {
    const run = runStart({ system: 'Linux', node: 'v24.11.0' });
    expect(run.code).toBe(1);
    expect(run.output).toContain(NODE_MESSAGE);
    expect(run.calls).not.toContain('tools/start/start.ts');
  });

  it('hands_over_to_node_with_all_arguments', () => {
    const run = runStart({ system: 'Darwin', node: 'v26.3.0' }, ['--demo', '--port', '3002']);
    expect(run.code).toBe(0);
    expect(run.calls).toContain('tools/start/start.ts --demo --port 3002');
  });

  it('runs_from_another_folder', () => {
    const elsewhere = realpathSync(testTempDir('gt7-start-cwd-'));
    const run = runStart({ system: 'Linux', node: 'v26.3.0' }, [], elsewhere);
    expect(run.code).toBe(0);
    expect(run.calls).toContain(`cwd ${root}`);
  });
});
