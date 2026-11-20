import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAppConfig } from '../../src/config/app-config.js';

describe('AppConfig', () => {
  it('defaults_follow_the_specification', () => {
    expect(parseAppConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })).toEqual({
      HTTP_HOST: '0.0.0.0',
      HTTP_PORT: 3000,
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      DATA_DIR: resolve('data'),
      TELEMETRY_SOURCE: 'udp',
      DEV_REPLAY: false,
      DEMO_MODE: false,
      CATALOGUE_DIR: fileURLToPath(new URL('../../../../content/catalogue', import.meta.url)),
      CATALOGUE_TIMEOUT_MS: 30000,
      AUDIO_DIR: fileURLToPath(new URL('../../../../content/audio', import.meta.url)),
      FIXTURES_DIR: fileURLToPath(new URL('../../../../fixtures', import.meta.url)),
      WEB_DIR: fileURLToPath(new URL('../../../web/dist', import.meta.url))
    });
  });

  it('invalid_values_name_the_variable', () => {
    expect(() => parseAppConfig({ DATABASE_URL: 'postgres://x', HTTP_PORT: 'abc' })).toThrow(/HTTP_PORT/);
    expect(() => parseAppConfig({ DATABASE_URL: 'postgres://x', TELEMETRY_SOURCE: 'tcp' })).toThrow(/TELEMETRY_SOURCE/);
    expect(() => parseAppConfig({ DATABASE_URL: 'postgres://x', DEV_REPLAY: 'yes' })).toThrow(/DEV_REPLAY/);
    expect(() => parseAppConfig({})).toThrow(/DATABASE_URL/);
  });

  it('dev_replay_and_loopback_are_configurable', () => {
    const config = parseAppConfig({ DATABASE_URL: 'postgres://x', HTTP_HOST: '127.0.0.1', DEV_REPLAY: '1', TELEMETRY_SOURCE: 'replay' });
    expect(config.HTTP_HOST).toBe('127.0.0.1');
    expect(config.DEV_REPLAY).toBe(true);
    expect(config.TELEMETRY_SOURCE).toBe('replay');
  });

  it('demo_mode_is_off_by_default', () => {
    expect(parseAppConfig({ DATABASE_URL: 'postgres://x' }).DEMO_MODE).toBe(false);
  });

  it('demo_mode_needs_the_replay_source', () => {
    expect(() => parseAppConfig({ DATABASE_URL: 'postgres://x', DEMO_MODE: '1' })).toThrow(/DEMO_MODE/);
    expect(() => parseAppConfig({ DATABASE_URL: 'postgres://x', DEMO_MODE: '1', TELEMETRY_SOURCE: 'udp' })).toThrow(/DEMO_MODE/);
    expect(parseAppConfig({ DATABASE_URL: 'postgres://x', DEMO_MODE: '1', TELEMETRY_SOURCE: 'replay' }).DEMO_MODE).toBe(true);
  });
});
