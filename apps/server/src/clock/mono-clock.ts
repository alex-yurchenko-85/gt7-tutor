import { Global, Module } from '@nestjs/common';

export const MONO_CLOCK = Symbol('MONO_CLOCK');

export type MonoClock = { now(): number };

export const performanceClock: MonoClock = { now: () => performance.now() };

@Global()
@Module({
  providers: [{ provide: MONO_CLOCK, useValue: performanceClock }],
  exports: [MONO_CLOCK]
})
export class ClockModule {}
