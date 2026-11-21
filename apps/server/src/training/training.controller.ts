import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  armTrainingSchema,
  devReplaySchema,
  type ArmResponse,
  type ArmTrainingRequest,
  type CuePreview,
  type DevReplayRequest,
  type ProfileUser
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReplayFileSelection } from '../captures/telemetry-source.factory.js';
import { CuePreviewService } from './cue-preview.service.js';
import { TrainingService } from './training.service.js';
import { httpError } from '../http-errors.js';

@Controller()
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly previews: CuePreviewService,
    private readonly replayFiles: ReplayFileSelection,
    private readonly config: ConfigService
  ) {}

  @Post('training/arm')
  arm(@CurrentUser() user: ProfileUser, @Body({ schema: armTrainingSchema }) body: ArmTrainingRequest): Promise<ArmResponse> {
    return this.training.arm(user.id, body);
  }

  @Get('references/:id/preview')
  preview(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<CuePreview> {
    return this.previews.preview(user.id, id);
  }

  @Post('training/disarm')
  disarm(@CurrentUser() user: ProfileUser): Promise<{ ok: true }> {
    return this.training.disarm(user.id);
  }

  @Post('dev/replay')
  replay(@Body({ schema: devReplaySchema }) body: DevReplayRequest): { ok: true } {
    if (!this.config.getOrThrow<boolean>('DEV_REPLAY')) throw new NotFoundException();
    const path = join(this.config.getOrThrow<string>('FIXTURES_DIR'), `${body.fixture}.ndjson`);
    if (!existsSync(path)) throw httpError(404, 'not-found');
    this.replayFiles.select(path);
    return { ok: true };
  }
}
