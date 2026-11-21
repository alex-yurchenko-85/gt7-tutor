import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Knex } from 'knex';
import { parseAppConfig, type AppConfig } from '../config/app-config.js';
import type { RaceRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { StorageModule } from '../storage/storage.module.js';
import { RaceImport } from './race-import.service.js';
import { RaceImportModule } from './race-import.module.js';

export type ImportedRace = {
  raceId: string;
  trackName: string | null;
  candidates: string[];
  laps: { number: number; timeMs: number }[];
  bestLap: number;
  bestLapMs: number;
  laterRace: boolean;
};

@Module({})
class RaceImportApp {
  static register(config: AppConfig): DynamicModule {
    return {
      module: RaceImportApp,
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => config] }), StorageModule, RaceImportModule]
    };
  }
}

export async function importRaceFile(env: Record<string, unknown>, userName: string, sourcePath: string): Promise<ImportedRace> {
  const context = await NestFactory.createApplicationContext(RaceImportApp.register(parseAppConfig(env)), { logger: ['error', 'warn'], abortOnError: false });
  try {
    const { raceId, laterRace } = await context.get(RaceImport).importFile(userName, sourcePath);
    const db = context.get<Knex>(KNEX);
    const race = (await db<RaceRow>('races').where({ id: raceId }).first())!;
    const laps = await db('race_laps').where({ race_id: raceId }).orderBy('number').select<{ number: number; time_ms: number }[]>('number', 'time_ms');
    return {
      raceId,
      trackName: race.track_name,
      candidates: race.track_candidates,
      laps: laps.map(lap => ({ number: lap.number, timeMs: lap.time_ms })),
      bestLap: race.best_lap,
      bestLapMs: race.best_lap_ms,
      laterRace
    };
  } finally {
    await context.close();
  }
}
