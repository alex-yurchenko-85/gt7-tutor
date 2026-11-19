import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabase, dropDatabase, migrate } from '../start/database-actions.ts';
import { adminUrl, configuredDatabaseUrl, databaseName } from '../start/database.ts';

export type DbResetStep =
  | { kind: 'drop-database'; name: string }
  | { kind: 'create-database'; name: string }
  | { kind: 'migrate'; databaseUrl: string };

export function dbResetPlan(databaseUrl: string): DbResetStep[] {
  const name = databaseName(databaseUrl);
  return [{ kind: 'drop-database', name }, { kind: 'create-database', name }, { kind: 'migrate', databaseUrl }];
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const migrationsDir = join(repoRoot, 'apps/server/db/migrations');

async function runStep(step: DbResetStep, databaseUrl: string): Promise<void> {
  if (step.kind === 'migrate') await migrate(step.databaseUrl, migrationsDir);
  else if (step.kind === 'drop-database') await dropDatabase(adminUrl(databaseUrl), step.name);
  else await createDatabase(adminUrl(databaseUrl), step.name);
}

async function dbUp(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['db:up'], { cwd: repoRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`pnpm db:up failed with exit code ${code}`))));
  });
}

async function main(): Promise<void> {
  const envFile = join(repoRoot, '.env');
  const databaseUrl = configuredDatabaseUrl(process.env, existsSync(envFile) ? readFileSync(envFile, 'utf8') : null);
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
