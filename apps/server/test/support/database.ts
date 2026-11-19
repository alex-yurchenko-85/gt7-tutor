import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATABASE_URL } from '../../../../tools/demo/demo-plan.js';
import knex, { type Knex } from 'knex';

export const migrationsDirectory = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export function adminDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function migrationConfig(): Knex.MigratorConfig {
  return { directory: migrationsDirectory, loadExtensions: ['.cjs'] };
}

export type DisposableDatabase = { url: string; drop(): Promise<void> };

export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const name = `gt7_test_${randomBytes(6).toString('hex')}`;
  const admin = knex({ client: 'pg', connection: adminDatabaseUrl() });
  await admin.raw('create database ??', [name]);
  await admin.destroy();
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const cleanup = knex({ client: 'pg', connection: adminDatabaseUrl() });
      await cleanup.raw('drop database if exists ?? with (force)', [name]);
      await cleanup.destroy();
    }
  };
}

export async function createMigratedDatabase(): Promise<DisposableDatabase> {
  const database = await createDisposableDatabase();
  const db = knex({ client: 'pg', connection: database.url });
  await db.migrate.latest(migrationConfig());
  await db.destroy();
  return database;
}
