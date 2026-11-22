import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import knex, { type Knex } from 'knex';
import { KPH_PER_MPS, eventKeyKind, eventKeyPlace } from '@gt7/contracts';
import { ConfigModule } from '@nestjs/config';
import { KNEX } from '../src/storage/knex.provider.js';
import { StorageModule } from '../src/storage/storage.module.js';
import { exerciseStatuses } from '../src/exercises/exercise-status.js';
import { exerciseStep } from '../src/exercises/exercise-step.js';
import { createDisposableDatabase, createMigratedDatabase, migrationConfig, migrationsDirectory, type DisposableDatabase } from './support/database.js';

const applicationTables = ['users', 'sessions', 'settings', 'exercises', 'captures', 'references', 'attempts', 'cue_events', 'attempt_findings', 'attempt_comparisons', 'races', 'race_laps', 'race_events'];

async function tableNames(db: Knex): Promise<string[]> {
  const result = await db.raw<{ rows: { table_name: string }[] }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name not like 'knex_%'"
  );
  return result.rows.map(row => row.table_name).sort();
}

const migrations = readdirSync(migrationsDirectory).filter(name => name.endsWith('.cjs')).sort();

async function migrateUpTo(db: Knex, last: string): Promise<void> {
  for (const name of migrations.slice(0, migrations.indexOf(last) + 1)) await db.migrate.up({ ...migrationConfig(), name });
}

async function migrateDownTo(db: Knex, last: string): Promise<void> {
  const completed = async () => ((await db.migrate.list(migrationConfig())) as [{ name: string }[], unknown])[0];
  while ((await completed()).at(-1)?.name !== last) await db.migrate.down(migrationConfig());
}

async function withDatabase(test: (db: Knex) => Promise<void>): Promise<void> {
  const database = await createDisposableDatabase();
  const db = knex({ client: 'pg', connection: database.url });
  try {
    await test(db);
  } finally {
    await db.destroy();
    await database.drop();
  }
}

async function seedOwner(db: Knex, exerciseName: string, userName = 'migrator') {
  const [user] = await db('users').insert({ name: userName, password_hash: 'x' }).returning('id');
  const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Licence', name: exerciseName }).returning('id');
  const [capture] = await db('captures').insert({ user_id: user.id, purpose: 'demo', raw_path: 'raw/seed.ndjson', started_at: db.fn.now() }).returning('id');
  return { user, exercise, capture };
}

describe('database schema', () => {
  it('migration_up_down_up', async () => {
    await withDatabase(async db => {
      await db.migrate.latest(migrationConfig());
      expect(await tableNames(db)).toEqual([...applicationTables].sort());
      await db.migrate.rollback(migrationConfig(), true);
      expect(await tableNames(db)).toEqual([]);
      await db.migrate.latest(migrationConfig());
      expect(await tableNames(db)).toEqual([...applicationTables].sort());
    });
  });

  it('cue_event_kind_migration_backfills_old_rows_and_rolls_back', async () => {
    await withDatabase(async db => {
      const keys = ['brake@291', 'big-stop@291', 'ease-off@564', 'throttle@411', 'tighter@2', 'keep-left@406', 'keep-right@685', 'guidance-paused#1', 'guidance-resumed#2', 'focus'];
      const columns = async () => Object.keys(await db('cue_events').columnInfo());
      const stored = async () => db('cue_events').orderBy('decided_mono_ms').select('event_key', 'kind', 'event_kind', 's_m');
      const backfilled = keys.map(key => ({ event_key: key, kind: `voice-${key}`, event_kind: eventKeyKind(key), s_m: eventKeyPlace(key) }));
      await db.migrate.up({ ...migrationConfig(), name: '001-initial.cjs' });
      const { exercise, capture } = await seedOwner(db, 'F-1');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 0, last_raw_index: 10, origin: 'demo', start_kind: 'flying' })
        .returning('id');
      const [attempt] = await db('attempts')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, first_raw_index: 0, last_raw_index: 10, mode: 'guided', completion: 'complete', game_ms: 1000, started_at: db.fn.now() })
        .returning('id');
      await db('cue_events').insert(keys.map((key, index) => ({ attempt_id: attempt.id, event_key: key, kind: `voice-${key}`, decided_mono_ms: index, outcome: 'sent' })));
      await db.migrate.up({ ...migrationConfig(), name: '002-add-cue-event-kind.cjs' });
      expect(await stored()).toEqual(backfilled);
      expect(backfilled.every(row => row.event_kind !== null)).toBe(true);
      await expect(db('cue_events').insert({ attempt_id: attempt.id, event_key: 'brake@1', kind: 'brake', decided_mono_ms: 99, outcome: 'sent' })).rejects.toMatchObject({ code: '23502' });
      await db.migrate.down(migrationConfig());
      expect(await columns()).not.toContain('event_kind');
      expect(await columns()).not.toContain('s_m');
      expect(await db('cue_events').count<{ count: string }[]>('* as count')).toEqual([{ count: String(keys.length) }]);
      await db.migrate.up({ ...migrationConfig(), name: '002-add-cue-event-kind.cjs' });
      expect(await stored()).toEqual(backfilled);
    });
  });

  it('slow_corner_migration_converts_old_sizes_to_metres_per_second_and_rolls_back', async () => {
    await withDatabase(async db => {
      const old = [
        { kind: 'brake-early', event_key: 'brake@291', s_m: 291, size: 12, unit: 'm' },
        { kind: 'slow-corner', event_key: 'brake@291', s_m: 330, size: 16, unit: 'km/h' },
        { kind: 'off-line', event_key: null, s_m: 400, size: 1.6, unit: 'm' },
        { kind: 'slow-corner', event_key: 'brake@677', s_m: 700, size: 8.5, unit: 'km/h' }
      ];
      const converted = old.map(row => (row.kind === 'slow-corner' ? { ...row, size: row.size / KPH_PER_MPS, unit: 'm/s' } : row));
      const stored = async () => db('attempt_findings').orderBy('s_m').select('kind', 'event_key', 's_m', 'size', 'unit');
      const expectRows = (rows: Record<string, unknown>[], expected: typeof old) => {
        expect(rows.map(({ size: _size, ...rest }) => rest)).toEqual(expected.map(({ size: _size, ...rest }) => rest));
        rows.forEach((row, index) => expect(row.size).toBeCloseTo(expected[index]!.size, 9));
      };
      await db.migrate.up({ ...migrationConfig(), name: '001-initial.cjs' });
      await db.migrate.up({ ...migrationConfig(), name: '002-add-cue-event-kind.cjs' });
      const { exercise, capture } = await seedOwner(db, 'F-1');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 0, last_raw_index: 10, origin: 'demo', start_kind: 'flying' })
        .returning('id');
      const [attempt] = await db('attempts')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, first_raw_index: 0, last_raw_index: 10, mode: 'guided', completion: 'complete', game_ms: 1000, started_at: db.fn.now() })
        .returning('id');
      const finding = (row: Record<string, unknown>) => ({ attempt_id: attempt.id, reference_id: reference.id, ...row });
      await db('attempt_findings').insert(old.map(finding));
      await db.migrate.up({ ...migrationConfig(), name: '003-slow-corner-size-in-mps.cjs' });
      expectRows(await stored(), converted);
      await expect(db('attempt_findings').insert(finding({ ...old[1]!, s_m: 900 }))).rejects.toMatchObject({ code: '23514' });
      await db.migrate.down(migrationConfig());
      expectRows(await stored(), old);
      await expect(db('attempt_findings').insert(finding({ ...converted[1]!, s_m: 900 }))).rejects.toMatchObject({ code: '23514' });
      await db.migrate.up({ ...migrationConfig(), name: '003-slow-corner-size-in-mps.cjs' });
      expectRows(await stored(), converted);
    });
  });

  it('reference_timer_migration_keeps_old_rows_and_rolls_back', async () => {
    await withDatabase(async db => {
      const columns = async () => Object.keys(await db('references').columnInfo());
      const stored = async () => db('references').orderBy('first_raw_index').select('first_raw_index', 'last_raw_index', 'origin');
      const old = [
        { first_raw_index: 0, last_raw_index: 10, origin: 'demo' },
        { first_raw_index: 20, last_raw_index: 30, origin: 'attempt' }
      ];
      await migrateUpTo(db, '003-slow-corner-size-in-mps.cjs');
      const { exercise, capture } = await seedOwner(db, 'F-1');
      await db('references').insert(old.map(row => ({ exercise_id: exercise.id, capture_id: capture.id, start_kind: 'flying', ...row })));
      await db.migrate.latest(migrationConfig());
      expect(await stored()).toEqual(old);
      expect(await db('references').pluck('timer_ms')).toEqual([null, null]);
      await db('references').insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 40, last_raw_index: 50, origin: 'demo', timer_ms: 16082 });
      expect(await db('references').where({ first_raw_index: 40 }).pluck('timer_ms')).toEqual([16082]);
      await db('references').where({ first_raw_index: 40 }).delete();
      await migrateDownTo(db, '003-slow-corner-size-in-mps.cjs');
      expect(await columns()).not.toContain('timer_ms');
      expect(await stored()).toEqual(old);
      await db.migrate.latest(migrationConfig());
      expect(await stored()).toEqual(old);
      expect(await db('references').pluck('timer_ms')).toEqual([null, null]);
    });
  });

  it('attempt_comparisons_migration_fills_pairs_with_findings_and_rolls_back', async () => {
    await withDatabase(async db => {
      const pairs = async () => (await db('attempt_comparisons').select('attempt_id', 'reference_id')).map(row => `${row.attempt_id}/${row.reference_id}`).sort();
      await migrateUpTo(db, '004-add-reference-timer.cjs');
      const { exercise, capture } = await seedOwner(db, 'G-1');
      const references = await db('references')
        .insert([10, 20].map(first => ({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: first, last_raw_index: first + 5, origin: 'demo', start_kind: 'flying' })))
        .returning('id');
      const attempts = await db('attempts')
        .insert(
          [0, 1, 2].map(index => ({ exercise_id: exercise.id, capture_id: capture.id, reference_id: references[0].id, first_raw_index: index, last_raw_index: index + 5, mode: 'baseline', completion: 'complete', game_ms: 1000, started_at: db.fn.now() }))
        )
        .returning('id');
      const finding = (attempt: string, reference: string, sM: number) => ({ attempt_id: attempt, reference_id: reference, kind: 'brake-late', event_key: 'brake@1', s_m: sM, size: 1, unit: 'm' });
      await db('attempt_findings').insert([
        finding(attempts[0].id, references[0].id, 1),
        finding(attempts[0].id, references[0].id, 2),
        finding(attempts[0].id, references[1].id, 1),
        finding(attempts[1].id, references[1].id, 1)
      ]);
      await db.migrate.latest(migrationConfig());
      const expected = [`${attempts[0].id}/${references[0].id}`, `${attempts[0].id}/${references[1].id}`, `${attempts[1].id}/${references[1].id}`].sort();
      expect(await pairs()).toEqual(expected);
      await expect(db('attempt_comparisons').insert({ attempt_id: attempts[0].id, reference_id: references[0].id })).rejects.toMatchObject({ code: '23505' });
      await db('attempts').where({ id: attempts[1].id }).delete();
      expect(await pairs()).toHaveLength(2);
      await migrateDownTo(db, '004-add-reference-timer.cjs');
      expect(await tableNames(db)).not.toContain('attempt_comparisons');
      await db.migrate.latest(migrationConfig());
      expect(await pairs()).toEqual(expected.filter(pair => !pair.startsWith(attempts[1].id)));
    });
  });

  it('old_baseline_attempts_count_after_the_migration', async () => {
    await withDatabase(async db => {
      const columns = async () => Object.keys(await db('attempts').columnInfo());
      const stored = async () => db('attempts').orderBy('first_raw_index').select('first_raw_index', 'last_raw_index', 'completion', 'game_ms');
      await migrateUpTo(db, '005-add-attempt-comparisons.cjs');
      const { exercise, capture } = await seedOwner(db, 'H-1');
      const [reference] = await db('references').insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 100, last_raw_index: 110, origin: 'demo', start_kind: 'flying' }).returning('id');
      await db('exercises').where({ id: exercise.id }).update({ active_reference_id: reference.id });
      const old = [
        { first_raw_index: 0, last_raw_index: 5, mode: 'baseline', completion: 'complete', game_ms: 1000 },
        { first_raw_index: 10, last_raw_index: 15, mode: 'guided', completion: 'complete', game_ms: 1100 },
        { first_raw_index: 20, last_raw_index: 25, mode: 'baseline', completion: 'aborted', game_ms: null }
      ];
      await db('attempts').insert(old.map(row => ({ exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, started_at: db.fn.now(), ...row })));
      const kept = old.map(({ mode: _mode, ...row }) => row);
      await db.migrate.up({ ...migrationConfig(), name: '006-remove-attempt-mode.cjs' });
      expect(await columns()).not.toContain('mode');
      expect(await stored()).toEqual(kept);
      const found = await request(db, exercise.id);
      expect(found).toEqual({ completeAttempts: 2, step: 2 });
      await db.migrate.down(migrationConfig());
      expect(await columns()).toContain('mode');
      expect(await db('attempts').pluck('mode')).toEqual(['guided', 'guided', 'guided']);
      await expect(db('attempts').insert({ exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, first_raw_index: 30, last_raw_index: 35, mode: 'other', completion: 'aborted', started_at: db.fn.now() })).rejects.toMatchObject({ code: '23514' });
      await db.migrate.latest(migrationConfig());
      expect(await stored()).toEqual(kept);
    });

    async function request(db: Knex, exerciseId: string) {
      const rows = await exerciseStatuses(db, (await db('exercises').where({ id: exerciseId }).first()).user_id, exerciseId);
      const summary = rows[0]!;
      return { completeAttempts: summary.activeReferenceAttempts, step: exerciseStep({ hasActiveReference: summary.activeReferenceId !== null, activeReferenceAttempts: summary.activeReferenceAttempts }) };
    }
  });

  it('reference_start_kind_migration_keeps_old_rows_and_rolls_back', async () => {
    await withDatabase(async db => {
      const columns = async () => Object.keys(await db('references').columnInfo());
      const stored = async () => db('references').orderBy('first_raw_index').select('first_raw_index', 'last_raw_index', 'origin', 'timer_ms');
      await migrateUpTo(db, '006-remove-attempt-mode.cjs');
      const { exercise, capture } = await seedOwner(db, 'S-1');
      const old = [
        { first_raw_index: 0, last_raw_index: 10, origin: 'demo', start_kind: 'flying', timer_ms: 16000 },
        { first_raw_index: 20, last_raw_index: 30, origin: 'attempt', start_kind: 'standing', timer_ms: 15900 }
      ];
      await db('references').insert(old.map(row => ({ exercise_id: exercise.id, capture_id: capture.id, ...row })));
      const kept = old.map(({ start_kind: _kind, ...row }) => row);
      await db.migrate.up({ ...migrationConfig(), name: '007-remove-reference-start-kind.cjs' });
      expect(await columns()).not.toContain('start_kind');
      expect(await stored()).toEqual(kept);
      await db.migrate.down(migrationConfig());
      expect(await columns()).toContain('start_kind');
      expect(await db('references').orderBy('first_raw_index').pluck('start_kind')).toEqual(['flying', 'flying']);
      await expect(db('references').insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 40, last_raw_index: 50, origin: 'demo', start_kind: 'other' })).rejects.toMatchObject({ code: '23514' });
      await db.migrate.latest(migrationConfig());
      expect(await stored()).toEqual(kept);
    });
  });

  it('capture_start_cue_migration_keeps_old_rows_and_rolls_back', async () => {
    await withDatabase(async db => {
      const columns = async () => Object.keys(await db('captures').columnInfo());
      const stored = async () => db('captures').orderBy('raw_path').select('raw_path', 'purpose', 'packets', 'complete');
      await migrateUpTo(db, '007-remove-reference-start-kind.cjs');
      const [user] = await db('users').insert({ name: 'migrator', password_hash: 'x' }).returning('id');
      const old = [
        { raw_path: 'raw/a.ndjson', purpose: 'demo', packets: 100, complete: true, start_cue_mono_ms: 5000 },
        { raw_path: 'raw/b.ndjson', purpose: 'demo', packets: 200, complete: true, start_cue_mono_ms: null },
        { raw_path: 'raw/c.ndjson', purpose: 'player', packets: 300, complete: false, start_cue_mono_ms: null }
      ];
      await db('captures').insert(old.map(row => ({ user_id: user.id, started_at: db.fn.now(), ...row })));
      const kept = old.map(({ start_cue_mono_ms: _cue, ...row }) => row);
      expect(await columns()).toContain('start_cue_mono_ms');
      await db.migrate.latest(migrationConfig());
      expect(await columns()).not.toContain('start_cue_mono_ms');
      expect(await stored()).toEqual(kept);
      await migrateDownTo(db, '007-remove-reference-start-kind.cjs');
      expect(await columns()).toContain('start_cue_mono_ms');
      expect(await db('captures').orderBy('raw_path').pluck('start_cue_mono_ms')).toEqual([null, null, null]);
      await db('captures').where({ raw_path: 'raw/a.ndjson' }).update({ start_cue_mono_ms: 1500.5 });
      await db.migrate.latest(migrationConfig());
      expect(await stored()).toEqual(kept);
    });
  });

  it('best_lap_migration_skips_laps_with_a_pit_stop_and_rolls_back', async () => {
    await withDatabase(async db => {
      await migrateUpTo(db, '009-add-races.cjs');
      const { user, capture } = await seedOwner(db, 'R-1');
      const race = (bestLap: number, bestLapMs: number) => ({
        user_id: user.id,
        capture_id: capture.id,
        first_raw_index: 0,
        last_raw_index: 10,
        car_id: 3602,
        first_lap: 1,
        laps_in_race: 3,
        cars: 16,
        start_position: 8,
        finish_position: 5,
        race_ms: 180000,
        best_lap: bestLap,
        best_lap_ms: bestLapMs,
        reference_lap: 3,
        complete: true,
        position_steps: JSON.stringify([]),
        fuel_points: JSON.stringify([]),
        recurring: JSON.stringify([]),
        started_at: db.fn.now()
      });
      const [pit, allPit, plain] = await db('races').insert([race(2, 55000), race(2, 61000), race(2, 58000)]).returning('id');
      const lap = (raceId: string, number: number, timeMs: number, pitIn: boolean, pitOut: boolean) => ({
        race_id: raceId,
        number,
        first_raw_index: number * 10,
        last_raw_index: number * 10 + 5,
        time_ms: timeMs,
        position_start: 8,
        position_end: 8,
        top_speed_mps: 50,
        fuel_start: 100,
        fuel_end: 90,
        pit_in: pitIn,
        pit_out: pitOut
      });
      await db('race_laps').insert([
        lap(pit.id, 1, 60000, true, false),
        lap(pit.id, 2, 55000, false, true),
        lap(pit.id, 3, 59000, false, false),
        lap(allPit.id, 1, 62000, true, false),
        lap(allPit.id, 2, 61000, false, true),
        lap(plain.id, 1, 60000, false, false),
        lap(plain.id, 2, 58000, false, false)
      ]);
      const best = async () => (await db('races').whereIn('id', [pit.id, allPit.id, plain.id]).select('id', 'best_lap', 'best_lap_ms')).map(row => [row.id === pit.id ? 'pit' : row.id === allPit.id ? 'all-pit' : 'plain', row.best_lap, row.best_lap_ms]).sort();
      await db.migrate.latest(migrationConfig());
      expect(await best()).toEqual([
        ['all-pit', 2, 61000],
        ['pit', 3, 59000],
        ['plain', 2, 58000]
      ]);
      await migrateDownTo(db, '009-add-races.cjs');
      expect(await best()).toEqual([
        ['all-pit', 2, 61000],
        ['pit', 2, 55000],
        ['plain', 2, 58000]
      ]);
    });
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

    it('references_restrict_delete', async () => {
      const [user] = await db('users').insert({ name: 'driver', password_hash: 'x' }).returning('id');
      const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Brand Central', name: 'Yangwang' }).returning('id');
      const [capture] = await db('captures')
        .insert({ user_id: user.id, exercise_id: exercise.id, purpose: 'demo', raw_path: 'raw/a.ndjson', started_at: db.fn.now() })
        .returning('id');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 352, last_raw_index: 1897, origin: 'demo' })
        .returning('id');
      await db('attempts').insert({
        exercise_id: exercise.id,
        capture_id: capture.id,
        reference_id: reference.id,
        first_raw_index: 1162,
        last_raw_index: 2786,
        completion: 'complete',
        game_ms: 17071,
        started_at: db.fn.now()
      });
      const deletion = await db('references').where({ id: reference.id }).delete().then(() => null, (error: { code: string }) => error);
      expect(deletion?.code).toBe('23503');
      expect(await db('references').where({ id: reference.id }).first()).toBeDefined();
    });

    it('complete_attempt_without_game_time_is_rejected_by_the_schema', async () => {
      const { exercise, capture } = await seedOwner(db, 'C-1', 'checker');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 0, last_raw_index: 10, origin: 'demo' })
        .returning('id');
      const attempt = { exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, first_raw_index: 0, last_raw_index: 10, started_at: db.fn.now() };
      await expect(db('attempts').insert({ ...attempt, completion: 'complete' })).rejects.toMatchObject({ constraint: 'attempts_game_time_check' });
      await expect(db('attempts').insert({ ...attempt, completion: 'aborted', game_ms: 1000 })).rejects.toMatchObject({ constraint: 'attempts_game_time_check' });
      await db('attempts').insert({ ...attempt, completion: 'complete', game_ms: 1000 });
      await db('attempts').insert({ ...attempt, completion: 'aborted' });
    });

    it('exercise_delete_cascades_to_references_and_attempts', async () => {
      const [user] = await db('users').insert({ name: 'cascader', password_hash: 'x' }).returning('id');
      const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Licence', name: 'D-1' }).returning('id');
      const [capture] = await db('captures')
        .insert({ user_id: user.id, exercise_id: exercise.id, purpose: 'demo', raw_path: 'raw/d.ndjson', started_at: db.fn.now() })
        .returning('id');
      const [reference] = await db('references')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 0, last_raw_index: 10, origin: 'demo' })
        .returning('id');
      await db('exercises').where({ id: exercise.id }).update({ active_reference_id: reference.id });
      const [attempt] = await db('attempts')
        .insert({ exercise_id: exercise.id, capture_id: capture.id, reference_id: reference.id, first_raw_index: 0, last_raw_index: 10, completion: 'complete', game_ms: 1000, started_at: db.fn.now() })
        .returning('id');
      await db('cue_events').insert({ attempt_id: attempt.id, event_key: 'a', kind: 'brake', event_kind: 'brake', decided_mono_ms: 1, outcome: 'played' });
      await db('attempt_findings').insert({ attempt_id: attempt.id, reference_id: reference.id, kind: 'brake-late', s_m: 1, size: 1, unit: 'm' });
      await db('exercises').where({ id: exercise.id }).delete();
      expect(await db('references').where({ id: reference.id })).toEqual([]);
      expect(await db('attempts').where({ id: attempt.id })).toEqual([]);
      expect(await db('cue_events').where({ attempt_id: attempt.id })).toEqual([]);
      expect(await db('attempt_findings').where({ attempt_id: attempt.id })).toEqual([]);
      expect((await db('captures').where({ id: capture.id }).first()).exercise_id).toBeNull();
    });

    it('side_cue_distance_defaults_to_two_metres_in_the_schema', async () => {
      const [user] = await db('users').insert({ name: 'sider', password_hash: 'x' }).returning('id');
      const [exercise] = await db('exercises').insert({ user_id: user.id, family: 'Licence', name: 'E-1' }).returning('id');
      expect((await db('exercises').where({ id: exercise.id }).first()).side_cue_distance_m).toBe(2);
    });

    it('reference_range_must_be_ordered', async () => {
      const { exercise, capture } = await seedOwner(db, 'B-1', 'second');
      await expect(
        db('references').insert({ exercise_id: exercise.id, capture_id: capture.id, first_raw_index: 10, last_raw_index: 9, origin: 'demo' })
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
