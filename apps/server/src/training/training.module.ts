import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CapturesModule } from '../captures/captures.module.js';
import { LiveHub } from '../live/live-hub.service.js';
import { LiveGateway } from '../live/live.gateway.js';
import { ReferencesModule } from '../references/references.module.js';
import { TrainingController } from './training.controller.js';
import { TrainingService } from './training.service.js';

@Module({
  imports: [AuthModule, CapturesModule, ReferencesModule],
  controllers: [TrainingController],
  providers: [TrainingService, LiveHub, LiveGateway],
  exports: [TrainingService, LiveHub]
})
export class TrainingModule {}
