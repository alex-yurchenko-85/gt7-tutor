import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { InvalidConfigError, parseAppConfig } from './config/app-config.js';

const ENV_FILE = '.env';

async function bootstrap() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const config = parseAppConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config), { abortOnError: false });
  configureApp(app);
  await app.listen(config.HTTP_PORT, config.HTTP_HOST);
}

try {
  await bootstrap();
} catch (error) {
  if (!(error instanceof InvalidConfigError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
