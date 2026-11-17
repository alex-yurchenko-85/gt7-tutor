import { ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthState, ProfileCredentials, ProfileUser } from '@gt7/contracts';
import type { Knex } from 'knex';
import { KNEX } from '../storage/knex.provider.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_LIFETIME_MS } from './session-cookie.js';
import { SignInLimiter } from './sign-in-limiter.js';

export type IssuedSession = { user: ProfileUser; token: string };

const UNIQUE_VIOLATION = '23505';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly limiter: SignInLimiter
  ) {}

  async state(token: string | null): Promise<AuthState> {
    const [user, hasUsers] = await Promise.all([this.userForToken(token), this.hasUsers()]);
    return { hasUsers, user };
  }

  async createFirstProfile(credentials: ProfileCredentials): Promise<IssuedSession> {
    const passwordHash = await hashPassword(credentials.password);
    const user = await this.db.transaction(async trx => {
      await trx.raw('lock table users in share row exclusive mode');
      const existing = await trx('users').first('id');
      if (existing) throw new ConflictException('A profile already exists. Sign in instead.');
      const [created] = await trx('users').insert({ name: credentials.name, password_hash: passwordHash }).returning(['id', 'name']);
      return created as ProfileUser;
    });
    return { user, token: await this.issueSession(user.id) };
  }

  async createProfile(credentials: ProfileCredentials): Promise<ProfileUser> {
    const passwordHash = await hashPassword(credentials.password);
    try {
      const [created] = await this.db('users').insert({ name: credentials.name, password_hash: passwordHash }).returning(['id', 'name']);
      return created as ProfileUser;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A profile with this name already exists.');
      throw error;
    }
  }

  async signIn(credentials: ProfileCredentials, address: string): Promise<IssuedSession> {
    if (this.limiter.isBlocked(credentials.name, address)) {
      throw new HttpException('Too many failed sign-in attempts. Wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const row = await this.db('users').where({ name: credentials.name }).first('id', 'name', 'password_hash');
    const valid = await verifyPassword(credentials.password, row?.password_hash ?? (await this.unknownUserHash()));
    if (!row || !valid) {
      this.limiter.recordFailure(credentials.name, address);
      throw new UnauthorizedException('Wrong name or password.');
    }
    this.limiter.clear(credentials.name, address);
    return { user: { id: row.id, name: row.name }, token: await this.issueSession(row.id) };
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.db('sessions').where({ token_hash: hashToken(token) }).delete();
  }

  async userForToken(token: string | null): Promise<ProfileUser | null> {
    if (!token) return null;
    const row = await this.db('sessions')
      .join('users', 'users.id', 'sessions.user_id')
      .where('sessions.token_hash', hashToken(token))
      .where('sessions.expires_at', '>', this.db.fn.now())
      .first('users.id as id', 'users.name as name');
    return row ? { id: row.id, name: row.name } : null;
  }

  private unknownUserHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }

  private async hasUsers(): Promise<boolean> {
    return (await this.db('users').first('id')) !== undefined;
  }

  private async issueSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db('sessions').where('expires_at', '<=', this.db.fn.now()).delete();
    await this.db('sessions').insert({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + SESSION_LIFETIME_MS)
    });
    return token;
  }
}
