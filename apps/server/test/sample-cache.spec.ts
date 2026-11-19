import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CaptureService } from '../src/captures/capture.service.js';
import { SampleCache } from '../src/captures/sample-cache.js';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { tempDir } from './support/process.js';
import { FixtureReplays, fixturePath } from './support/replay-sources.js';
import { firstProfile, PASSWORD } from './support/session.js';

describe('sample cache', () => {
  it('forget_drops_only_the_entries_of_that_capture', async () => {
    const cache = new SampleCache();
    const pathA = fixturePath('ce-slow');
    const pathB = fixturePath('ce-pause');
    const first = cache.read('a', pathA);
    await Promise.all([first, cache.read('a', pathA, { first: 1, last: 5 }), cache.read('b', pathB)]);
    cache.forget('a');
    expect(cache.size).toBe(1);
    const again = cache.read('a', pathA);
    expect(again).not.toBe(first);
    await again;
  });
});

describe('sample cache and raw file clean-up', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let replays: FixtureReplays;
  let cookie: string;
  const http = () => request(app.getHttpServer());

  async function cachedCapture(): Promise<void> {
    const exerciseId = (await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'ce-autodromo-de-interlagos' }).expect(201)).body.id;
    replays.queue.push('demo-a');
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(201);
    await replays.finished();
    await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201);
    const row = await db('captures').where({ id: started.body.id }).first();
    await app.get(SampleCache).read(row.id, app.get(CaptureService).rawPath(row));
    expect(app.get(SampleCache).size).toBe(1);
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
  });

  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  beforeEach(async () => {
    await db.raw('truncate table users, sessions, settings cascade');
    replays = new FixtureReplays();
    app = await createTestApp(database.url, {
      env: { DATA_DIR: tempDir(), TELEMETRY_SOURCE: 'replay' },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
    cookie = await firstProfile(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('cleanup_drops_cached_samples_of_rewritten_captures', async () => {
    await cachedCapture();
    await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201);
    expect(app.get(SampleCache).size).toBe(0);
  });

  it('history_delete_with_cleanup_forgets_cached_samples', async () => {
    await cachedCapture();
    await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'everything', cleanup: true }).expect(200);
    expect(app.get(SampleCache).size).toBe(0);
  });

  it('profile_delete_forgets_cached_samples', async () => {
    await cachedCapture();
    await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: PASSWORD }).expect(200);
    expect(app.get(SampleCache).size).toBe(0);
  });
});
