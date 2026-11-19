import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIE } from '../../src/auth/session-cookie.js';

export const PASSWORD = 'correct horse';

export function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error(`No ${SESSION_COOKIE} cookie`);
  return cookie;
}

export function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

export async function firstProfile(app: INestApplication, name = 'Driver'): Promise<string> {
  const response = await request(app.getHttpServer()).post('/api/auth/first-profile').send({ name, password: PASSWORD }).expect(201);
  return cookiePair(sessionCookie(response));
}

export async function anotherProfile(app: INestApplication, creator: string, name: string): Promise<string> {
  const http = () => request(app.getHttpServer());
  await http().post('/api/profiles').set('Cookie', creator).send({ name, password: PASSWORD }).expect(201);
  return cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send({ name, password: PASSWORD }).expect(200)));
}
