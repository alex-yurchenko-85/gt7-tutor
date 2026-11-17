import { createSocket } from 'node:dgram';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { eventually } from './support/live.js';
import { tempDir } from './support/process.js';
import { firstProfile } from './support/session.js';

const SEED_TIMEOUT_MS = 90000;

const OFFLINE_ATTEMPT_ROWS = [
  { first_raw_index: 1162, last_raw_index: 2786 },
  { first_raw_index: 32, last_raw_index: 1680 },
  { first_raw_index: 101, last_raw_index: 1767 }
];

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.find(value => value.startsWith('gt7_session='))!.split(';')[0]!;
}

async function demoApp(databaseUrl: string, dataDir: string): Promise<INestApplication> {
  const app = await createTestApp(databaseUrl, { env: { DATA_DIR: dataDir, DEMO_MODE: '1', TELEMETRY_SOURCE: 'replay' } });
  await eventually(async () => {
    const info = await request(app.getHttpServer()).get('/api/app-info').expect(200);
    return info.body.demo?.ready === true;
  }, SEED_TIMEOUT_MS);
  return app;
}

async function signInDemo(app: INestApplication): Promise<string> {
  return cookieOf(await request(app.getHttpServer()).post('/api/auth/sign-in').send({ name: 'demo', password: 'demodemo' }).expect(200));
}

function bindsUdp(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createSocket('udp4');
    socket.once('error', () => resolve(false));
    socket.bind(port, '0.0.0.0', () => socket.close(() => resolve(true)));
  });
}

describe('demo mode', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let dataDir: string;
  let app: INestApplication;
  let cookie: string;
  let exerciseId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
    dataDir = tempDir();
    app = await demoApp(database.url, dataDir);
    cookie = await signInDemo(app);
    exerciseId = (await http().get('/api/exercises').set('Cookie', cookie).expect(200)).body[0].id;
  }, SEED_TIMEOUT_MS + 10000);

  afterAll(async () => {
    await app?.close();
    await db.destroy();
    await database.drop();
  });

  it('seed_creates_profile_exercise_and_active_reference', async () => {
    const exercise = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(exercise.catalogueId).toBe('brand-yangwang-racing-lines');
    const references = (await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200)).body;
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ first: 352, last: 1897, startKind: 'flying', active: true });
    const cues = (await http().get(`/api/references/${references[0].id}/cues`).set('Cookie', cookie).expect(200)).body;
    expect(cues).toHaveLength(7);
    const corners = (await http().get(`/api/references/${references[0].id}/corners`).set('Cookie', cookie).expect(200)).body;
    expect(corners).toHaveLength(3);
  });

  it('seed_stores_three_complete_baseline_attempts', async () => {
    const attempts = await db('attempts').where({ exercise_id: exerciseId }).orderBy('started_at');
    expect(attempts.map(row => ({ mode: row.mode, completion: row.completion }))).toEqual(
      Array.from({ length: 3 }, () => ({ mode: 'baseline', completion: 'complete' }))
    );
    expect(attempts.map(row => ({ first_raw_index: row.first_raw_index, last_raw_index: row.last_raw_index }))).toEqual(OFFLINE_ATTEMPT_ROWS);
  });

  it('seed_gives_recurring_differences', async () => {
    const recurring = (await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200)).body;
    expect(recurring.length).toBeGreaterThan(0);
  });

  it('app_info_shows_the_demo_profile_only_in_demo_mode', async () => {
    const info = (await http().get('/api/app-info').expect(200)).body;
    expect(info).toEqual({ demo: { profileName: 'demo', password: 'demodemo', ready: true } });
  });

  it('demo_attempt_selects_fixtures_in_turn', async () => {
    const picks: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      picks.push((await http().post('/api/demo/attempt').set('Cookie', cookie).expect(201)).body.fixture);
    }
    expect(picks).toEqual(['player-run', 'h3-wide-apex', 'h3-wide-finish', 'player-run']);
  });

  it('demo_attempt_needs_a_session', async () => {
    await http().post('/api/demo/attempt').expect(401);
  });

  it('demo_blocks_console_address_and_catalogue_update', async () => {
    const address = await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '192.0.2.10' }).expect(409);
    expect(address.body.code).toBe('demo-mode');
    for (const action of ['check', 'apply', 'restore']) {
      const update = await http().post(`/api/catalogue/update/${action}`).set('Cookie', cookie).send({}).expect(409);
      expect(update.body.code).toBe('demo-mode');
    }
  });

  it('demo_never_binds_udp', async () => {
    expect(await bindsUdp(33740)).toBe(true);
  });

  it('seed_is_idempotent', async () => {
    await app.close();
    app = await demoApp(database.url, dataDir);
    cookie = await signInDemo(app);
    const count = async (table: string) => Number((await db(table).count('* as count'))[0]!.count);
    expect(await count('users')).toBe(1);
    expect(await count('exercises')).toBe(1);
    expect(await count('references')).toBe(1);
    expect(await count('attempts')).toBe(3);
    const references = (await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200)).body;
    await http().get(`/api/references/${references[0].id}/cues`).set('Cookie', cookie).expect(200);
  }, SEED_TIMEOUT_MS + 10000);
});

describe('outside demo mode', () => {
  let database: DisposableDatabase;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    database = await createMigratedDatabase();
    app = await createTestApp(database.url, { env: { TELEMETRY_SOURCE: 'replay' } });
  });

  afterAll(async () => {
    await app?.close();
    await database.drop();
  });

  it('app_info_has_no_demo', async () => {
    expect((await http().get('/api/app-info').expect(200)).body).toEqual({ demo: null });
  });

  it('demo_endpoints_are_404_outside_demo_mode', async () => {
    const cookie = await firstProfile(app);
    await http().post('/api/demo/attempt').set('Cookie', cookie).expect(404);
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '192.0.2.10' }).expect(200);
  });
});
