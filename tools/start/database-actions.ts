import { existsSync } from 'node:fs';
import { join } from 'node:path';
import knex, { type Knex } from 'knex';
import { adminUrl, DEMO_DATABASE, DEMO_DIR, withDatabaseName } from './database.ts';

async function withDatabase<T>(connection: string, action: (db: Knex) => Promise<T>): Promise<T> {
  const db = knex({ client: 'pg', connection });
  try {
    return await action(db);
  } finally {
    await db.destroy();
  }
}

export async function createDatabase(adminDatabaseUrl: string, name: string): Promise<boolean> {
  return withDatabase(adminDatabaseUrl, async db => {
    const existing = await db.raw('select 1 from pg_database where datname = ?', [name]);
    if (existing.rows.length > 0) return false;
    await db.raw('create database ??', [name]);
    return true;
  });
}

export async function dropDatabase(adminDatabaseUrl: string, name: string): Promise<void> {
  await withDatabase(adminDatabaseUrl, async db => {
    await db.raw('drop database if exists ?? with (force)', [name]);
  });
}

export async function migrate(databaseUrl: string, migrationsDir: string): Promise<void> {
  await withDatabase(databaseUrl, async db => {
    await db.migrate.latest({ directory: migrationsDir, loadExtensions: ['.cjs'] });
  });
}

async function databaseExists(databaseUrl: string, name: string): Promise<boolean> {
  return withDatabase(adminUrl(databaseUrl), async db => {
    const found = await db.raw('select 1 from pg_database where datname = ?', [name]);
    return found.rows.length > 0;
  });
}

export async function demoFilesPresent(databaseUrl: string, repoRoot: string): Promise<boolean> {
  try {
    if (!(await databaseExists(databaseUrl, DEMO_DATABASE))) return true;
  } catch {
    return true;
  }
  try {
    return await withDatabase(withDatabaseName(databaseUrl, DEMO_DATABASE), async db => {
      const rows = await db<{ raw_path: string }>('captures').select('raw_path');
      return rows.every(row => existsSync(join(repoRoot, DEMO_DIR, row.raw_path)));
    });
  } catch {
    return true;
  }
}
