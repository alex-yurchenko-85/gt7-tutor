import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CapturesModule } from '../captures/captures.module.js';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { ReferencesModule } from '../references/references.module.js';
import { TrainingModule } from '../training/training.module.js';
import { DemoController } from './demo.controller.js';
import { DemoSeed } from './demo-seed.js';
import { DemoService } from './demo.service.js';

@Module({
  imports: [AuthModule, CapturesModule, ExercisesModule, ReferencesModule, TrainingModule],
  controllers: [DemoController],
  providers: [DemoSeed, DemoService]
})
export class DemoModule {}
