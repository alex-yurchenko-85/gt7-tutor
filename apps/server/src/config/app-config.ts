import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const committedCatalogueDir = fileURLToPath(new URL('../../../../catalogue', import.meta.url));
const committedAudioDir = fileURLToPath(new URL('../../../../audio', import.meta.url));
const committedWebDir = fileURLToPath(new URL('../../../../apps/web/dist', import.meta.url));
const fixturesDir = fileURLToPath(new URL('../../../../fixtures', import.meta.url));

const appConfigSchema = z.object({
  HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres://'),
  DATA_DIR: z.string().min(1).default('./data').transform(path => resolve(path)),
  TELEMETRY_SOURCE: z.enum(['udp', 'replay']).default('udp'),
  DEV_REPLAY: z.enum(['0', '1']).default('0').transform(value => value === '1'),
  DEMO_MODE: z.enum(['0', '1']).default('0').transform(value => value === '1'),
  CATALOGUE_DIR: z.string().min(1).default(committedCatalogueDir).transform(path => resolve(path)),
  CATALOGUE_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(30000),
  AUDIO_DIR: z.string().min(1).default(committedAudioDir).transform(path => resolve(path)),
  WEB_DIR: z.string().min(1).default(committedWebDir).transform(path => resolve(path)),
  FIXTURES_DIR: z.string().min(1).default(fixturesDir).transform(path => resolve(path))
}).refine(config => !config.DEMO_MODE || config.TELEMETRY_SOURCE === 'replay', {
  message: 'DEMO_MODE=1 needs TELEMETRY_SOURCE=replay',
  path: ['DEMO_MODE']
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export class InvalidConfigError extends Error {}

export function parseAppConfig(env: Record<string, unknown>): AppConfig {
  const result = appConfigSchema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
  throw new InvalidConfigError(`Invalid configuration. ${problems.join('; ')}. See .env.example.`);
}
