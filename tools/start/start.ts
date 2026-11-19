import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildInputs, inputHash } from './build-stamp.ts';
import { adminUrl, configuredDatabaseUrl, withDatabaseName } from './database.ts';
import { ABORTED_EXIT, runStart, type ServerHandle, type StartRunner } from './flow.ts';
import { parseStartOptions, type StartOptions } from './options.ts';
import { lanAddresses, pnpmCommand } from './ready.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const READY_TIMEOUT_MS = 120000;
const POLL_MS = 500;
const REQUEST_TIMEOUT_MS = 2000;
const KILL_AFTER_MS = 10000;

type AppInfo = { demo: { profileName: string; password: string; ready: boolean } | null };

let liveServer: ChildProcess | null = null;

function at(path: string): string {
  return resolve(repoRoot, path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function run(command: string, args: string[], options: { quiet?: boolean } = {}): Promise<number> {
  return new Promise(done => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: options.quiet ? 'ignore' : 'inherit' });
    child.once('error', error => done((error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1));
    child.once('exit', code => done(code ?? 1));
  });
}

function readText(path: string): string | null {
  try {
    return readFileSync(at(path), 'utf8');
  } catch {
    return null;
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(at(path)), { recursive: true });
  writeFileSync(at(path), text);
}

function listDir(path: string): string[] {
  try {
    return readdirSync(at(path));
  } catch {
    return [];
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise(done => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => server.close(() => done(true)));
  });
}

async function ask(question: string, onSignal: () => void, signal: AbortSignal): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', onSignal);
  try {
    return await new Promise<string>(done => {
      rl.once('close', () => done(''));
      rl.question(question, { signal }).then(done, () => done(''));
    });
  } finally {
    rl.close();
  }
}

function startServer(env: Record<string, string>, logPath: string, header: string): ServerHandle {
  const file = at(logPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${header}\n`);
  const fd = openSync(file, 'a');
  const child = spawn(process.execPath, [join(repoRoot, 'apps/server/dist/main.js')], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd]
  });
  closeSync(fd);
  liveServer = child;
  let stopping = false;
  const exited = new Promise<number>(done => {
    child.once('error', () => done(1));
    child.once('exit', code => {
      if (liveServer === child) liveServer = null;
      done(code ?? (stopping ? 0 : 1));
    });
  });
  let stopped: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        stopping = true;
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
        await exited;
        clearTimeout(timer);
      }
      await exited;
    })();
    return stopped;
  };
  return { stop, exited };
}

async function waitUntilReady(port: number, server: ServerHandle, demo: boolean): Promise<{ profileName: string; password: string } | null> {
  let gone = false;
  void server.exited.then(() => {
    gone = true;
  });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (gone) throw new Error('The server stopped before it was ready.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/app-info`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) {
        if (!demo) {
          await response.body?.cancel();
          return null;
        }
        const info = (await response.json()) as AppInfo;
        if (info.demo?.ready) return { profileName: info.demo.profileName, password: info.demo.password };
      } else await response.body?.cancel();
    } catch {}
    await delay(POLL_MS);
  }
  throw new Error(`The server was not ready after ${READY_TIMEOUT_MS / 1000} s.`);
}

function databaseActions(): Promise<typeof import('./database-actions.ts')> {
  return import('./database-actions.ts');
}

async function createRunner(onSignal: () => void, signal: AbortSignal): Promise<StartRunner> {
  const databaseUrl = configuredDatabaseUrl(process.env, readText('.env'));
  const packageJson = JSON.parse(readText('package.json') ?? '{}') as { packageManager?: string };
  const pnpmOnPath = (await run('pnpm', ['--version'], { quiet: true })) === 0;
  return {
    repoRoot,
    databaseUrl,
    system: { node: process.version, platform: `${process.platform} ${process.arch}` },
    print: line => console.log(line),
    ask: question => ask(question, onSignal, signal),
    run,
    exists: path => existsSync(at(path)),
    readText,
    writeText,
    copy: (from, to) => copyFileSync(at(from), at(to)),
    listDir,
    remove: path => rmSync(at(path), { recursive: true, force: true }),
    portFree,
    database: {
      create: async name => (await databaseActions()).createDatabase(adminUrl(databaseUrl), name),
      drop: async name => (await databaseActions()).dropDatabase(adminUrl(databaseUrl), name),
      migrate: async name => (await databaseActions()).migrate(withDatabaseName(databaseUrl, name), join(repoRoot, 'apps/server/db/migrations'))
    },
    demoFilesPresent: async () => (await databaseActions()).demoFilesPresent(databaseUrl, repoRoot),
    inputHash: () => inputHash(repoRoot, buildInputs(repoRoot)),
    startServer,
    waitUntilReady,
    lanAddresses: () => lanAddresses(networkInterfaces()),
    qrRenderer: async () => (await import('uqr')).renderUnicodeCompact,
    now: () => new Date(),
    pnpm: pnpmCommand({ pnpmOnPath, packageManager: packageJson.packageManager ?? '' })
  };
}

async function main(): Promise<number> {
  let options: StartOptions;
  try {
    options = parseStartOptions(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    return 2;
  }
  const controller = new AbortController();
  const onSignal = (): void => {
    if (controller.signal.aborted) {
      liveServer?.kill('SIGKILL');
      process.exit(ABORTED_EXIT);
    }
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const runner = await createRunner(onSignal, controller.signal);
    return await runStart(runner, options, controller.signal);
  } catch (error) {
    console.error(`GT7 Tutor stopped because of an unexpected error: ${errorMessage(error)}`);
    return 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

process.exitCode = await main();
