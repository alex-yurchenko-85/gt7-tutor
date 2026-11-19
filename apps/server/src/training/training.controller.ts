import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  armTrainingSchema,
  devReplaySchema,
  type ArmResponse,
  type ArmTrainingRequest,
  type DevReplayRequest,
  type ProfileUser
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReplayFileSelection } from '../captures/telemetry-source.factory.js';
import { TrainingService } from './training.service.js';

@Controller()
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly replayFiles: ReplayFileSelection,
    private readonly config: ConfigService
  ) {}

  @Post('training/arm')
  arm(@CurrentUser() user: ProfileUser, @Body({ schema: armTrainingSchema }) body: ArmTrainingRequest): Promise<ArmResponse> {
    return this.training.arm(user.id, body);
  }

  @Post('training/disarm')
  disarm(@CurrentUser() user: ProfileUser): Promise<{ ok: true }> {
    return this.training.disarm(user.id);
  }

  @Post('dev/replay')
  replay(@Body({ schema: devReplaySchema }) body: DevReplayRequest): { ok: true } {
    if (!this.config.getOrThrow<boolean>('DEV_REPLAY')) throw new NotFoundException();
    const path = join(this.config.getOrThrow<string>('FIXTURES_DIR'), `${body.fixture}.ndjson`);
    if (!existsSync(path)) throw new NotFoundException(`Fixture ${body.fixture} not found`);
    this.replayFiles.select(path);
    return { ok: true };
  }
}
