import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { decoderWorks } from './decoder-self-test.js';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true; decoder: boolean } {
    return { ok: true, decoder: decoderWorks() };
  }
}
