import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CapturesModule } from '../captures/captures.module.js';
import { LiveGateway } from '../live/live.gateway.js';
import { LiveModule } from '../live/live.module.js';
import { ReferencesModule } from '../references/references.module.js';
import { TrainingController } from './training.controller.js';
import { TrainingService } from './training.service.js';

@Module({
  imports: [AuthModule, CapturesModule, ReferencesModule, LiveModule],
  controllers: [TrainingController],
  providers: [TrainingService, LiveGateway],
  exports: [TrainingService, LiveModule]
})
export class TrainingModule {}
