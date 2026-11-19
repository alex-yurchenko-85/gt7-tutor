import { Module } from '@nestjs/common';
import { CapturesModule } from '../captures/captures.module.js';
import { ReferenceLocks } from './reference-locks.js';
import { ReferencesController } from './references.controller.js';
import { ReferencesService } from './references.service.js';

@Module({
  imports: [CapturesModule],
  controllers: [ReferencesController],
  providers: [ReferencesService, ReferenceLocks],
  exports: [ReferencesService, ReferenceLocks]
})
export class ReferencesModule {}
