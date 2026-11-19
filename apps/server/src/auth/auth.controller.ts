import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { profileCredentialsSchema, type AuthState, type ProfileCard, type ProfileCredentials, type ProfileResponse } from '@gt7/contracts';
import type { Request, Response } from 'express';
import { AuthService, type IssuedSession } from './auth.service.js';
import { Public } from './public.decorator.js';
import { SESSION_COOKIE, SESSION_LIFETIME_MS, sessionCookieOptions, sessionTokenOf } from './session-cookie.js';

function setSessionCookie(response: Response, session: IssuedSession): ProfileResponse {
  response.cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, maxAge: SESSION_LIFETIME_MS });
  return { user: session.user };
}

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('state')
  state(@Req() request: Request): Promise<AuthState> {
    return this.auth.state(sessionTokenOf(request));
  }

  @Get('profiles')
  profiles(): Promise<ProfileCard[]> {
    return this.auth.profileCards();
  }

  @Post('first-profile')
  async firstProfile(
    @Body({ schema: profileCredentialsSchema }) credentials: ProfileCredentials,
    @Res({ passthrough: true }) response: Response
  ): Promise<ProfileResponse> {
    return setSessionCookie(response, await this.auth.createFirstProfile(credentials));
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body({ schema: profileCredentialsSchema }) credentials: ProfileCredentials,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ProfileResponse> {
    return setSessionCookie(response, await this.auth.signIn(credentials, request.ip ?? request.socket.remoteAddress ?? 'unknown'));
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.signOut(sessionTokenOf(request));
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  }
}
