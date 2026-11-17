import { Body, Controller, Post } from '@nestjs/common';
import { profileCredentialsSchema, type ProfileCredentials, type ProfileResponse } from '@gt7/contracts';
import { AuthService } from './auth.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  async create(@Body({ schema: profileCredentialsSchema }) credentials: ProfileCredentials): Promise<ProfileResponse> {
    return { user: await this.auth.createProfile(credentials) };
  }
}
