import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEMO_ATTEMPT_FIXTURES, DEMO_PROFILE } from '@gt7/contracts';
import type { Knex } from 'knex';
import { AuthService } from '../auth/auth.service.js';
import { CaptureService } from '../captures/capture.service.js';
import { ReplayFileSelection } from '../captures/telemetry-source.factory.js';
import { ExercisesService } from '../exercises/exercises.service.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { TrainingService } from '../training/training.service.js';

export const DEMO_CATALOGUE_ID = 'ce-autodromo-de-interlagos-s2';
export const DEMO_TARGET_MS = 16400;
export const DEMO_REFERENCE = { fixture: 'demo-a', first: 457, last: 1422 } as const;
const AS_FAST_AS_POSSIBLE = 0;

@Injectable()
export class DemoSeed {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly exercises: ExercisesService,
    private readonly captures: CaptureService,
    private readonly references: ReferencesService,
    private readonly training: TrainingService,
    private readonly replayFiles: ReplayFileSelection
  ) {}

  fixturePath(name: string): string {
    return join(this.config.getOrThrow<string>('FIXTURES_DIR'), `${name}.ndjson`);
  }

  async run(): Promise<void> {
    if (await this.db('users').where({ name: DEMO_PROFILE.name }).first('id')) return;
    const user = await this.auth.createProfile(DEMO_PROFILE);
    const exercise = await this.exercises.create(user.id, { catalogueId: DEMO_CATALOGUE_ID });
    await this.exercises.update(user.id, exercise.id, { targetMs: DEMO_TARGET_MS });
    const captureId = await this.recordDemonstration(user.id, exercise.id);
    const reference = await this.references.create(user.id, {
      exerciseId: exercise.id,
      captureId,
      first: DEMO_REFERENCE.first,
      last: DEMO_REFERENCE.last
    });
    await this.references.activate(user.id, reference.id);
    for (const fixture of DEMO_ATTEMPT_FIXTURES) await this.driveAttempt(user.id, exercise.id, fixture);
  }

  private async recordDemonstration(userId: string, exerciseId: string): Promise<string> {
    this.replayFiles.select(this.fixturePath(DEMO_REFERENCE.fixture), AS_FAST_AS_POSSIBLE);
    const capture = await this.captures.begin({ userId, exerciseId, purpose: 'demo' });
    await this.replayFiles.lastReplayFinished();
    await this.captures.stop(userId, capture.id);
    return capture.id;
  }

  private async driveAttempt(userId: string, exerciseId: string, fixture: string): Promise<void> {
    this.replayFiles.select(this.fixturePath(fixture), AS_FAST_AS_POSSIBLE);
    await this.training.arm(userId, { exerciseId });
    await this.replayFiles.lastReplayFinished();
    await this.training.idle();
    await this.training.disarm(userId);
    await this.training.idle();
  }
}
