import { Module } from '@nestjs/common';
import { CaptureService, RAW_STREAM_OPENER } from './capture.service.js';
import { CapturesController } from './captures.controller.js';
import { SampleCache } from './sample-cache.js';
import { StorageService } from './storage.service.js';
import { ReplayFileSelection, telemetrySourceFactoryProvider } from './telemetry-source.factory.js';

@Module({
  controllers: [CapturesController],
  providers: [CaptureService, SampleCache, StorageService, ReplayFileSelection, telemetrySourceFactoryProvider, { provide: RAW_STREAM_OPENER, useValue: null }],
  exports: [CaptureService, SampleCache, ReplayFileSelection]
})
export class CapturesModule {}
