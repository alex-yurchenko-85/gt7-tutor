import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CapturesModule } from '../captures/captures.module.js';
import { LiveGateway } from '../live/live.gateway.js';
import { LiveModule } from '../live/live.module.js';
import { RacesModule } from '../races/races.module.js';
import { ReferencesModule } from '../references/references.module.js';
import { CuePreviewService } from './cue-preview.service.js';
import { TrainingController } from './training.controller.js';
import { TrainingService } from './training.service.js';

@Module({
  imports: [AttemptsModule, AuthModule, CapturesModule, ReferencesModule, LiveModule, RacesModule],
  controllers: [TrainingController],
  providers: [TrainingService, CuePreviewService, LiveGateway],
  exports: [TrainingService, LiveModule]
})
export class TrainingModule {}
