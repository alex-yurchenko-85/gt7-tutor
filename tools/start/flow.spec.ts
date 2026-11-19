import { describe, expect, it } from 'vitest';
import { STAMP_PATH } from './build-stamp.ts';
import { runStart, type ServerHandle, type StartRunner } from './flow.ts';
import type { StartOptions } from './options.ts';
import { readyBlock } from './ready.ts';

const HASH = 'a'.repeat(64);
const fakeQr = (text: string): string => `QR ${text}`;
const START = new Date(2026, 10, 19, 12, 4, 31);
const LOG_PATH = 'data/logs/2026-11-19_12-04-31.log';
const DEMO_LOG_PATH = 'data/logs/2026-11-19_12-04-31-demo.log';
const DATABASE_URL = 'postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor';
const MIGRATION_MESSAGE = 'The database cannot be updated. A database made by an old development version cannot be migrated. ./start.sh --reset creates it again and removes all GT7 Tutor data.';
const DEMO_MIGRATION_MESSAGE = 'The database cannot be updated. A database made by an old development version cannot be migrated. ./start.sh --demo --reset creates it again and removes all GT7 Tutor data.';

type Fake = {
  runner: StartRunner;
  calls: string[];
  lines: string[];
  files: Map<string, string>;
  envs: Record<string, string>[];
  headers: string[];
  finish(code: number): void;
};

type Overrides = {
  runCodes?: Record<string, number>;
  onRun?: (command: string, args: string[]) => void;
  files?: Record<string, string>;
  answer?: string;
  portFree?: boolean;
  logs?: string[];
  ready?: 'ok' | 'fail';
  demoProfile?: { profileName: string; password: string } | null;
  createFails?: boolean;
  migrateFails?: boolean;
  demoFilesPresent?: boolean;
  pnpm?: { command: string; prefix: string[] };
  exitAfterReady?: number;
};

function fakeRunner(overrides: Overrides = {}): Fake {
  const calls: string[] = [];
  const lines: string[] = [];
  const envs: Record<string, string>[] = [];
  const headers: string[] = [];
  const files = new Map<string, string>(
    Object.entries({
      [STAMP_PATH]: HASH,
      'apps/server/dist/main.js': '',
      'apps/web/dist/index.html': '',
      '.env': 'HTTP_PORT=3000\nDATA_DIR=./data\n',
      '.env.example': 'HTTP_PORT=3000\n',
      'CHANGELOG.md': '## [1.3.1] (2026-11-18)\n',
      ...overrides.files
    })
  );
  let finish: (code: number) => void = () => {};
  const runner: StartRunner = {
    repoRoot: '/repo',
    databaseUrl: DATABASE_URL,
    system: { node: 'v26.1.0', platform: 'darwin arm64' },
    pnpm: overrides.pnpm ?? { command: 'pnpm', prefix: [] },
    print: line => {
      lines.push(line);
    },
    ask: async question => {
      calls.push(`ask ${question}`);
      return overrides.answer ?? '';
    },
    run: async (command, args, options) => {
      const text = [command, ...args].join(' ');
      calls.push(`run ${text}${options?.quiet ? ' (quiet)' : ''}`);
      overrides.onRun?.(command, args);
      return overrides.runCodes?.[text] ?? 0;
    },
    exists: path => files.has(path),
    readText: path => files.get(path) ?? null,
    writeText: (path, text) => {
      calls.push(`write ${path}`);
      files.set(path, text);
    },
    copy: (from, to) => {
      calls.push(`copy ${from} ${to}`);
      files.set(to, files.get(from) ?? '');
    },
    listDir: path => {
      calls.push(`list ${path}`);
      return overrides.logs ?? [];
    },
    remove: path => {
      calls.push(`remove ${path}`);
    },
    portFree: async port => {
      calls.push(`port ${port}`);
      return overrides.portFree ?? true;
    },
    database: {
      create: async name => {
        calls.push(`create ${name}`);
        if (overrides.createFails) throw new Error('create failed');
        return true;
      },
      drop: async name => {
        calls.push(`drop ${name}`);
      },
      migrate: async name => {
        calls.push(`migrate ${name}`);
        if (overrides.migrateFails) throw new Error('migration failed');
      }
    },
    demoFilesPresent: async () => {
      calls.push('demo files');
      return overrides.demoFilesPresent ?? true;
    },
    inputHash: () => {
      calls.push('hash');
      return HASH;
    },
    startServer: (env, logPath, header) => {
      calls.push(`start ${logPath}`);
      envs.push(env);
      headers.push(header);
      const exited = new Promise<number>(resolve => {
        finish = resolve;
      });
      const handle: ServerHandle = {
        stop: async () => {
          calls.push('stop');
          finish(0);
        },
        exited
      };
      return handle;
    },
    waitUntilReady: async (port, _server, demo) => {
      calls.push(`wait ${port} ${demo}`);
      if (overrides.ready === 'fail') throw new Error('timeout');
      if (overrides.exitAfterReady !== undefined) finish(overrides.exitAfterReady);
      return demo ? (overrides.demoProfile ?? { profileName: 'demo', password: 'demodemo' }) : null;
    },
    lanAddresses: () => ['192.0.2.10'],
    qrRenderer: async () => fakeQr,
    now: () => START
  };
  return { runner, calls, lines, files, envs, headers, finish: code => finish(code) };
}

function options(overrides: Partial<StartOptions> = {}): StartOptions {
  return { demo: false, reset: false, check: true, port: null, ...overrides };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('runStart', () => {
  it('first_start_installs_builds_and_writes_the_stamp', async () => {
    const fake = fakeRunner();
    fake.files.delete(STAMP_PATH);
    expect(await runStart(fake.runner, options(), signal())).toBe(0);
    expect(fake.lines).toContain('Preparing GT7 Tutor (first start or new version), this takes a few minutes');
    const install = fake.calls.indexOf('run pnpm install --frozen-lockfile');
    const build = fake.calls.indexOf('run pnpm build');
    const write = fake.calls.indexOf(`write ${STAMP_PATH}`);
    expect(install).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(install);
    expect(write).toBeGreaterThan(build);
    expect(fake.files.get(STAMP_PATH)).toBe(HASH);
    expect(fake.calls.filter(call => call === 'hash')).toHaveLength(1);
  });

  it('second_start_skips_the_build', async () => {
    const fake = fakeRunner();
    expect(await runStart(fake.runner, options(), signal())).toBe(0);
    expect(fake.calls.some(call => call.startsWith('run pnpm'))).toBe(false);
    expect(fake.calls).not.toContain(`write ${STAMP_PATH}`);
    expect(fake.lines).not.toContain('Preparing GT7 Tutor (first start or new version), this takes a few minutes');
  });

  it('runs_the_steps_in_order_and_prints_the_ready_block', async () => {
    const fake = fakeRunner();
    expect(await runStart(fake.runner, options(), signal())).toBe(0);
    expect(fake.calls).toEqual([
      'run docker --version (quiet)',
      'run docker info (quiet)',
      'hash',
      'run docker compose up -d --wait postgres (quiet)',
      'port 3000',
      'create gt7_tutor',
      'migrate gt7_tutor',
      'list data/logs',
      `start ${LOG_PATH}`,
      'wait 3000 false',
      'stop'
    ]);
    expect(fake.lines).toEqual([
      'GT7 Tutor',
      '✓ Docker is running',
      '✓ Database is ready',
      readyBlock({ port: 3000, lan: ['192.0.2.10'], logPath: LOG_PATH, demo: null, qr: fakeQr }),
      'Check passed.'
    ]);
    expect(fake.headers).toEqual([`GT7 Tutor 1.3.1 · build ${HASH.slice(0, 12)} · Node v26.1.0 · darwin arm64 · started ${START.toISOString()}`]);
    expect(fake.envs).toEqual([{ HTTP_PORT: '3000', DATA_DIR: './data', DATABASE_URL, NO_COLOR: '1' }]);
  });

  it('copies_the_env_example_when_the_env_file_is_missing', async () => {
    const fake = fakeRunner();
    fake.files.delete('.env');
    expect(await runStart(fake.runner, options(), signal())).toBe(0);
    expect(fake.calls).toContain('copy .env.example .env');
  });

  it('keeps_the_env_file_when_present', async () => {
    const fake = fakeRunner();
    await runStart(fake.runner, options(), signal());
    expect(fake.calls.some(call => call.startsWith('copy'))).toBe(false);
  });

  it('missing_docker_names_the_installer', async () => {
    const fake = fakeRunner({ runCodes: { 'docker --version': 127 } });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines).toEqual(['GT7 Tutor', 'Install Docker Desktop: https://docs.docker.com/get-docker/']);
    expect(fake.calls).toEqual(['run docker --version (quiet)']);
  });

  it('stopped_docker_says_start_docker', async () => {
    const fake = fakeRunner({ runCodes: { 'docker info': 1 } });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe('Docker is not running. Start Docker Desktop (macOS) or the Docker service (Linux), then run ./start.sh again.');
    expect(fake.lines).not.toContain('✓ Docker is running');
  });

  it('database_container_failure_says_start_docker_again', async () => {
    const fake = fakeRunner({ runCodes: { 'docker compose up -d --wait postgres': 1 } });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe('The database did not start. Start Docker again and run ./start.sh again.');
    expect(fake.calls.some(call => call.startsWith('create'))).toBe(false);
  });

  it('prepare_failure_stops_without_the_stamp', async () => {
    const fake = fakeRunner({ runCodes: { 'pnpm build': 1 } });
    fake.files.delete(STAMP_PATH);
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe('GT7 Tutor could not be prepared. Read the messages above.');
    expect(fake.files.has(STAMP_PATH)).toBe(false);
    expect(fake.calls.some(call => call.includes('compose'))).toBe(false);
  });

  it('install_failure_stops_before_the_build', async () => {
    const fake = fakeRunner({ runCodes: { 'pnpm install --frozen-lockfile': 1 } });
    fake.files.delete('apps/web/dist/index.html');
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe('GT7 Tutor could not be prepared. Read the messages above.');
    expect(fake.calls).not.toContain('run pnpm build');
  });

  it('migration_failure_names_reset', async () => {
    const fake = fakeRunner({ migrateFails: true });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe(MIGRATION_MESSAGE);
    expect(fake.lines).not.toContain('✓ Database is ready');
  });

  it('create_failure_names_reset', async () => {
    const fake = fakeRunner({ createFails: true });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe(MIGRATION_MESSAGE);
    expect(fake.calls.some(call => call.startsWith('migrate'))).toBe(false);
  });

  it('demo_migration_failure_names_demo_reset', async () => {
    const fake = fakeRunner({ migrateFails: true });
    expect(await runStart(fake.runner, options({ demo: true }), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe(DEMO_MIGRATION_MESSAGE);
  });

  it('port_in_use_stops_with_the_port_message', async () => {
    const fake = fakeRunner({ portFree: false });
    expect(await runStart(fake.runner, options({ port: 4000 }), signal())).toBe(1);
    expect(fake.lines.at(-1)).toBe('Port 4000 is in use. Stop the other program, or start with ./start.sh --port 4001. HTTP_PORT in .env changes the port for every start.');
    expect(fake.calls.some(call => call.startsWith('start'))).toBe(false);
  });

  it('uses_the_port_of_the_env_file', async () => {
    const fake = fakeRunner({ files: { '.env': 'HTTP_PORT=3500\n' } });
    await runStart(fake.runner, options(), signal());
    expect(fake.calls).toContain('port 3500');
    expect(fake.envs[0]!.HTTP_PORT).toBe('3500');
  });

  it('uses_port_3000_without_a_port_in_the_env_file', async () => {
    const fake = fakeRunner({ files: { '.env': 'DATA_DIR=./data\n' } });
    await runStart(fake.runner, options(), signal());
    expect(fake.calls).toContain('port 3000');
  });

  it('reset_question_comes_first', async () => {
    const fake = fakeRunner({ answer: 'yes' });
    await runStart(fake.runner, options({ reset: true }), signal());
    expect(fake.calls[0]).toBe('ask Type yes to remove all GT7 Tutor data: ');
    expect(fake.lines[0]).toBe('GT7 Tutor');
  });

  it('reset_without_yes_removes_nothing', async () => {
    const fake = fakeRunner({ answer: 'no' });
    expect(await runStart(fake.runner, options({ reset: true }), signal())).toBe(1);
    expect(fake.calls).toEqual(['ask Type yes to remove all GT7 Tutor data: ']);
    expect(fake.lines).toEqual(['GT7 Tutor', 'Nothing was removed.']);
  });

  it('reset_with_yes_drops_the_database', async () => {
    const fake = fakeRunner({ answer: ' yes\n' });
    expect(await runStart(fake.runner, options({ reset: true }), signal())).toBe(0);
    const compose = fake.calls.indexOf('run docker compose up -d --wait postgres (quiet)');
    const drop = fake.calls.indexOf('drop gt7_tutor');
    expect(drop).toBeGreaterThan(compose);
    expect(fake.calls.indexOf('create gt7_tutor')).toBeGreaterThan(drop);
    expect(fake.lines).toContain('The raw captures in data/raw stay.');
    expect(fake.calls.some(call => call.startsWith('remove'))).toBe(false);
  });

  it('demo_uses_its_database_port_and_folder', async () => {
    const fake = fakeRunner();
    expect(await runStart(fake.runner, options({ demo: true }), signal())).toBe(0);
    expect(fake.lines[0]).toBe('GT7 Tutor demo');
    expect(fake.calls).toContain('demo files');
    expect(fake.calls).toContain('create gt7_demo');
    expect(fake.calls).toContain('migrate gt7_demo');
    expect(fake.calls).toContain('port 3001');
    expect(fake.calls).toContain(`start ${DEMO_LOG_PATH}`);
    expect(fake.calls).toContain('wait 3001 true');
    expect(fake.calls.some(call => call.startsWith('drop'))).toBe(false);
    expect(fake.envs).toEqual([
      {
        DEMO_MODE: '1',
        TELEMETRY_SOURCE: 'replay',
        DEV_REPLAY: '0',
        HTTP_HOST: '0.0.0.0',
        HTTP_PORT: '3001',
        DATA_DIR: '/repo/.demo',
        DATABASE_URL: 'postgres://gt7:gt7@127.0.0.1:5432/gt7_demo',
        NO_COLOR: '1'
      }
    ]);
    expect(fake.lines).toContain(readyBlock({ port: 3001, lan: ['192.0.2.10'], logPath: DEMO_LOG_PATH, demo: { profileName: 'demo', password: 'demodemo' }, qr: fakeQr }));
  });

  it('demo_reset_drops_the_demo_database_and_folder_without_a_question', async () => {
    const fake = fakeRunner();
    expect(await runStart(fake.runner, options({ demo: true, reset: true, port: 3005 }), signal())).toBe(0);
    expect(fake.calls.some(call => call.startsWith('ask'))).toBe(false);
    expect(fake.calls).not.toContain('demo files');
    const drop = fake.calls.indexOf('drop gt7_demo');
    expect(drop).toBeGreaterThan(-1);
    expect(fake.calls[drop + 1]).toBe('remove /repo/.demo');
    expect(fake.calls).toContain('port 3005');
  });

  it('demo_files_mismatch_resets_the_demo', async () => {
    const fake = fakeRunner({ demoFilesPresent: false });
    expect(await runStart(fake.runner, options({ demo: true }), signal())).toBe(0);
    expect(fake.lines).toContain('The demo files of this folder do not match the demo database. The demo starts from the beginning.');
    const files = fake.calls.indexOf('demo files');
    expect(fake.calls.slice(files + 1, files + 3)).toEqual(['drop gt7_demo', 'remove /repo/.demo']);
  });

  it('check_stops_the_server_and_passes', async () => {
    const fake = fakeRunner();
    expect(await runStart(fake.runner, options({ check: true }), signal())).toBe(0);
    expect(fake.calls.at(-1)).toBe('stop');
    expect(fake.lines.at(-1)).toBe('Check passed.');
  });

  it('server_exit_prints_the_last_20_lines_and_the_log_path', async () => {
    const log = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    const fake = fakeRunner({ ready: 'fail', files: { [LOG_PATH]: log } });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.calls.at(-1)).toBe('stop');
    const failed = fake.lines.indexOf('GT7 Tutor did not start.');
    expect(fake.lines.slice(failed + 1)).toEqual([...Array.from({ length: 20 }, (_, index) => `line ${index + 11}`), `Log of this start: ${LOG_PATH}`]);
  });

  it('server_failure_without_a_log_prints_the_log_path', async () => {
    const fake = fakeRunner({ ready: 'fail' });
    expect(await runStart(fake.runner, options(), signal())).toBe(1);
    expect(fake.lines.slice(-2)).toEqual(['GT7 Tutor did not start.', `Log of this start: ${LOG_PATH}`]);
  });

  it('stop_before_the_server_starts_exits_without_a_server', async () => {
    const controller = new AbortController();
    const fake = fakeRunner({ runCodes: { 'pnpm build': 130 }, onRun: (_command, args) => args.includes('build') && controller.abort() });
    fake.files.delete(STAMP_PATH);
    expect(await runStart(fake.runner, options(), controller.signal)).toBe(130);
    expect(fake.calls.some(call => call.startsWith('start'))).toBe(false);
    expect(fake.files.has(STAMP_PATH)).toBe(false);
    expect(fake.lines.at(-1)).toBe('Stopped.');
    expect(fake.lines).not.toContain('GT7 Tutor could not be prepared. Read the messages above.');
  });

  it('stop_during_the_reset_question_exits_without_docker', async () => {
    const controller = new AbortController();
    const fake = fakeRunner({ answer: 'yes' });
    const ask = fake.runner.ask;
    fake.runner.ask = async question => {
      controller.abort();
      return ask(question);
    };
    expect(await runStart(fake.runner, options({ reset: true }), controller.signal)).toBe(130);
    expect(fake.calls).toEqual(['ask Type yes to remove all GT7 Tutor data: ']);
    expect(fake.lines).toEqual(['GT7 Tutor', 'Stopped.']);
  });

  it('stop_during_the_wait_stops_the_server', async () => {
    const controller = new AbortController();
    const fake = fakeRunner();
    fake.runner.waitUntilReady = (port, _server, demo) => {
      fake.calls.push(`wait ${port} ${demo}`);
      controller.abort();
      return new Promise(() => {});
    };
    expect(await runStart(fake.runner, options(), controller.signal)).toBe(130);
    expect(fake.calls.at(-1)).toBe('stop');
    expect(fake.lines.at(-1)).toBe('Stopped.');
  });

  it('stop_during_the_migration_exits_without_a_server', async () => {
    const controller = new AbortController();
    const fake = fakeRunner();
    fake.runner.database.migrate = async name => {
      fake.calls.push(`migrate ${name}`);
      controller.abort();
      throw new Error('terminated');
    };
    expect(await runStart(fake.runner, options(), controller.signal)).toBe(130);
    expect(fake.calls.some(call => call.startsWith('start'))).toBe(false);
    expect(fake.lines.at(-1)).toBe('Stopped.');
    expect(fake.lines).not.toContain(MIGRATION_MESSAGE);
  });

  it('stop_during_the_create_skips_the_migration', async () => {
    const controller = new AbortController();
    const fake = fakeRunner();
    fake.runner.database.create = async name => {
      fake.calls.push(`create ${name}`);
      controller.abort();
      return true;
    };
    expect(await runStart(fake.runner, options(), controller.signal)).toBe(130);
    expect(fake.calls.at(-1)).toBe('create gt7_tutor');
    expect(fake.calls.some(call => call.startsWith('migrate'))).toBe(false);
    expect(fake.lines.at(-1)).toBe('Stopped.');
  });

  it('port_in_use_with_reset_keeps_the_database', async () => {
    const fake = fakeRunner({ answer: 'yes', portFree: false });
    expect(await runStart(fake.runner, options({ reset: true }), signal())).toBe(1);
    expect(fake.calls.some(call => call.startsWith('drop'))).toBe(false);
    expect(fake.lines.at(-1)).toBe(
      'Port 3000 is in use. Stop the other program, or start with ./start.sh --port 3001. HTTP_PORT in .env changes the port for every start.'
    );
  });

  it('port_in_use_with_demo_reset_keeps_the_demo_data', async () => {
    const fake = fakeRunner({ portFree: false, demoFilesPresent: false });
    expect(await runStart(fake.runner, options({ demo: true, reset: true }), signal())).toBe(1);
    expect(fake.calls.some(call => call.startsWith('drop') || call.startsWith('remove') || call === 'demo files')).toBe(false);
    expect(fake.calls.at(-1)).toBe('port 3001');
  });

  it('stop_while_the_wait_fails_prints_stopped', async () => {
    const controller = new AbortController();
    const fake = fakeRunner({ ready: 'fail' });
    const startServer = fake.runner.startServer;
    fake.runner.startServer = (env, logPath, header) => {
      controller.abort();
      return startServer(env, logPath, header);
    };
    expect(await runStart(fake.runner, options(), controller.signal)).toBe(130);
    expect(fake.calls.at(-1)).toBe('stop');
    expect(fake.lines.at(-1)).toBe('Stopped.');
    expect(fake.lines).not.toContain('GT7 Tutor did not start.');
  });

  it('pnpm_comes_from_npx_when_missing', async () => {
    const fake = fakeRunner({ pnpm: { command: 'npx', prefix: ['--yes', 'pnpm@12.21.0'] } });
    fake.files.delete('apps/server/dist/main.js');
    expect(await runStart(fake.runner, options(), signal())).toBe(0);
    expect(fake.calls).toContain('run npx --yes pnpm@12.21.0 install --frozen-lockfile');
    expect(fake.calls).toContain('run npx --yes pnpm@12.21.0 build');
    expect(fake.calls.some(call => call.startsWith('run pnpm'))).toBe(false);
  });

  it('old_logs_are_removed_keeping_ten', async () => {
    const logs = Array.from({ length: 12 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}_10-00-00.log`);
    const fake = fakeRunner({ logs: [...logs, 'notes.txt'] });
    await runStart(fake.runner, options(), signal());
    const removed = fake.calls.filter(call => call.startsWith('remove'));
    expect(removed).toEqual(['remove data/logs/2026-11-01_10-00-00.log', 'remove data/logs/2026-11-02_10-00-00.log', 'remove data/logs/2026-11-03_10-00-00.log']);
    expect(fake.calls.indexOf(removed.at(-1)!)).toBeLessThan(fake.calls.indexOf(`start ${LOG_PATH}`));
  });

  it('ctrl_c_after_the_start_stops_the_server', async () => {
    const controller = new AbortController();
    const fake = fakeRunner();
    const done = runStart(fake.runner, options({ check: false }), controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    expect(await done).toBe(0);
    expect(fake.calls.at(-1)).toBe('stop');
    expect(fake.lines.at(-1)).toBe('Stopped.');
  });

  it('server_exit_without_error_prints_stopped', async () => {
    const fake = fakeRunner({ exitAfterReady: 0 });
    expect(await runStart(fake.runner, options({ check: false }), signal())).toBe(0);
    expect(fake.lines.at(-1)).toBe('Stopped.');
  });

  it('server_error_exit_names_the_log', async () => {
    const fake = fakeRunner({ exitAfterReady: 1 });
    expect(await runStart(fake.runner, options({ check: false }), signal())).toBe(1);
    expect(fake.lines.slice(-2)).toEqual(['GT7 Tutor stopped with an error.', `Log of this start: ${LOG_PATH}`]);
  });
});
