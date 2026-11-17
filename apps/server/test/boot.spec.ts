import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { freePort, startBuiltServer, tempDir, waitForHealth } from './support/process.js';

describe('built server', () => {
  let database: DisposableDatabase;

  beforeAll(async () => {
    database = await createMigratedDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('built_server_loads_core', async () => {
    const port = await freePort();
    const server = startBuiltServer(
      { DATABASE_URL: database.url, HTTP_HOST: '127.0.0.1', HTTP_PORT: String(port), DATA_DIR: tempDir() },
      tempDir()
    );
    try {
      const response = await waitForHealth(`http://127.0.0.1:${port}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, decoder: true });
    } finally {
      server.child.kill('SIGTERM');
      await server.exited;
    }
  });

  it('invalid_config_stops_start', async () => {
    const server = startBuiltServer({ HTTP_PORT: String(await freePort()) }, tempDir());
    const code = await server.exited;
    expect(code).not.toBe(0);
    expect(server.output()).toContain('DATABASE_URL');
  });
});
