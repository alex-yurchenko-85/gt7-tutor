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
import { tempDir } from './support/process.js';

const committedPath = new URL('../../../catalogue/catalogue.json', import.meta.url);
const committed = JSON.parse(readFileSync(committedPath, 'utf8')) as Catalogue;
const throwingFetch: typeof fetch = () => {
  throw new Error('network access during the test');
};

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.find(value => value.startsWith('gt7_session='))!.split(';')[0]!;
}

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
    if (!hasUsers) return cookieOf(await http().post('/api/auth/first-profile').send({ name, password: 'correct horse' }).expect(201));
    return cookieOf(await http().post('/api/auth/sign-in').send({ name, password: 'correct horse' }).expect(200));
  }

  async function userId(name: string): Promise<string> {
    return (await db('users').where({ name }).first()).id as string;
  }

  async function exerciseFor(user: string, catalogueId: string, targets: object): Promise<string> {
    const [row] = await db('exercises')
      .insert({ user_id: user, catalogue_id: catalogueId, family: 'Licence', name: catalogueId, targets: JSON.stringify(targets) })
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
    await db.raw('truncate table users, sessions, catalogue_entries cascade');
    dataDir = tempDir();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
    app = null;
  });

  it('import_is_idempotent', async () => {
    await start();
    const first = await db('catalogue_entries').count<{ count: string }[]>('* as count');
    await start();
    const second = await db('catalogue_entries').count<{ count: string }[]>('* as count');
    expect(Number(first[0]!.count)).toBe(committed.entries.length);
    expect(second).toEqual(first);
  });

  it('import_updates_changed_targets_but_not_edited_exercises', async () => {
    await start();
    const cookie = await signIn();
    const user = await userId('Driver');
    const original = committed.entries.find(entry => entry.id === 'licence-b-1')!.targets!;
    const unedited = await exerciseFor(user, 'licence-b-1', original);
    const edited = await exerciseFor(user, 'licence-b-1', { ...original, goldMs: 19000 });
    const newTargets = { bronzeMs: 23000, silverMs: 22000, goldMs: 21000 };
    savedCatalogue(dataDir, {
      ...committed,
      retrieved: laterThanCommitted(1),
      entries: committed.entries.map(entry => (entry.id === 'licence-b-1' ? { ...entry, targets: newTargets } : entry))
    });
    await start();
    expect((await db('catalogue_entries').where({ id: 'licence-b-1' }).first()).targets).toEqual(newTargets);
    expect((await db('exercises').where({ id: unedited }).first()).targets).toEqual(newTargets);
    expect((await db('exercises').where({ id: edited }).first()).targets).toEqual({ ...original, goldMs: 19000 });
    const listed = await http().get('/api/catalogue?q=Starting %26 Stopping 1').set('Cookie', cookie).expect(200);
    expect(listed.body.find((entry: { id: string }) => entry.id === 'licence-b-1').targets).toEqual(newTargets);
  });

  it('import_never_deletes_entries_with_exercises', async () => {
    await start();
    await signIn();
    const exercise = await exerciseFor(await userId('Driver'), 'licence-b-1', {});
    savedCatalogue(dataDir, {
      ...committed,
      retrieved: laterThanCommitted(1),
      entries: committed.entries.filter(entry => entry.id !== 'licence-b-1' && entry.id !== 'licence-b-2')
    });
    await start();
    expect(await db('catalogue_entries').where({ id: 'licence-b-1' }).first()).toBeDefined();
    expect(await db('catalogue_entries').where({ id: 'licence-b-2' }).first()).toBeUndefined();
    expect(await db('exercises').where({ id: exercise }).first()).toBeDefined();
  });

  it('filters_combine', async () => {
    await start();
    const cookie = await signIn();
    const response = await http().get('/api/catalogue?family=Licence&collection=National B').set('Cookie', cookie).expect(200);
    expect(response.body).toHaveLength(10);
    expect(response.body[0]).toMatchObject({ id: 'licence-b-1', code: 'B-1', exerciseId: null, status: null });
    expect(response.body[0]).not.toHaveProperty('support');
    const byTrack = await http().get('/api/catalogue?family=Licence&track=High Speed Ring&q=stopping').set('Cookie', cookie).expect(200);
    expect(byTrack.body.length).toBeGreaterThan(0);
    expect(byTrack.body.every((entry: { track: string }) => entry.track === 'High Speed Ring')).toBe(true);
  });

  it('status_is_per_profile', async () => {
    await start();
    const first = await signIn('Driver');
    await http().post('/api/profiles').set('Cookie', first).send({ name: 'Second', password: 'correct horse' }).expect(201);
    const second = await signIn('Second');
    const exercise = await exerciseFor(await userId('Driver'), 'licence-b-1', {});
    const mine = await http().get('/api/catalogue?collection=National B').set('Cookie', first).expect(200);
    expect(mine.body[0]).toMatchObject({ id: 'licence-b-1', exerciseId: exercise, status: 'new' });
    const theirs = await http().get('/api/catalogue?collection=National B').set('Cookie', second).expect(200);
    expect(theirs.body[0]).toMatchObject({ id: 'licence-b-1', exerciseId: null, status: null });
  });

  it('circuits_and_known_car', async () => {
    await start();
    const cookie = await signIn();
    const circuits = await http().get('/api/catalogue/circuits').set('Cookie', cookie).expect(200);
    expect(circuits.body.length).toBeGreaterThanOrEqual(122);
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
    const before = await db('catalogue_entries').orderBy('id');
    const response = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.diff.added.map((entry: { id: string }) => entry.id)).toEqual(['licence-b-11']);
    expect(response.body.diff).toMatchObject({ removed: [], changed: [], rejected: null });
    expect(await db('catalogue_entries').orderBy('id')).toEqual(before);
    expect(existsSync(join(dataDir, 'catalogue', 'catalogue.json'))).toBe(false);
  });

  it('apply_saves_file_imports_and_keeps_previous', async () => {
    const sources = recordedSources((page, text) => (page === 'GT7 B-License' ? withExtraTest(text, 'B-11') : text));
    await start(sources);
    const cookie = await signIn();
    const { token } = (await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(201)).body;
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(201);
    expect(await db('catalogue_entries').where({ id: 'licence-b-11' }).first()).toBeDefined();
    const saved = JSON.parse(readFileSync(join(dataDir, 'catalogue', 'catalogue.json'), 'utf8')) as Catalogue;
    expect(saved.entries.some(entry => entry.id === 'licence-b-11')).toBe(true);
    const previous = JSON.parse(readFileSync(join(dataDir, 'catalogue', 'catalogue.previous.json'), 'utf8')) as Catalogue;
    expect(previous.retrieved).toBe(committed.retrieved);
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body).toMatchObject({ retrieved: saved.retrieved, hasPrevious: true, previousRetrieved: committed.retrieved });
    await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token }).expect(409);
    await start(sources);
    expect(await db('catalogue_entries').where({ id: 'licence-b-11' }).first()).toBeDefined();
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
    expect(await db('catalogue_entries').where({ id: 'licence-b-11' }).first()).toBeUndefined();
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body).toMatchObject({ retrieved: committed.retrieved, hasPrevious: false, previousRetrieved: null });
    await http().post('/api/catalogue/update/restore').set('Cookie', cookie).expect(409);
    await start(sources);
    expect(await db('catalogue_entries').where({ id: 'licence-b-11' }).first()).toBeUndefined();
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
    expect(check.body.diff.rejected).toContain('21 of 100 Licence');
    const apply = await http().post('/api/catalogue/update/apply').set('Cookie', cookie).send({ token: check.body.token }).expect(409);
    expect(apply.body).toMatchObject({ code: 'rejected', reason: check.body.diff.rejected });
    expect(await db('catalogue_entries').where({ family: 'Licence' }).count<{ count: string }[]>('* as count')).toEqual([{ count: '100' }]);
  });

  it('source_timeout_or_bad_page_reports_reason_and_keeps_catalogue', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    await start(hanging, { CATALOGUE_TIMEOUT_MS: '100' });
    const cookie = await signIn();
    const timeout = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(502);
    expect(timeout.body).toMatchObject({ code: 'update-failed', reason: expect.stringContaining('no answer within 100 ms') });

    await start(recordedSources((page, text) => (page === 'Circuit Experience' ? 'This page has a new layout.' : text)));
    const badPage = await http().post('/api/catalogue/update/check').set('Cookie', cookie).expect(502);
    expect(badPage.body.reason).toContain('Circuit Experience');
    expect(await db('catalogue_entries').count<{ count: string }[]>('* as count')).toEqual([{ count: String(committed.entries.length) }]);
    expect(existsSync(join(dataDir, 'catalogue', 'catalogue.json'))).toBe(false);
  });

  it('newer_saved_file_wins_at_start', async () => {
    const extra = { ...committed.entries[1]!, id: 'licence-saved-1', code: 'SAVED-1' };
    savedCatalogue(dataDir, { ...committed, retrieved: laterThanCommitted(1), entries: [...committed.entries, extra] });
    await start();
    const cookie = await signIn();
    expect(await db('catalogue_entries').where({ id: 'licence-saved-1' }).first()).toBeDefined();
    const info = await http().get('/api/catalogue/info').set('Cookie', cookie).expect(200);
    expect(info.body.retrieved).toBe(laterThanCommitted(1));
  });

  it('older_saved_file_loses_to_committed_file', async () => {
    const extra = { ...committed.entries[1]!, id: 'licence-saved-1', code: 'SAVED-1' };
    savedCatalogue(dataDir, { ...committed, retrieved: laterThanCommitted(-1), entries: [...committed.entries, extra] });
    await start();
    expect(await db('catalogue_entries').where({ id: 'licence-saved-1' }).first()).toBeUndefined();
  });

  it('invalid_saved_file_falls_back_to_committed_file', async () => {
    mkdirSync(join(dataDir, 'catalogue'), { recursive: true });
    writeFileSync(join(dataDir, 'catalogue', 'catalogue.json'), '{"schemaVersion":1');
    await start();
    expect(await db('catalogue_entries').count<{ count: string }[]>('* as count')).toEqual([{ count: String(committed.entries.length) }]);
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
