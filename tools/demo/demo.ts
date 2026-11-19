import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import knex, { type Knex } from 'knex';
import { lanAddresses, readyMessage } from './addresses.ts';
import { DEFAULT_DATABASE_URL, DEMO_DIR, demoDatabaseUrl, demoPlan, type DemoOptions, type DemoStep } from './demo-plan.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const READY_TIMEOUT_MS = 120000;
const POLL_MS = 500;

type AppInfo = { demo: { profileName: string; password: string; ready: boolean } | null };

function baseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(repoRoot, '.env');
  if (existsSync(envFile)) return parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL ?? DEFAULT_DATABASE_URL;
  return DEFAULT_DATABASE_URL;
}

function readOptions(): DemoOptions {
  const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false }, check: { type: 'boolean', default: false }, port: { type: 'string', default: '3001' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid port: ${values.port}`);
  return { reset: values.reset, check: values.check, port };
}

function runPnpm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} failed with exit code ${code}`))));
  });
}

async function withAdminDatabase(action: (db: Knex) => Promise<void>): Promise<void> {
  const db = knex({ client: 'pg', connection: baseDatabaseUrl() });
  try {
    await action(db);
  } finally {
    await db.destroy();
  }
}

async function createDatabase(name: string): Promise<void> {
  await withAdminDatabase(async db => {
    const existing = await db.raw('select 1 from pg_database where datname = ?', [name]);
    if (existing.rows.length === 0) await db.raw('create database ??', [name]);
  });
}

async function dropDatabase(name: string): Promise<void> {
  await withAdminDatabase(async db => {
    await db.raw('drop database if exists ?? with (force)', [name]);
  });
}

async function migrate(databaseUrl: string): Promise<void> {
  const db = knex({ client: 'pg', connection: databaseUrl });
  try {
    await db.migrate.latest({ directory: join(repoRoot, 'apps/server/db/migrations'), loadExtensions: ['.cjs'] });
  } finally {
    await db.destroy();
  }
}

function serverLogPath(env: Record<string, string>): string {
  return join(env.DATA_DIR!, 'server.log');
}

function startServer(env: Record<string, string>): ChildProcess {
  mkdirSync(env.DATA_DIR!, { recursive: true });
  const log = createWriteStream(serverLogPath(env), { flags: 'a' });
  const server = spawn(process.execPath, [join(repoRoot, 'apps/server/dist/main.js')], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout!.pipe(log);
  server.stderr!.pipe(log);
  console.log(`Server messages go to ${serverLogPath(env)}`);
  return server;
}

function printLogTail(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n').slice(-20);
  console.error(['', `Last messages of the server (${path}):`, ...lines].join('\n'));
}

async function waitUntilReady(port: number, server: ChildProcess): Promise<AppInfo['demo']> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  server.once('exit', () => (exited = true));
  while (Date.now() < deadline) {
    if (exited) throw new Error('The demo server stopped. Read the messages above.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/app-info`);
      const info = (await response.json()) as AppInfo;
      if (info.demo?.ready) return info.demo;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`The demo was not ready after ${READY_TIMEOUT_MS / 1000} s.`);
}

async function run(step: DemoStep): Promise<ChildProcess | null> {
  switch (step.kind) {
    case 'db-up':
      console.log('Starting PostgreSQL in Docker...');
      await runPnpm(['db:up']);
      return null;
    case 'drop-database':
      console.log(`Removing the demo database ${step.name}...`);
      await dropDatabase(step.name);
      return null;
    case 'remove-dir':
      console.log(`Removing the demo files in ${step.path}...`);
      rmSync(step.path, { recursive: true, force: true });
      return null;
    case 'create-database':
      await createDatabase(step.name);
      return null;
    case 'migrate':
      console.log('Preparing the demo database...');
      await migrate(step.databaseUrl);
      return null;
    case 'build':
      console.log('Building the application. This takes about a minute the first time...');
      await runPnpm(['build']);
      return null;
    case 'start-server':
      console.log('Starting the demo server. The first start records the demo history; this takes a few seconds...');
      return startServer(step.env);
  }
}

function stop(server: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
}

async function demoFilesPresent(): Promise<boolean> {
  const db = knex({ client: 'pg', connection: demoDatabaseUrl(baseDatabaseUrl()) });
  try {
    const rows = await db<{ raw_path: string }>('captures').select('raw_path');
    return rows.every(row => existsSync(join(repoRoot, DEMO_DIR, row.raw_path)));
  } catch {
    return true;
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  const options = readOptions();
  await run({ kind: 'db-up' });
  const filesPresent = await demoFilesPresent();
  if (!filesPresent && !options.reset) console.log('The demo files of this folder do not match the demo database. The demo starts from the beginning.');
  const built = existsSync(join(repoRoot, 'apps/server/dist/main.js')) && existsSync(join(repoRoot, 'apps/web/dist/index.html'));
  const steps = demoPlan(options, { repoRoot, databaseUrl: baseDatabaseUrl(), built, demoFilesPresent: filesPresent });
  let server: ChildProcess | null = null;
  for (const step of steps.filter(step => step.kind !== 'db-up')) server = (await run(step)) ?? server;
  const serverStep = steps.find(step => step.kind === 'start-server')!;
  if (!server) throw new Error('The demo server did not start.');
  const running = server;
  try {
    const demo = (await waitUntilReady(options.port, running))!;
    console.log(readyMessage({ port: options.port, lan: lanAddresses(networkInterfaces()), profileName: demo.profileName, password: demo.password }));
  } catch (error) {
    await stop(running);
    printLogTail(serverLogPath(serverStep.env));
    throw error;
  }
  if (options.check) {
    await stop(running);
    console.log('Demo check passed.');
    return;
  }
  const shutdown = () => void stop(running).then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise(resolve => running.once('exit', resolve));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
