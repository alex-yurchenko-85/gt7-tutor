import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const PASSWORD = 'correct horse';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.find(value => value.startsWith('gt7_session='))!.split(';')[0]!;
}

export async function firstProfile(app: INestApplication, name = 'Driver'): Promise<string> {
  const response = await request(app.getHttpServer()).post('/api/auth/first-profile').send({ name, password: PASSWORD }).expect(201);
  return cookieOf(response);
}

export async function anotherProfile(app: INestApplication, creator: string, name: string): Promise<string> {
  const http = () => request(app.getHttpServer());
  await http().post('/api/profiles').set('Cookie', creator).send({ name, password: PASSWORD }).expect(201);
  return cookieOf(await http().post('/api/auth/sign-in').send({ name, password: PASSWORD }).expect(200));
}
