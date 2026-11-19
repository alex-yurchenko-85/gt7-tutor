import { Injectable, Logger, NotFoundException, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEMO_ATTEMPT_FIXTURES, DEMO_PROFILE, type AppInfo, type DemoAttemptResponse } from '@gt7/contracts';
import { ReplayFileSelection } from '../captures/telemetry-source.factory.js';
import { DemoSeed } from './demo-seed.js';

const REAL_TIME = 1;

@Injectable()
export class DemoService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(DemoService.name);
  private readonly enabled: boolean;
  private readonly consoleRequired: boolean;
  private ready = false;
  private turn = 0;
  private seeding: Promise<void> = Promise.resolve();

  constructor(
    config: ConfigService,
    private readonly seed: DemoSeed,
    private readonly replayFiles: ReplayFileSelection
  ) {
    this.enabled = config.getOrThrow<boolean>('DEMO_MODE');
    this.consoleRequired = config.getOrThrow<string>('TELEMETRY_SOURCE') === 'udp';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.seeding = this.seed
      .run()
      .then(() => {
        this.ready = true;
        this.logger.log('Demo data is ready');
      })
      .catch((error: unknown) => this.logger.error(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.seeding;
  }

  info(): AppInfo {
    const consoleRequired = this.consoleRequired;
    if (!this.enabled) return { demo: null, consoleRequired };
    return { demo: { profileName: DEMO_PROFILE.name, password: DEMO_PROFILE.password, ready: this.ready }, consoleRequired };
  }

  nextAttempt(): DemoAttemptResponse {
    if (!this.enabled) throw new NotFoundException();
    const fixture = DEMO_ATTEMPT_FIXTURES[this.turn % DEMO_ATTEMPT_FIXTURES.length]!;
    this.turn++;
    this.replayFiles.select(this.seed.fixturePath(fixture), REAL_TIME);
    return { fixture };
  }
}
