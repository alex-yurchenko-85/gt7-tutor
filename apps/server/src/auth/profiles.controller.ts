import { Body, Controller, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  changePasswordSchema,
  profileCredentialsSchema,
  type ChangePasswordRequest,
  type ProfileCredentials,
  type ProfileResponse,
  type ProfileUser
} from '@gt7/contracts';
import type { Request } from 'express';
import { NotInDemoGuard } from '../demo/not-in-demo.guard.js';
import { LiveHub } from '../live/live-hub.service.js';
import { AuthService, hashToken } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { sessionTokenOf } from './session-cookie.js';

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly auth: AuthService,
    private readonly hub: LiveHub
  ) {}

  @Post()
  async create(@Body({ schema: profileCredentialsSchema }) credentials: ProfileCredentials): Promise<ProfileResponse> {
    return { user: await this.auth.createProfile(credentials) };
  }

  @Put('me/password')
  @HttpCode(204)
  @UseGuards(NotInDemoGuard)
  async changePassword(
    @CurrentUser() user: ProfileUser,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordRequest,
    @Req() request: Request
  ): Promise<void> {
    const token = sessionTokenOf(request)!;
    await this.auth.changePassword(user, body, token, request.ip ?? request.socket.remoteAddress ?? 'unknown');
    this.hub.closeOtherSessions(user.id, hashToken(token));
  }
}
