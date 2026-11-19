import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testTempDir } from '../testing/temp-root.ts';

const script = fileURLToPath(new URL('setup.sh', import.meta.url));

type Machine = {
  system: string;
  docker: 'missing' | 'stopped' | 'running';
  node: string | null;
  pnpm: boolean;
  brew: boolean;
};

const READY_MAC: Machine = { system: 'Darwin', docker: 'running', node: 'v26.1.0', pnpm: true, brew: true };
const READY_LINUX: Machine = { system: 'Linux', docker: 'running', node: 'v26.3.0', pnpm: true, brew: false };

function stub(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(path, 0o755);
}

function nodeStub(version: string): string {
  return `if [ "$1" = "--version" ]; then echo "${version}"; fi\nexit 0`;
}

function prepare(machine: Machine): { dir: string; log: string } {
  const dir = testTempDir('gt7-setup-');
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  stub(dir, 'uname', `echo "${machine.system}"`);
  if (machine.docker !== 'missing') stub(dir, 'docker', machine.docker === 'running' ? 'exit 0' : 'exit 1');
  if (machine.node) stub(dir, 'node', nodeStub(machine.node));
  if (machine.pnpm) stub(dir, 'pnpm', 'exit 0');
  if (machine.brew) {
    const installs = [
      `if [ "$1 $2" = "install node" ]; then printf '#!/bin/sh\\necho "node $*" >> "$STUB_LOG"\\necho v26.1.0\\n' > "${dir}/node"; /bin/chmod 755 "${dir}/node"; fi`,
      `if [ "$1 $2" = "install pnpm" ]; then printf '#!/bin/sh\\necho "pnpm $*" >> "$STUB_LOG"\\n' > "${dir}/pnpm"; /bin/chmod 755 "${dir}/pnpm"; fi`
    ];
    stub(dir, 'brew', installs.join('\n'));
  }
  return { dir, log };
}

function runSetup(machine: Machine, ...args: string[]) {
  const { dir, log } = prepare(machine);
  const result = spawnSync('/bin/sh', [script, ...args], { env: { PATH: dir, STUB_LOG: log, HOME: dir }, encoding: 'utf8' });
  return { code: result.status, output: `${result.stdout}${result.stderr}`, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe.skipIf(process.platform === 'win32')('tools/setup/setup.sh', () => {
  it('dry_run_changes_nothing', () => {
    const run = runSetup({ ...READY_MAC, node: null, pnpm: false }, '--dry-run');
    expect(run.code).toBe(0);
    expect(run.output).toContain('Would run: brew install node');
    expect(run.output).toContain('Would run: brew install pnpm');
    expect(run.output).toContain('Would run: pnpm setup:local');
    expect(run.calls).not.toMatch(/^brew install/m);
    expect(run.calls).not.toMatch(/^pnpm /m);
  });

  it('missing_docker_stops_with_the_link', () => {
    const mac = runSetup({ ...READY_MAC, docker: 'missing' });
    expect(mac.code).toBe(1);
    expect(mac.output).toContain('https://www.docker.com/products/docker-desktop/');
    const linux = runSetup({ ...READY_LINUX, docker: 'missing' });
    expect(linux.code).toBe(1);
    expect(linux.output).toContain('https://docs.docker.com/engine/install/');
    expect(linux.calls).not.toMatch(/^pnpm /m);
  });

  it('stopped_docker_stops_with_the_message', () => {
    const run = runSetup({ ...READY_MAC, docker: 'stopped' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('Docker is installed but not running. Start it, then run this script again.');
    expect(run.calls).not.toMatch(/^pnpm /m);
  });

  it('mac_without_node_uses_brew', () => {
    const run = runSetup({ ...READY_MAC, node: null });
    expect(run.code).toBe(0);
    expect(run.calls).toMatch(/^brew install node$/m);
    expect(run.calls).toMatch(/^pnpm setup:local$/m);
  });

  it('mac_without_pnpm_uses_brew', () => {
    const run = runSetup({ ...READY_MAC, pnpm: false });
    expect(run.code).toBe(0);
    expect(run.calls).toMatch(/^brew install pnpm$/m);
    expect(run.calls).toMatch(/^pnpm setup:local$/m);
  });

  it('linux_without_node_prints_the_link_and_installs_nothing', () => {
    const run = runSetup({ ...READY_LINUX, node: null, brew: true });
    expect(run.code).toBe(1);
    expect(run.output).toContain('https://nodejs.org/en/download');
    expect(run.calls).not.toMatch(/^brew /m);
    expect(run.calls).not.toMatch(/^pnpm /m);
  });

  it('linux_without_pnpm_prints_the_link', () => {
    const run = runSetup({ ...READY_LINUX, pnpm: false });
    expect(run.code).toBe(1);
    expect(run.output).toContain('https://pnpm.io/installation');
  });

  it('old_node_counts_as_missing', () => {
    const run = runSetup({ ...READY_LINUX, node: 'v24.11.0' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('Node.js 26 or later');
    expect(run.output).toContain('https://nodejs.org/en/download');
  });

  it('all_present_runs_setup_local', () => {
    const run = runSetup(READY_LINUX);
    expect(run.code).toBe(0);
    expect(run.calls).toMatch(/^pnpm setup:local$/m);
    expect(run.calls).not.toMatch(/^brew /m);
  });

  it('demo_option_is_passed_on', () => {
    const run = runSetup(READY_MAC, '--demo');
    expect(run.code).toBe(0);
    expect(run.calls).toMatch(/^pnpm setup:local --demo$/m);
  });

  it('unknown_system_points_to_manual_setup', () => {
    const run = runSetup({ ...READY_LINUX, system: 'MINGW64_NT-10.0' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('This script supports macOS and Linux. On Windows, follow "Manual setup" in README.md.');
  });

  it('unknown_option_is_rejected', () => {
    const run = runSetup(READY_LINUX, '--fast');
    expect(run.code).toBe(2);
    expect(run.output).toContain('Unknown option: --fast');
  });
});
