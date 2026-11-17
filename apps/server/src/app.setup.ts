import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NextFunction, Request, Response } from 'express';

const SERVER_PATHS = ['/api', '/live', '/audio'];

function isServerPath(path: string): boolean {
  return SERVER_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

function looksLikeFile(path: string): boolean {
  return /\.[a-z0-9]+$/i.test(path.split('/').at(-1) ?? '');
}

function serveViewsFromIndex(indexFile: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.method !== 'GET' || isServerPath(request.path) || looksLikeFile(request.path) || !request.accepts('html')) return next();
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexFile);
  };
}

function serveStaticFiles(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  app.useStaticAssets(config.getOrThrow<string>('AUDIO_DIR'), { prefix: '/audio/', index: false, fallthrough: false });
  const webDir = config.getOrThrow<string>('WEB_DIR');
  const indexFile = join(webDir, 'index.html');
  if (!existsSync(indexFile)) return;
  app.useStaticAssets(webDir, { index: false });
  app.use(serveViewsFromIndex(indexFile));
}

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  serveStaticFiles(app as NestExpressApplication);
  app.enableShutdownHooks();
}
