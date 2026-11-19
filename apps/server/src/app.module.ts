import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttemptsModule } from './attempts/attempts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CapturesModule } from './captures/captures.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { ClockModule } from './clock/mono-clock.js';
import { DemoModule } from './demo/demo.module.js';
import { ExercisesModule } from './exercises/exercises.module.js';
import type { AppConfig } from './config/app-config.js';
import { HealthModule } from './health/health.module.js';
import { HistoryModule } from './history/history.module.js';
import { ReferencesModule } from './references/references.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TrainingModule } from './training/training.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => config] }),
        StorageModule,
        ClockModule,
        AuthModule,
        SettingsModule,
        CatalogueModule,
        ExercisesModule,
        CapturesModule,
        ReferencesModule,
        TrainingModule,
        AttemptsModule,
        HistoryModule,
        HealthModule,
        DemoModule
      ]
    };
  }
}
