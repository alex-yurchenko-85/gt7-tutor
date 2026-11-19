import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module.js';
import { CaptureService, RAW_STREAM_OPENER } from './capture.service.js';
import { CapturesController } from './captures.controller.js';
import { COUNTDOWN_SCHEDULER, CountdownService, timerScheduler } from './countdown.js';
import { SampleCache } from './sample-cache.js';
import { StorageService } from './storage.service.js';
import { ReplayFileSelection, telemetrySourceFactoryProvider } from './telemetry-source.factory.js';

@Module({
  imports: [LiveModule],
  controllers: [CapturesController],
  providers: [
    CaptureService,
    CountdownService,
    SampleCache,
    StorageService,
    ReplayFileSelection,
    telemetrySourceFactoryProvider,
    { provide: RAW_STREAM_OPENER, useValue: null },
    { provide: COUNTDOWN_SCHEDULER, useValue: timerScheduler }
  ],
  exports: [CaptureService, SampleCache, StorageService, ReplayFileSelection]
})
export class CapturesModule {}
