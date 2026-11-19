import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lanAddresses, readyMessage } from './addresses.ts';
import { DEFAULT_DATABASE_URL, DEMO_DATABASE, demoDatabaseUrl, demoPlan, type DemoPlanEnv } from './demo-plan.ts';

const repoRoot = '/repo';
const baseEnv: DemoPlanEnv = { repoRoot, databaseUrl: DEFAULT_DATABASE_URL, built: false, demoFilesPresent: true };
const options = { reset: false, check: false, port: 3001 };

describe('pnpm demo plan', () => {
  it('plan_creates_database_and_starts_server_in_demo_mode', () => {
    const steps = demoPlan(options, baseEnv);
    expect(steps.map(step => step.kind)).toEqual(['db-up', 'create-database', 'migrate', 'build', 'start-server']);
    const server = steps.at(-1)!;
    expect(server).toEqual({
      kind: 'start-server',
      env: {
        DEMO_MODE: '1',
        TELEMETRY_SOURCE: 'replay',
        DEV_REPLAY: '0',
        HTTP_HOST: '0.0.0.0',
        HTTP_PORT: '3001',
        DATA_DIR: join(repoRoot, '.demo'),
        DATABASE_URL: 'postgres://gt7:gt7@127.0.0.1:5432/gt7_demo'
      }
    });
    expect(steps.find(step => step.kind === 'create-database')).toMatchObject({ name: DEMO_DATABASE });
  });

  it('plan_skips_build_when_dist_exists', () => {
    expect(demoPlan(options, { ...baseEnv, built: true }).map(step => step.kind)).not.toContain('build');
  });

  it('reset_drops_database_and_removes_demo_dir', () => {
    const steps = demoPlan({ ...options, reset: true }, { ...baseEnv, built: true });
    expect(steps.map(step => step.kind)).toEqual(['db-up', 'drop-database', 'remove-dir', 'create-database', 'migrate', 'start-server']);
    expect(steps[2]).toEqual({ kind: 'remove-dir', path: join(repoRoot, '.demo') });
  });

  it('missing_demo_files_start_the_demo_again', () => {
    const steps = demoPlan(options, { ...baseEnv, built: true, demoFilesPresent: false });
    expect(steps.map(step => step.kind)).toEqual(['db-up', 'drop-database', 'remove-dir', 'create-database', 'migrate', 'start-server']);
  });

  it('demo_dir_is_never_inside_data', () => {
    for (const step of demoPlan({ ...options, reset: true }, baseEnv)) {
      const paths = step.kind === 'remove-dir' ? [step.path] : step.kind === 'start-server' ? [step.env.DATA_DIR!] : [];
      for (const path of paths) expect(relative(join(repoRoot, 'data'), path).startsWith('..')).toBe(true);
    }
  });

  it('demo_database_url_keeps_credentials_and_host', () => {
    expect(demoDatabaseUrl('postgres://a:b@db.local:5544/other?sslmode=disable')).toBe('postgres://a:b@db.local:5544/gt7_demo?sslmode=disable');
  });
});

describe('pnpm demo addresses', () => {
  it('lan_addresses_skip_internal_and_ipv6', () => {
    const interfaces = {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '203.0.113.5', family: 'IPv4', internal: false }
      ],
      en1: [{ address: '192.168.1.20', family: 'IPv4', internal: false }]
    };
    expect(lanAddresses(interfaces)).toEqual(['192.168.1.20', '203.0.113.5']);
  });

  it('qr_code_is_printed_for_the_phone_address', () => {
    const text = readyMessage({ port: 3001, lan: ['192.168.1.20'], profileName: 'demo', password: 'demodemo' });
    expect(text).toContain('http://localhost:3001');
    expect(text).toContain('http://192.168.1.20:3001');
    expect(text).toMatch(/[█▀▄]/);
    expect(text).toContain('demodemo');
    expect(text).toContain('Use this device for voice');
  });

  it('without_a_network_address_there_is_no_phone_address', () => {
    const text = readyMessage({ port: 3001, lan: [], profileName: 'demo', password: 'demodemo' });
    expect(text).toContain('http://localhost:3001');
    expect(text).not.toMatch(/[█▀▄]/);
    expect(text).toContain('No network address');
  });
});
