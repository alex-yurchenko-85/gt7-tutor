import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import knex, { type Knex } from 'knex';
import { ConfigModule } from '@nestjs/config';
import { KNEX } from '../src/storage/knex.provider.js';
import { StorageModule } from '../src/storage/storage.module.js';
import { createDisposableDatabase, createMigratedDatabase, migrationConfig, type DisposableDatabase } from './support/database.js';

const applicationTables = ['users', 'sessions', 'settings', 'catalogue_entries', 'exercises', 'captures', 'references', 'attempts', 'cue_events', 'attempt_findings'];

async function tableNames(db: Knex): Promise<string[]> {
  const result = await db.raw<{ rows: { table_name: string }[] }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name not like 'knex_%'"
  );
  return result.rows.map(row => row.table_name).sort();
}

describe('database schema', () => {
  it('migration_up_down_up', async () => {
    const database = await createDisposableDatabase();
    const db = knex({ client: 'pg', connection: database.url });
    try {
      await db.migrate.latest(migrationConfig());
      expect(await tableNames(db)).toEqual([...applicationTables].sort());
      await db.migrate.rollback(migrationConfig(), true);
      expect(await tableNames(db)).toEqual([]);
      await db.migrate.latest(migrationConfig());
      expect(await tableNames(db)).toEqual([...applicationTables].sort());
    } finally {
      await db.destroy();
      await database.drop();
    }
  });

  describe('constraints', () => {
    let database: DisposableDatabase;
    let db: Knex;

    beforeAll(async () => {
      database = await createMigratedDatabase();
      db = knex({ client: 'pg', connection: database.url });
    });

    afterAll(async () => {
      await db.destroy();
      await database.drop();
    });

    it('catalogue_entries_have_no_support_column', async () => {
      expect(await db.schema.hasColumn('catalogue_entries', 'support')).toBe(false);
    });

    it('references_restrict_delete', async () => {
      const [user] = await db('users').insert({ name: 'driver', password_hash: 'x' }).returning('id');
      const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Brand Experience', name: 'Yangwang' }).returning('id');
      const [capture] = await db('captures')
        .insert({ user_id: user.id, exercise_id: exercise.id, purpose: 'demo', raw_path: 'raw/a.ndjson', started_at: db.fn.now() })
        .returning('id');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 352, last_raw_index: 1897, origin: 'demo', start_kind: 'flying' })
        .returning('id');
      await db('attempts').insert({
        exercise_id: exercise.id,
        capture_id: capture.id,
        reference_id: reference.id,
        first_raw_index: 1162,
        last_raw_index: 2786,
        mode: 'baseline',
        completion: 'complete',
        started_at: db.fn.now()
      });
      const deletion = await db('references').where({ id: reference.id }).delete().then(() => null, (error: { code: string }) => error);
      expect(deletion?.code).toBe('23001');
      expect(await db('references').where({ id: reference.id }).first()).toBeDefined();
    });

    it('reference_range_must_be_ordered', async () => {
      const [user] = await db('users').insert({ name: 'second', password_hash: 'x' }).returning('id');
      const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Licence', name: 'B-1' }).returning('id');
      const [capture] = await db('captures').insert({ user_id: user.id, purpose: 'demo', raw_path: 'raw/b.ndjson', started_at: db.fn.now() }).returning('id');
      await expect(
        db('references').insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 10, last_raw_index: 9, origin: 'demo', start_kind: 'flying' })
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('knex_pool_is_destroyed_on_shutdown', async () => {
    const database = await createMigratedDatabase();
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ DATABASE_URL: database.url })] }), StorageModule]
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      const db = app.get<Knex>(KNEX);
      expect((await db.raw('select 1 as one')).rows[0].one).toBe(1);
      await app.close();
      await expect(db.raw('select 1')).rejects.toThrow();
    } finally {
      await database.drop();
    }
  });
});
