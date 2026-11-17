import { join } from 'node:path';

export const DEMO_DATABASE = 'gt7_demo';
export const DEMO_DIR = '.demo';
export const DEFAULT_DATABASE_URL = 'postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor';

export type DemoOptions = { reset: boolean; check: boolean; port: number };

export type DemoPlanEnv = { repoRoot: string; databaseUrl: string; built: boolean; demoFilesPresent: boolean };

export type DemoStep =
  | { kind: 'db-up' }
  | { kind: 'drop-database'; name: string }
  | { kind: 'remove-dir'; path: string }
  | { kind: 'create-database'; name: string }
  | { kind: 'migrate'; databaseUrl: string }
  | { kind: 'build' }
  | { kind: 'start-server'; env: Record<string, string> };

export function demoDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${DEMO_DATABASE}`;
  return url.toString();
}

export function demoPlan(options: DemoOptions, env: DemoPlanEnv): DemoStep[] {
  const databaseUrl = demoDatabaseUrl(env.databaseUrl);
  const dataDir = join(env.repoRoot, DEMO_DIR);
  const reset: DemoStep[] = options.reset || !env.demoFilesPresent
    ? [
        { kind: 'drop-database', name: DEMO_DATABASE },
        { kind: 'remove-dir', path: dataDir }
      ]
    : [];
  const build: DemoStep[] = env.built ? [] : [{ kind: 'build' }];
  return [
    { kind: 'db-up' },
    ...reset,
    { kind: 'create-database', name: DEMO_DATABASE },
    { kind: 'migrate', databaseUrl },
    ...build,
    {
      kind: 'start-server',
      env: {
        DEMO_MODE: '1',
        TELEMETRY_SOURCE: 'replay',
        DEV_REPLAY: '0',
        HTTP_HOST: '0.0.0.0',
        HTTP_PORT: String(options.port),
        DATA_DIR: dataDir,
        DATABASE_URL: databaseUrl
      }
    }
  ];
}
