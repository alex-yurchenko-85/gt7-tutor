import { Module } from '@nestjs/common';
import { LiveHub } from './live-hub.service.js';

@Module({
  providers: [LiveHub],
  exports: [LiveHub]
})
export class LiveModule {}
