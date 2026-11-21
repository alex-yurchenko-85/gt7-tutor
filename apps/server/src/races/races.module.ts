import { Module } from '@nestjs/common';
import { CapturesModule } from '../captures/captures.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { LiveModule } from '../live/live.module.js';
import { RaceImportModule } from './race-import.module.js';
import { RACE_SHUTDOWN_WAIT_MS, RaceRecorder, SHUTDOWN_SAVE_WAIT_MS } from './race-recorder.service.js';
import { RacesController } from './races.controller.js';
import { RacesService } from './races.service.js';

@Module({
  imports: [CapturesModule, CatalogueModule, LiveModule, RaceImportModule],
  controllers: [RacesController],
  providers: [RaceRecorder, RacesService, { provide: RACE_SHUTDOWN_WAIT_MS, useValue: SHUTDOWN_SAVE_WAIT_MS }],
  exports: [RaceRecorder]
})
export class RacesModule {}
