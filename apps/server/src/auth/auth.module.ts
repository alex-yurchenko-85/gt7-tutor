import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OriginGuard } from './origin.guard.js';
import { ProfilesController } from './profiles.controller.js';
import { SessionGuard } from './session.guard.js';
import { SignInLimiter } from './sign-in-limiter.js';

@Module({
  controllers: [AuthController, ProfilesController],
  providers: [AuthService, SignInLimiter, { provide: APP_GUARD, useClass: OriginGuard }, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService]
})
export class AuthModule {}
