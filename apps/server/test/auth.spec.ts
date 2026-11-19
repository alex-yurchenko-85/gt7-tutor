import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { openLive } from './support/live.js';

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

  it('profiles_list_needs_no_session_and_shows_names_only', async () => {
    expect((await http().get('/api/auth/profiles').expect(200)).body).toEqual([]);
    const cookie = await firstProfile();
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'maria', password: 'second password' }).expect(201);
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'alex', password: 'third password' }).expect(201);
    const response = await http().get('/api/auth/profiles').expect(200);
    expect(response.body).toEqual([{ name: 'alex' }, { name: 'Driver' }, { name: 'maria' }]);
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

  it('change_password_needs_current_password', async () => {
    const cookie = await firstProfile();
    const response = await http()
      .put('/api/profiles/me/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'wrong password', newPassword: 'new password 1' })
      .expect(403);
    expect(response.body.code).toBe('wrong-password');
    await http().post('/api/auth/sign-in').send(credentials).expect(200);
  });

  it('new_password_works_old_fails', async () => {
    const cookie = await firstProfile();
    await http()
      .put('/api/profiles/me/password')
      .set('Cookie', cookie)
      .send({ currentPassword: credentials.password, newPassword: 'new password 1' })
      .expect(204);
    await http().post('/api/auth/sign-in').send(credentials).expect(401);
    await http().post('/api/auth/sign-in').send({ name: credentials.name, password: 'new password 1' }).expect(200);
  });

  it('change_password_closes_the_live_connections_of_other_sessions', async () => {
    const cookie = await firstProfile();
    const other = cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send(credentials).expect(200)));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const mine = await openLive(port, cookie);
    const theirs = await openLive(port, other);
    await mine.waitFor('state');
    await theirs.waitFor('state');
    let mineClosed = false;
    void mine.closed.then(() => (mineClosed = true));
    await http()
      .put('/api/profiles/me/password')
      .set('Cookie', cookie)
      .send({ currentPassword: credentials.password, newPassword: 'new password 1' })
      .expect(204);
    expect((await theirs.closed).code).toBe(4401);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(mineClosed).toBe(false);
    await mine.close();
  });

  it('change_password_signs_out_other_sessions', async () => {
    const cookie = await firstProfile();
    const other = cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send(credentials).expect(200)));
    await http()
      .put('/api/profiles/me/password')
      .set('Cookie', cookie)
      .send({ currentPassword: credentials.password, newPassword: 'new password 1' })
      .expect(204);
    await http().get('/api/exercises').set('Cookie', other).expect(401);
    await http().get('/api/exercises').set('Cookie', cookie).expect(200);
  });

  it('change_password_needs_session', async () => {
    await firstProfile();
    await http().put('/api/profiles/me/password').send({ currentPassword: credentials.password, newPassword: 'new password 1' }).expect(401);
  });

  it('change_password_rejects_a_short_new_password', async () => {
    const cookie = await firstProfile();
    await http().put('/api/profiles/me/password').set('Cookie', cookie).send({ currentPassword: credentials.password, newPassword: 'short' }).expect(400);
  });

  it('change_password_limits_wrong_current_passwords', async () => {
    const cookie = await firstProfile();
    const change = (currentPassword: string) =>
      http().put('/api/profiles/me/password').set('Cookie', cookie).send({ currentPassword, newPassword: 'new password 1' });
    for (let attempt = 0; attempt < 5; attempt++) await change('wrong password').expect(403);
    await change('wrong password').expect(429);
    await change(credentials.password).expect(429);
  });

  it('expired_session_is_rejected', async () => {
    const cookie = await firstProfile();
    await db('sessions').update({ expires_at: db.raw("now() - interval '1 second'") });
    await http().post('/api/profiles').set('Cookie', cookie).send({ name: 'Second', password: 'second password' }).expect(401);
    const state = await http().get('/api/auth/state').set('Cookie', cookie).expect(200);
    expect(state.body.user).toBeNull();
  });
});
