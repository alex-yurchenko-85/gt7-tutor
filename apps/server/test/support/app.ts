import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { parseAppConfig } from '../../src/config/app-config.js';
import { tempDir } from './process.js';

export type TestAppOptions = {
  env?: Record<string, string>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
};

export async function createTestApp(databaseUrl: string, options: TestAppOptions = {}): Promise<INestApplication> {
  const config = parseAppConfig({ DATABASE_URL: databaseUrl, DATA_DIR: tempDir(), ...options.env });
  const builder = Test.createTestingModule({ imports: [AppModule.register(config)] });
  const moduleRef = await (options.override ? options.override(builder) : builder).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
