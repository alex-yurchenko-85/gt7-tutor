import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { fixtureRows, ManualSource } from './support/live.js';
import { tempDir } from './support/process.js';
import { FixtureReplays } from './support/replay-sources.js';
import { firstProfile } from './support/session.js';

function webBuild(): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>GT7 Tutor</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'export {};');
  return dir;
}

class StartingSource extends ManualSource {
  constructor(private readonly rows: Parameters<ManualSource['emit']>[0]) {
    super();
  }

  override async start(on: Parameters<ManualSource['start']>[0]): Promise<void> {
    await super.start(on);
    this.emit(this.rows);
  }
}

describe('web interface and reception check', () => {
  let database: DisposableDatabase;
  let app: INestApplication | null = null;
  let replays: FixtureReplays;
  const http = () => request(app!.getHttpServer());

  async function start(env: Record<string, string> = {}) {
    replays = new FixtureReplays();
    app = await createTestApp(database.url, {
      env: { TELEMETRY_SOURCE: 'replay', ...env },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
  }

  beforeEach(async () => {
    database = await createMigratedDatabase();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    await database.drop();
  });

  it('serves_the_web_build_and_falls_back_to_index_for_views', async () => {
    await start({ WEB_DIR: webBuild() });
    const index = await http().get('/').expect(200);
    expect(index.text).toContain('GT7 Tutor');
    const view = await http().get('/exercises/abc/cues').set('Accept', 'text/html').expect(200);
    expect(view.text).toContain('<div id="root">');
    const script = await http().get('/assets/app.js').expect(200);
    expect(script.headers['content-type']).toContain('javascript');
  });

  it('api_paths_never_fall_back_to_index', async () => {
    await start({ WEB_DIR: webBuild() });
    const response = await http().get('/api/no-such-route').set('Accept', 'text/html');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('<div id="root">');
  });

  it('missing_files_are_404_not_the_index', async () => {
    await start({ WEB_DIR: webBuild() });
    for (const path of ['/assets/index-OLDHASH.js', '/favicon.ico']) {
      const response = await http().get(path).set('Accept', '*/*');
      expect(response.status).toBe(404);
      expect(response.text).not.toContain('<div id="root">');
    }
    const view = await http().get('/attempts/abc/review').set('Accept', '*/*').expect(200);
    expect(view.text).toContain('<div id="root">');
  });

  it('serves_the_audio_manifest_and_clips', async () => {
    await start();
    const manifest = await http().get('/audio/manifest.json').expect(200);
    expect(manifest.body.clips.brake.file).toBe('clips/brake.wav');
    const clip = await http().get('/audio/clips/brake.wav').expect(200);
    expect(clip.headers['content-type']).toMatch(/audio\/(wav|wave|x-wav)/);
  });

  it('reception_check_counts_packets_and_reports_the_car', async () => {
    await start();
    const cookie = await firstProfile(app!);
    replays.queue.push(new StartingSource((await fixtureRows('player-run')).slice(1200, 1300)));
    const response = await http().post('/api/settings/connection/check').set('Cookie', cookie).expect(200);
    expect(response.body.packets).toBeGreaterThanOrEqual(30);
    expect(response.body.decoded).toBe(response.body.packets);
    expect(response.body.carId).toBe(3602);
  });

  it('reception_check_without_packets_reports_zero', async () => {
    await start();
    const cookie = await firstProfile(app!);
    replays.queue.push(new ManualSource());
    const response = await http().post('/api/settings/connection/check').set('Cookie', cookie).expect(200);
    expect(response.body).toMatchObject({ packets: 0, decoded: 0, carId: null });
  });

  it('reception_check_needs_a_signed_in_user', async () => {
    await start();
    await firstProfile(app!);
    await http().post('/api/settings/connection/check').expect(401);
  });
});
