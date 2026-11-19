import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createCaptureSchema, type CaptureInfo, type CleanupResult, type CreateCaptureRequest, type ProfileUser, type ReceptionCheck, type StorageUse } from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CaptureService } from './capture.service.js';
import { StorageService } from './storage.service.js';

@Controller()
export class CapturesController {
  constructor(
    private readonly captures: CaptureService,
    private readonly storage: StorageService
  ) {}

  @Post('captures')
  begin(@CurrentUser() user: ProfileUser, @Body({ schema: createCaptureSchema }) body: CreateCaptureRequest): Promise<CaptureInfo> {
    return this.captures.begin({ userId: user.id, exerciseId: body.exerciseId, purpose: body.purpose });
  }

  @Get('captures')
  list(@CurrentUser() user: ProfileUser): Promise<CaptureInfo[]> {
    return this.captures.list(user.id);
  }

  @Post('captures/:id/stop')
  stop(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<CaptureInfo> {
    return this.captures.stop(user.id, id);
  }

  @Post('settings/connection/check')
  @HttpCode(200)
  checkReception(): Promise<ReceptionCheck> {
    return this.captures.checkReception();
  }

  @Get('storage')
  use(@CurrentUser() user: ProfileUser): Promise<StorageUse> {
    return this.storage.use(user.id);
  }

  @Post('storage/cleanup')
  cleanup(@CurrentUser() user: ProfileUser): Promise<CleanupResult> {
    return this.storage.cleanup(user.id);
  }
}
