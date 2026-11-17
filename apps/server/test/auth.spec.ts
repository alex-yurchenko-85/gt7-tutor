import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';

const credentials = { name: 'Driver', password: 'correct horse' };

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find(value => value.startsWith('gt7_session='));
  if (!cookie) throw new Error('No gt7_session cookie');
  return cookie;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

describe('profiles and sessions', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
  });

  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  beforeEach(async () => {
    await db.raw('truncate table sessions, users cascade');
    app = await createTestApp(database.url);
  });

  afterEach(async () => {
    await app.close();
  });

  async function firstProfile() {
    const response = await http().post('/api/auth/first-profile').send(credentials).expect(201);
    return cookiePair(sessionCookie(response));
  }

  it('state_reports_empty_installation', async () => {
    const response = await http().get('/api/auth/state').expect(200);
    expect(response.body).toEqual({ hasUsers: false, user: null });
  });

  it('first_profile_only_when_empty', async () => {
    const cookie = await firstProfile();
    const state = await http().get('/api/auth/state').set('Cookie', cookie).expect(200);
    expect(state.body).toEqual({ hasUsers: true, user: { id: expect.any(String), name: 'Driver' } });
    await http().post('/api/auth/first-profile').send({ name: 'Other', password: 'another password' }).expect(409);
  });

  it('profiles_need_session', async () => {
    await firstProfile();
    await http().post('/api/profiles').send({ name: 'Second', password: 'second password' }).expect(401);
  });

  it('signed_in_user_creates_profile', async () => {
    const cookie = await firstProfile();
    const response = await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'Second', password: 'second password' }).expect(201);
    expect(response.body).toEqual({ user: { id: expect.any(String), name: 'Second' } });
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'Second', password: 'second password' }).expect(409);
  });

  it('password_is_scrypt_and_not_stored_plain', async () => {
    await firstProfile();
    const row = await db('users').where({ name: 'Driver' }).first();
    expect(row.password_hash).not.toContain(credentials.password);
    expect(row.password_hash).toMatch(/^scrypt\$/);
  });

  it('sign_in_sets_http_only_lax_cookie', async () => {
    await firstProfile();
    const response = await http().post('/api/auth/sign-in').send(credentials).expect(200);
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(response.body).toEqual({ user: { id: expect.any(String), name: 'Driver' } });
    const token = cookiePair(cookie).split('=')[1]!;
    const stored = await db('sessions').select('token_hash');
    expect(stored.map(row => row.token_hash)).not.toContain(token);
  });

  it('wrong_password_is_401', async () => {
    await firstProfile();
    const response = await http().post('/api/auth/sign-in').send({ ...credentials, password: 'wrong password' }).expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('invalid_body_is_400', async () => {
    await http().post('/api/auth/first-profile').send({ name: '', password: 'short' }).expect(400);
    await http().post('/api/auth/first-profile').send({ name: 'x'.repeat(41), password: 'long enough' }).expect(400);
  });

  it('sixth_failed_sign_in_returns_429', async () => {
    await firstProfile();
    for (let attempt = 0; attempt < 5; attempt++) {
      await http().post('/api/auth/sign-in').send({ ...credentials, password: 'wrong password' }).expect(401);
    }
    await http().post('/api/auth/sign-in').send({ ...credentials, password: 'wrong password' }).expect(429);
    await http().post('/api/auth/sign-in').send(credentials).expect(429);
  });

  it('sign_out_ends_session', async () => {
    const cookie = await firstProfile();
    const response = await http().post('/api/auth/sign-out').set('Cookie', cookie).expect(204);
    expect(sessionCookie(response)).toMatch(/gt7_session=;/);
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'Second', password: 'second password' }).expect(401);
  });

  it('foreign_origin_mutation_is_rejected', async () => {
    await firstProfile();
    await http().post('/api/auth/sign-in').set('Origin', 'http://evil.example').send(credentials).expect(403);
    await http().post('/api/auth/sign-in').set('Host', 'gt7.local:3000').set('Origin', 'http://gt7.local:3000').send(credentials).expect(200);
  });

  it('sign_in_removes_expired_sessions', async () => {
    await firstProfile();
    await db('sessions').update({ expires_at: db.raw("now() - interval '1 second'") });
    await http().post('/api/auth/sign-in').send(credentials).expect(200);
    const rows = await db('sessions').where('expires_at', '<=', db.fn.now());
    expect(rows).toEqual([]);
    expect(await db('sessions').count<{ count: string }[]>('* as count')).toEqual([{ count: '1' }]);
  });

  it('expired_session_is_rejected', async () => {
    const cookie = await firstProfile();
    await db('sessions').update({ expires_at: db.raw("now() - interval '1 second'") });
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'Second', password: 'second password' }).expect(401);
    const state = await http().get('/api/auth/state').set('Cookie', cookie).expect(200);
    expect(state.body.user).toBeNull();
  });
});
