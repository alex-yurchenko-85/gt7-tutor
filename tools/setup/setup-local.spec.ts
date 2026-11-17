import { describe, expect, it } from 'vitest';
import { setupLocal, type Runner } from './setup-steps.ts';

class FakeRunner implements Runner {
  readonly commands: string[] = [];
  readonly lines: string[] = [];
  readonly copies: string[] = [];
  readonly files = new Set<string>(['.env.example']);
  failing: string | null = null;
  dockerRunning = true;
  version = '26.13.1';

  async run(command: string, args: string[]): Promise<number> {
    const line = [command, ...args].join(' ');
    this.commands.push(line);
    if (line === 'docker info') return this.dockerRunning ? 0 : 1;
    return line === this.failing ? 1 : 0;
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  copy(from: string, to: string): void {
    this.copies.push(`${from} -> ${to}`);
    this.files.add(to);
  }

  print(line: string): void {
    this.lines.push(line);
  }

  nodeVersion(): string {
    return this.version;
  }
}

const SETUP_COMMANDS = ['docker info', 'pnpm install --frozen-lockfile', 'pnpm db:up', 'pnpm db:migrate', 'pnpm build'];

describe('pnpm setup:local', () => {
  it('steps_run_in_order', async () => {
    const runner = new FakeRunner();
    expect(await setupLocal(runner, { demo: false })).toBe(0);
    expect(runner.commands).toEqual(SETUP_COMMANDS);
    expect(runner.copies).toEqual(['.env.example -> .env']);
    expect(runner.lines).toContain('Step 4 of 7: installing packages');
    expect(runner.lines).toContain('Ready. Start the application with: pnpm start');
    expect(runner.lines).toContain('Then open http://localhost:3000');
  });

  it('existing_env_is_never_overwritten', async () => {
    const runner = new FakeRunner();
    runner.files.add('.env');
    expect(await setupLocal(runner, { demo: false })).toBe(0);
    expect(runner.copies).toEqual([]);
    expect(runner.lines).toContain('Kept your existing .env');
  });

  it('missing_docker_stops_with_the_message', async () => {
    const runner = new FakeRunner();
    runner.dockerRunning = false;
    expect(await setupLocal(runner, { demo: false })).toBe(1);
    expect(runner.lines).toContain('Docker is not running. Start Docker Desktop (macOS) or the Docker service (Linux), then run this command again.');
    expect(runner.commands).toEqual(['docker info']);
    expect(runner.copies).toEqual([]);
  });

  it('old_node_stops_with_the_link', async () => {
    const runner = new FakeRunner();
    runner.version = '24.11.0';
    expect(await setupLocal(runner, { demo: false })).toBe(1);
    expect(runner.lines).toContain('Node.js 26 or later is required. Install it from https://nodejs.org/en/download');
    expect(runner.commands).toEqual([]);
  });

  it('failed_step_stops_and_returns_1', async () => {
    const runner = new FakeRunner();
    runner.failing = 'pnpm db:up';
    expect(await setupLocal(runner, { demo: false })).toBe(1);
    expect(runner.commands).toEqual(['docker info', 'pnpm install --frozen-lockfile', 'pnpm db:up']);
    expect(runner.lines.at(-1)).toContain('Step 5 of 7 failed: starting the database');
  });

  it('demo_option_ends_with_pnpm_demo', async () => {
    const runner = new FakeRunner();
    expect(await setupLocal(runner, { demo: true })).toBe(0);
    expect(runner.commands).toEqual([...SETUP_COMMANDS, 'pnpm demo']);
    expect(runner.lines).not.toContain('Ready. Start the application with: pnpm start');
  });

  it('second_run_repeats_safely', async () => {
    const runner = new FakeRunner();
    await setupLocal(runner, { demo: false });
    const first = [...runner.commands];
    runner.commands.length = 0;
    expect(await setupLocal(runner, { demo: false })).toBe(0);
    expect(runner.commands).toEqual(first);
    expect(runner.copies).toEqual(['.env.example -> .env']);
  });
});
