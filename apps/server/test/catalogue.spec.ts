import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalogue } from '@gt7/contracts';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { CATALOGUE_FETCH } from '../src/catalogue/catalogue.tokens.js';
import { createTestApp } from './support/app.js';
import { keepFirstTests, recordedSources, withExtraTest, type SourceStub } from './support/catalogue-sources.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { cookiePair, sessionCookie } from './support/session.js';
import { testTempDir } from '../../../tools/testing/temp-root.js';

const committedPath = new URL('../../../content/catalogue/catalogue.json', import.meta.url);
const committed = JSON.parse(readFileSync(committedPath, 'utf8')) as Catalogue;
const throwingFetch: typeof fetch = () => {
  throw new Error('network access during the test');
};

function savedCatalogue(dataDir: string, catalogue: Catalogue): void {
  mkdirSync(join(dataDir, 'catalogue'), { recursive: true });
  writeFileSync(join(dataDir, 'catalogue', 'catalogue.json'), JSON.stringify(catalogue));
}

function laterThanCommitted(days: number): string {
  return new Date(Date.parse(committed.retrieved) + days * 86400000).toISOString();
}

describe('catalogue', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication | null = null;
  let dataDir: string;
  const http = () => request(app!.getHttpServer());

  async function start(sources: SourceStub | typeof fetch = throwingFetch, env: Record<string, string> = {}) {
    await app?.close();
    const fetchFunction = typeof sources === 'function' ? sources : sources.fetch;
    app = await createTestApp(database.url, {
      env: { DATA_DIR: dataDir, ...env },
      override: builder => builder.overrideProvider(CATALOGUE_FETCH).useValue(fetchFunction)
    });
    return app;
  }

  async function signIn(name = 'Driver'): Promise<string> {
    const hasUsers = (await http().get('/api/auth/state')).body.hasUsers as boolean;
    if (!hasUsers) return cookiePair(sessionCookie(await http().post('/api/auth/first-profile').send({ name, password: 'correct horse' }).expect(201)));
    return cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send({ name, password: 'correct horse' }).expect(200)));
  }

  function entryOf(id: string) {
    return (entry: { id: string }) => entry.id === id;
  }

  async function userId(name: string): Promise<string> {
    return (await db('users').where({ name }).first()).id as string;
  }

  async function exerciseFor(user: string, catalogueId: string, targetMs: number | null): Promise<string> {
    const [row] = await db('exercises')
      .insert({ user_id: user, catalogue_id: catalogueId, family: 'Licence', name: catalogueId, target_ms: targetMs })
      .returning('id');
    return row.id as string;
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
    vi.useRealTimers();
    await db.raw('truncate table users, sessions cascade');
    dataDir = testTempDir('gt7-server-');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
    app = null;
  });

  it('status_is_per_profile', async () => {
    await start();
    const first = await signIn('Driver');
    await http().post('/api/profiles').set('Cookie', first).send({ name: 'Second', password: 'correct horse' }).expect(201);
    const second = await signIn('Second');
    const exercise = await exerciseFor(await userId('Driver'), 'licence-b-1', null);
    const mine = await http().get('/api/catalogue').set('Cookie', first).expect(200);
    expect(mine.body.find(entryOf('licence-b-1'))).toMatchObject({ id: 'licence-b-1', exerciseId: exercise, status: 'new' });
    const theirs = await http().get('/api/catalogue').set('Cookie', second).expect(200);
    expect(theirs.body.find(entryOf('licence-b-1'))).toMatchObject({ id: 'licence-b-1', exerciseId: null, status: null });
  });

  it('circuits_and_known_car', async () => {
    await start();
    const cookie = await signIn();
    const car = await http().get('/api/cars/3602').set('Cookie', cookie).expect(200);
    expect(car.body).toEqual({ name: "Yangwang U9 '24" });
  });

  it('unknown_car_id_is_404', async () => {
    await start();
    const cookie = await signIn();
    await http().get('/api/cars/999999').set('Cookie', cookie).expect(404);
    await http().get('/api/cars/abc').set('Cookie', cookie).expect(400);
  });

  it('start_makes_no_network_request', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(throwingFetch);
    try {
      await start(throwingFetch);
      const cookie = await signIn();
      const response = await http().get('/api/catalogue').set('Cookie', cookie).expect(200);
      expect(response.body).toHaveLength(committed.entries.length);
      const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
      expect(info.body).toMatchObject({ retrieved: committed.retrieved, hasPrevious: false, previousRetrieved: null, counts: { cars: committed.cars.length } });
      expect(info.body.counts.entries.Licence).toBe(100);
      expect(info.body.sources).toHaveLength(2);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });

  it('check_returns_diff_and_changes_nothing', async () => {
    const sources = recordedSources((page, text) => (page === 'GT7 B-License' ? withExtraTest(text, 'B-11') : text));
    await start(sources);
    const cookie = await signIn();
    const before = (await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body;
    const response = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.diff.added.map((entry: { id: string }) => entry.id)).toEqual(['licence-b-11']);
    expect(response.body.diff).toMatchObject({ removed: [], changed: [], rejected: null });
    expect((await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body).toEqual(before);
    expect(existsSync(join(dataDir, 'catalogue', 'catalogue.json'))).toBe(false);
  });

  it('apply_saves_file_imports_and_keeps_previous', async () => {
    const sources = recordedSources((page, text) => (page === 'GT7 B-License' ? withExtraTest(text, 'B-11') : text));
    await start(sources);
    const cookie = await signIn();
    const { token } = (await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201)).body;
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(201);
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-b-11'))).toBe(true);
    const saved = JSON.parse(readFileSync(join(dataDir, 'catalogue', 'catalogue.json'), 'utf8')) as Catalogue;
    expect(saved.entries.some(entry => entry.id === 'licence-b-11')).toBe(true);
    const previous = JSON.parse(readFileSync(join(dataDir, 'catalogue', 'catalogue.previous.json'), 'utf8')) as Catalogue;
    expect(previous.retrieved).toBe(committed.retrieved);
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body).toMatchObject({ retrieved: saved.retrieved, hasPrevious: true, previousRetrieved: committed.retrieved });
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(409);
    await start(sources);
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-b-11'))).toBe(true);
  });

  it('catalogue_info_reads_the_previous_file_at_most_once', async () => {
    const sources = recordedSources((page, text) => (page === 'GT7 B-License' ? withExtraTest(text, 'B-11') : text));
    await start(sources);
    const cookie = await signIn();
    const { token } = (await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201)).body;
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(201);
    const afterApply = vi.spyOn(app!.get(CatalogueService).files, 'previous');
    for (let index = 0; index < 2; index++) {
      const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
      expect(info.body.previousRetrieved).toBe(committed.retrieved);
    }
    expect(afterApply).not.toHaveBeenCalled();
    await start(sources);
    const afterStart = vi.spyOn(app!.get(CatalogueService).files, 'previous');
    for (let index = 0; index < 2; index++) {
      const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
      expect(info.body.previousRetrieved).toBe(committed.retrieved);
    }
    expect(afterStart).toHaveBeenCalledTimes(1);
  });

  it('restore_brings_previous_back', async () => {
    const sources = recordedSources((page, text) => (page === 'GT7 B-License' ? withExtraTest(text, 'B-11') : text));
    await start(sources);
    const cookie = await signIn();
    const { token } = (await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201)).body;
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(201);
    await http().post('/api/catalogue/update/restore').set('Cookie', cookie).expect(201);
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-b-11'))).toBe(false);
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body).toMatchObject({ retrieved: committed.retrieved, hasPrevious: false, previousRetrieved: null });
    await http().post('/api/catalogue/update/restore').set('Cookie', cookie).expect(409);
    await start(sources);
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-b-11'))).toBe(false);
  });

  it('apply_with_unknown_or_expired_token_is_409', async () => {
    await start(recordedSources());
    const cookie = await signIn();
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token: 'unknown' }).expect(409);
    const { token } = (await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201)).body;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60000 + 1000);
    const response = await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(409);
    expect(response.body.code).toBe('unknown-token');
    expect(existsSync(join(dataDir, 'catalogue', 'catalogue.json'))).toBe(false);
  });

  it('update_losing_a_fifth_of_a_family_is_rejected', async () => {
    const shortened = new Set(['GT7 A-License', 'GT7 International B-License', 'GT7 International A-License']);
    await start(recordedSources((page, text) => (shortened.has(page) ? keepFirstTests(text, 3) : text)));
    const cookie = await signIn();
    const check = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201);
    expect(check.body.diff.removed).toHaveLength(21);
    expect(check.body.diff.rejected).toEqual({ lost: 21, total: 100, family: 'Licence' });
    const apply = await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token: check.body.token }).expect(409);
    expect(apply.body).toEqual({ code: 'rejected', params: check.body.diff.rejected });
    expect((await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body.filter((entry: { family: string }) => entry.family === 'Licence')).toHaveLength(100);
  });

  it('source_timeout_or_bad_page_reports_reason_and_keeps_catalogue', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    await start(hanging, { CATALOGUE_TIMEOUT_MS: '100' });
    const cookie = await signIn();
    const timeout = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(502);
    expect(timeout.body).toEqual({ code: 'update-failed', params: { detail: expect.stringContaining('no answer within 100 ms') } });

    await start(recordedSources((page, text) => (page === 'Circuit Experience' ? 'This page has a new layout.' : text)));
    const badPage = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(502);
    expect(badPage.body.params.detail).toContain('Circuit Experience');
    expect((await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body).toHaveLength(committed.entries.length);
    expect(existsSync(join(dataDir, 'catalogue', 'catalogue.json'))).toBe(false);
  });

  it('newer_saved_file_wins_at_start', async () => {
    const extra = { ...committed.entries[1]!, id: 'licence-saved-1', code: 'SAVED-1' };
    savedCatalogue(dataDir, { ...committed, retrieved: laterThanCommitted(1), entries: [...committed.entries, extra] });
    await start();
    const cookie = await signIn();
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-saved-1'))).toBe(true);
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body.retrieved).toBe(laterThanCommitted(1));
  });

  it('older_saved_file_loses_to_committed_file', async () => {
    const extra = { ...committed.entries[1]!, id: 'licence-saved-1', code: 'SAVED-1' };
    savedCatalogue(dataDir, { ...committed, retrieved: laterThanCommitted(-1), entries: [...committed.entries, extra] });
    await start();
    expect((await http().get('/api/catalogue').set('Cookie', await signIn()).expect(200)).body.some(entryOf('licence-saved-1'))).toBe(false);
  });

  it('invalid_saved_file_falls_back_to_committed_file', async () => {
    mkdirSync(join(dataDir, 'catalogue'), { recursive: true });
    writeFileSync(join(dataDir, 'catalogue', 'catalogue.json'), '{"schemaVersion":1');
    await start();
    const cookie = await signIn();
    expect((await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body).toHaveLength(committed.entries.length);
  });

  function schemaVersion1(retrieved: string): string {
    const entries = committed.entries.map(({ targetMs, ...entry }) => ({ ...entry, targets: targetMs === null ? null : { goldMs: targetMs, silverMs: targetMs + 1000, bronzeMs: targetMs + 2000 }, sections: null }));
    return JSON.stringify({ ...committed, schemaVersion: 1, retrieved, entries });
  }

  it('previous_file_of_schema_version_1_counts_as_no_previous_file', async () => {
    mkdirSync(join(dataDir, 'catalogue'), { recursive: true });
    writeFileSync(join(dataDir, 'catalogue', 'catalogue.previous.json'), schemaVersion1(laterThanCommitted(-1)));
    await start();
    const cookie = await signIn();
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body).toMatchObject({ retrieved: committed.retrieved, hasPrevious: false, previousRetrieved: null });
    expect((await http().post('/api/catalogue/update/restore').set('Cookie', cookie).expect(409)).body.code).toBe('no-previous');
  });

  it('saved_file_of_schema_version_1_falls_back_to_committed_file', async () => {
    mkdirSync(join(dataDir, 'catalogue'), { recursive: true });
    writeFileSync(join(dataDir, 'catalogue', 'catalogue.json'), schemaVersion1(laterThanCommitted(1)));
    await start();
    const cookie = await signIn();
    const listed = (await http().get('/api/catalogue').set('Cookie', cookie).expect(200)).body as { id: string; targetMs: number | null }[];
    expect(listed).toHaveLength(committed.entries.length);
    expect(listed.find(entryOf('ce-tsukuba-circuit-s1'))).toBeDefined();
    expect(listed.find(entryOf('licence-b-1'))).toMatchObject({ targetMs: 20800 });
    expect((await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200)).body.retrieved).toBe(committed.retrieved);
  });

  it('exercise_keeps_working_when_its_catalogue_entry_is_gone', async () => {
    await start();
    const cookie = await signIn();
    const entry = committed.entries.find(candidate => candidate.id === 'licence-b-1')!;
    const created = await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: entry.id }).expect(201);
    app!.get(CatalogueService).activate({ ...committed, entries: committed.entries.filter(candidate => candidate.id !== entry.id) });
    const listed = await http().get('/api/catalogue').set('Cookie', cookie).expect(200);
    expect(listed.body.some(entryOf(entry.id))).toBe(false);
    const response = await http().get(`/api/exercises/${created.body.id}`).set('Cookie', cookie).expect(200);
    expect(response.body).toMatchObject({ name: entry.name, family: entry.family, targetMs: entry.targetMs });
  });

  it('update_needs_session', async () => {
    await start(recordedSources());
    await http().get('/api/catalogue/info').expect(401);
    await http().get('/api/catalogue').expect(401);
    await http().post('/api/catalogue/update/check').expect(401);
    await http().post('/api/catalogue/update/apply').send({ token: 'x' }).expect(401);
    await http().post('/api/catalogue/update/restore').expect(401);
  });

  it('requests_carry_no_cookie_or_profile_data', async () => {
    const sources = recordedSources();
    await start(sources);
    const cookie = await signIn();
    await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201);
    expect(sources.requests.length).toBe(16);
    for (const sent of sources.requests) {
      expect(sent.headers).toEqual({ 'user-agent': 'gt7-tutor-catalogue' });
      expect(sent.url).not.toContain('Driver');
    }
  });
});
