import { describe, expect, it } from 'vitest';
import { adminUrl, configuredDatabaseUrl, databaseName, DEFAULT_DATABASE_URL, DEMO_DATABASE, DEMO_DIR, withDatabaseName } from './database.ts';

describe('database helpers', () => {
  it('database_constants_have_the_agreed_values', () => {
    expect(DEFAULT_DATABASE_URL).toBe('postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor');
    expect(DEMO_DATABASE).toBe('gt7_demo');
    expect(DEMO_DIR).toBe('.demo');
  });

  it('configured_database_url_prefers_process_env_then_env_file_then_default', () => {
    const file = 'DATABASE_URL=postgres://file:file@host:5432/from_file\n';
    expect(configuredDatabaseUrl({ DATABASE_URL: 'postgres://env@host/from_env' }, file)).toBe('postgres://env@host/from_env');
    expect(configuredDatabaseUrl({}, file)).toBe('postgres://file:file@host:5432/from_file');
    expect(configuredDatabaseUrl({}, 'PORT=1\n')).toBe(DEFAULT_DATABASE_URL);
    expect(configuredDatabaseUrl({}, null)).toBe(DEFAULT_DATABASE_URL);
  });

  it('with_database_name_changes_only_the_path', () => {
    expect(withDatabaseName('postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor?sslmode=disable', DEMO_DATABASE)).toBe('postgres://gt7:gt7@127.0.0.1:5432/gt7_demo?sslmode=disable');
  });

  it('admin_url_points_at_the_postgres_database', () => {
    expect(adminUrl('postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor')).toBe('postgres://gt7:gt7@127.0.0.1:5432/postgres');
  });

  it('database_name_decodes_the_path', () => {
    expect(databaseName('postgres://gt7:gt7@127.0.0.1:5432/gt7%5Ftutor')).toBe('gt7_tutor');
  });
});
