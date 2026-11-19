import { parseEnv } from 'node:util';

export const DEFAULT_DATABASE_URL = 'postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor';
export const DEMO_DATABASE = 'gt7_demo';
export const DEMO_DIR = '.demo';

export function configuredDatabaseUrl(env: NodeJS.ProcessEnv, envFileText: string | null): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (envFileText !== null) return parseEnv(envFileText).DATABASE_URL ?? DEFAULT_DATABASE_URL;
  return DEFAULT_DATABASE_URL;
}

export function withDatabaseName(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export function adminUrl(databaseUrl: string): string {
  return withDatabaseName(databaseUrl, 'postgres');
}

export function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}
