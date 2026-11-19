import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { parseAppConfig } from '../src/config/app-config.js';
import { KNEX } from '../src/storage/knex.provider.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { testTempDir } from '../../../tools/testing/temp-root.js';

describe('AppModule', () => {
  let database: DisposableDatabase;

  beforeAll(async () => {
    database = await createMigratedDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('app_module_uses_given_config_without_environment', async () => {
    const before = process.env.DATABASE_URL;
    const config = parseAppConfig({ DATABASE_URL: database.url, DATA_DIR: testTempDir('gt7-server-') });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const db = app.get<Knex>(KNEX);
    const row = await db.raw<{ rows: { name: string }[] }>('select current_database() as name');
    expect(row.rows[0]!.name).toBe(new URL(database.url).pathname.slice(1));
    await app.close();
    expect(process.env.DATABASE_URL).toBe(before);
  });
});
