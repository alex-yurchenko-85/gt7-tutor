import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { needsBuild, STAMP_PATH } from './build-stamp.ts';
import { databaseName, DEMO_DATABASE, DEMO_DIR, withDatabaseName } from './database.ts';
import { changelogVersion, KEEP_LOGS, lastLines, LOG_DIR, logFileName, logHeader, logsToRemove } from './logs.ts';
import type { StartOptions } from './options.ts';
import { readyBlock } from './ready.ts';

export type ServerHandle = { stop(): Promise<void>; exited: Promise<number> };

type DemoProfile = { profileName: string; password: string };

export type StartRunner = {
  repoRoot: string;
  databaseUrl: string;
  system: { node: string; platform: string };
  print(line: string): void;
  ask(question: string): Promise<string>;
  run(command: string, args: string[], options?: { quiet?: boolean }): Promise<number>;
  exists(path: string): boolean;
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  copy(from: string, to: string): void;
  listDir(path: string): string[];
  remove(path: string): void;
  portFree(port: number): Promise<boolean>;
  database: { create(name: string): Promise<boolean>; drop(name: string): Promise<void>; migrate(name: string): Promise<void> };
  demoFilesPresent(): Promise<boolean>;
  inputHash(): string;
  startServer(env: Record<string, string>, logPath: string, header: string): ServerHandle;
  waitUntilReady(port: number, server: ServerHandle, demo: boolean): Promise<DemoProfile | null>;
  lanAddresses(): string[];
  qrRenderer(): Promise<(text: string) => string>;
  now(): Date;
  pnpm: { command: string; prefix: string[] };
};

export const RESET_QUESTION = 'Type yes to remove all GT7 Tutor data: ';
export const STOPPED = 'Stopped.';
export const ABORTED_EXIT = 130;
const DEFAULT_PORT = 3000;
const DEMO_PORT = 3001;
const LOG_TAIL = 20;

class Halt {
  readonly code: number;
  readonly lines: string[];
  constructor(code: number, lines: string[]) {
    this.code = code;
    this.lines = lines;
  }
}

function halt(code: number, ...lines: string[]): never {
  throw new Halt(code, lines);
}

function logLine(logPath: string): string {
  return `Log of this start: ${logPath}`;
}

function migrationMessage(demo: boolean): string {
  const command = demo ? './start.sh --demo --reset' : './start.sh --reset';
  return `The database cannot be updated. A database made by an old development version cannot be migrated. ${command} creates it again and removes all GT7 Tutor data.`;
}

function portMessage(port: number): string {
  return `Port ${port} is in use. Stop the other program, or start with ./start.sh --port ${port + 1}. HTTP_PORT in .env changes the port for every start.`;
}

function whenAborted(signal: AbortSignal): Promise<'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted');
  return new Promise(resolve => signal.addEventListener('abort', () => resolve('aborted'), { once: true }));
}

export async function runStart(runner: StartRunner, options: StartOptions, signal: AbortSignal): Promise<number> {
  try {
    return await startFlow(runner, options, signal);
  } catch (error) {
    if (!(error instanceof Halt)) throw error;
    for (const line of error.lines) runner.print(line);
    return error.code;
  }
}

async function startFlow(runner: StartRunner, options: StartOptions, signal: AbortSignal): Promise<number> {
  const demo = options.demo;
  const step = async <T>(work: Promise<T>): Promise<T> => {
    const value = await work;
    if (signal.aborted) halt(ABORTED_EXIT, STOPPED);
    return value;
  };
  const guarded = async (work: Promise<unknown>, message: string): Promise<void> => {
    try {
      await work;
    } catch {
      if (signal.aborted) halt(ABORTED_EXIT, STOPPED);
      halt(1, message);
    }
    if (signal.aborted) halt(ABORTED_EXIT, STOPPED);
  };

  runner.print(demo ? 'GT7 Tutor demo' : 'GT7 Tutor');
  if (options.reset && !demo) {
    const answer = await step(runner.ask(RESET_QUESTION));
    if (answer.trim() !== 'yes') halt(1, 'Nothing was removed.');
  }

  if ((await step(runner.run('docker', ['--version'], { quiet: true }))) === 127) halt(1, 'Install Docker Desktop: https://docs.docker.com/get-docker/');
  if ((await step(runner.run('docker', ['info'], { quiet: true }))) !== 0) {
    halt(1, 'Docker is not running. Start Docker Desktop (macOS) or the Docker service (Linux), then run ./start.sh again.');
  }
  runner.print('✓ Docker is running');
  if (!runner.exists('.env')) runner.copy('.env.example', '.env');

  const hash = runner.inputHash();
  const built = { stamp: runner.readText(STAMP_PATH), hash, serverBuilt: runner.exists('apps/server/dist/main.js'), webBuilt: runner.exists('apps/web/dist/index.html') };
  if (needsBuild(built)) {
    runner.print('Preparing GT7 Tutor (first start or new version), this takes a few minutes');
    const { command, prefix } = runner.pnpm;
    for (const args of [['install', '--frozen-lockfile'], ['build']]) {
      if ((await step(runner.run(command, [...prefix, ...args]))) !== 0) halt(1, 'GT7 Tutor could not be prepared. Read the messages above.');
    }
    runner.writeText(STAMP_PATH, hash);
  }

  if ((await step(runner.run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { quiet: true }))) !== 0) {
    halt(1, 'The database did not start. Start Docker again and run ./start.sh again.');
  }

  const envText = runner.readText('.env');
  const envFile = (envText === null ? {} : parseEnv(envText)) as Record<string, string>;
  const port = options.port ?? (demo ? DEMO_PORT : Number(envFile.HTTP_PORT) || DEFAULT_PORT);
  if (!(await step(runner.portFree(port)))) halt(1, portMessage(port));

  const name = demo ? DEMO_DATABASE : databaseName(runner.databaseUrl);
  const dataDir = join(runner.repoRoot, DEMO_DIR);
  if (options.reset && !demo) {
    await step(runner.database.drop(name));
    runner.print('The raw captures in data/raw stay.');
  } else if (demo) {
    let reset = options.reset;
    if (!reset && !(await step(runner.demoFilesPresent()))) {
      runner.print('The demo files of this folder do not match the demo database. The demo starts from the beginning.');
      reset = true;
    }
    if (reset) {
      await step(runner.database.drop(name));
      runner.remove(dataDir);
    }
  }
  await guarded(runner.database.create(name), migrationMessage(demo));
  await guarded(runner.database.migrate(name), migrationMessage(demo));
  runner.print('✓ Database is ready');

  for (const old of logsToRemove(runner.listDir(LOG_DIR), KEEP_LOGS - 1)) runner.remove(`${LOG_DIR}/${old}`);
  const start = runner.now();
  const logPath = `${LOG_DIR}/${logFileName(start, demo)}`;
  const header = logHeader({ start, version: changelogVersion(runner.readText('CHANGELOG.md')), buildHash: hash, node: runner.system.node, platform: runner.system.platform });
  const env: Record<string, string> = demo
    ? {
        DEMO_MODE: '1',
        TELEMETRY_SOURCE: 'replay',
        DEV_REPLAY: '0',
        HTTP_HOST: '0.0.0.0',
        HTTP_PORT: String(port),
        DATA_DIR: dataDir,
        DATABASE_URL: withDatabaseName(runner.databaseUrl, DEMO_DATABASE),
        NO_COLOR: '1'
      }
    : { ...envFile, DATABASE_URL: runner.databaseUrl, HTTP_PORT: String(port), NO_COLOR: '1' };

  const server = runner.startServer(env, logPath, header);
  const aborted = whenAborted(signal);
  const ready = await Promise.race([
    runner.waitUntilReady(port, server, demo).then(
      profile => ({ profile }),
      () => null
    ),
    aborted
  ]);
  if (ready === 'aborted' || signal.aborted) {
    await server.stop();
    halt(ABORTED_EXIT, STOPPED);
  }
  if (ready === null) {
    await server.stop();
    halt(1, 'GT7 Tutor did not start.', ...lastLines(runner.readText(logPath) ?? '', LOG_TAIL), logLine(logPath));
  }

  runner.print(readyBlock({ port, lan: runner.lanAddresses(), logPath, demo: ready.profile, qr: await runner.qrRenderer() }));
  if (options.check) {
    await server.stop();
    runner.print('Check passed.');
    return 0;
  }
  const end = await Promise.race([server.exited, aborted]);
  if (end === 'aborted') await server.stop();
  if (end === 'aborted' || end === 0) {
    runner.print(STOPPED);
    return 0;
  }
  halt(1, 'GT7 Tutor stopped with an error.', logLine(logPath));
}
