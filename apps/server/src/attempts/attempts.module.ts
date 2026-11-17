import { Module } from '@nestjs/common';
import { ReferencesModule } from '../references/references.module.js';
import { StatsController } from '../stats/stats.controller.js';
import { StatsService } from '../stats/stats.service.js';
import { AttemptsController } from './attempts.controller.js';
import { AttemptsService } from './attempts.service.js';

@Module({
  imports: [ReferencesModule],
  controllers: [AttemptsController, StatsController],
  providers: [AttemptsService, StatsService],
  exports: [AttemptsService]
})
export class AttemptsModule {}
