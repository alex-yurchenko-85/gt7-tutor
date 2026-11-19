import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import knex from 'knex';
import { DEFAULT_DATABASE_URL, type DemoStep } from '../demo/demo-plan.ts';

export type DbResetStep = Extract<DemoStep, { kind: 'drop-database' | 'create-database' | 'migrate' }>;

export function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

export function dbResetPlan(databaseUrl: string): DbResetStep[] {
  const name = databaseName(databaseUrl);
  return [{ kind: 'drop-database', name }, { kind: 'create-database', name }, { kind: 'migrate', databaseUrl }];
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function configuredDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(repoRoot, '.env');
  if (existsSync(envFile)) return parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL ?? DEFAULT_DATABASE_URL;
  return DEFAULT_DATABASE_URL;
}

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

async function runStep(step: DbResetStep, databaseUrl: string): Promise<void> {
  if (step.kind === 'migrate') {
    const db = knex({ client: 'pg', connection: step.databaseUrl });
    try {
      await db.migrate.latest({ directory: join(repoRoot, 'apps/server/db/migrations'), loadExtensions: ['.cjs'] });
    } finally {
      await db.destroy();
    }
    return;
  }
  const admin = knex({ client: 'pg', connection: adminUrl(databaseUrl) });
  try {
    if (step.kind === 'drop-database') await admin.raw('drop database if exists ?? with (force)', [step.name]);
    else await admin.raw('create database ??', [step.name]);
  } finally {
    await admin.destroy();
  }
}

async function dbUp(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['db:up'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`pnpm db:up failed with exit code ${code}`))));
  });
}

async function main(): Promise<void> {
  const databaseUrl = configuredDatabaseUrl();
  await dbUp();
  for (const step of dbResetPlan(databaseUrl)) {
    console.log(`${step.kind} ${step.kind === 'migrate' ? '' : step.name}`.trim());
    await runStep(step, databaseUrl);
  }
  console.log('The database is ready.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
