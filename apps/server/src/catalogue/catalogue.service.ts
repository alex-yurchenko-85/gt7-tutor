import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CATALOGUE_SOURCES } from '@gt7/catalogue';
import type { Car, Catalogue, CatalogueEntry, CatalogueInfo, CatalogueListEntry } from '@gt7/contracts';
import type { Knex } from 'knex';
import { exerciseStatuses, type ExerciseStatusSummary } from '../exercises/exercise-status.js';
import { KNEX } from '../storage/knex.provider.js';
import { CatalogueFiles } from './catalogue-files.js';

function latestExerciseByCatalogueId(statuses: ExerciseStatusSummary[]): Map<string, ExerciseStatusSummary> {
  const byCatalogueId = new Map<string, ExerciseStatusSummary>();
  for (const status of statuses) if (status.catalogueId !== null) byCatalogueId.set(status.catalogueId, status);
  return byCatalogueId;
}

@Injectable()
export class CatalogueService implements OnModuleInit {
  readonly files: CatalogueFiles;
  private readonly logger = new Logger(CatalogueService.name);
  private current: Catalogue | null = null;
  private carNames = new Map<number, string>();
  private entries = new Map<string, CatalogueEntry>();

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    config: ConfigService
  ) {
    this.files = new CatalogueFiles(config.getOrThrow<string>('CATALOGUE_DIR'), config.getOrThrow<string>('DATA_DIR'));
  }

  async onModuleInit(): Promise<void> {
    const loaded = await this.files.active(reason => this.logger.warn(`Saved catalogue ignored: ${reason}`));
    this.activate(loaded.catalogue);
  }

  get active(): Catalogue {
    if (!this.current) throw new Error('Catalogue not loaded');
    return this.current;
  }

  activate(catalogue: Catalogue): void {
    this.current = catalogue;
    this.carNames = new Map(catalogue.cars.map((car: Car) => [car.id, car.name]));
    this.entries = new Map(catalogue.entries.map(entry => [entry.id, entry]));
  }

  async info(): Promise<CatalogueInfo> {
    const entries: Record<string, number> = {};
    for (const entry of this.active.entries) entries[entry.family] = (entries[entry.family] ?? 0) + 1;
    return {
      retrieved: this.active.retrieved,
      gameVersionNote: this.active.gameVersionNote,
      counts: { entries, circuits: this.active.circuits.length, cars: this.active.cars.length },
      sources: CATALOGUE_SOURCES,
      hasPrevious: await this.files.hasPrevious(),
      previousRetrieved: await this.files.previousRetrieved()
    };
  }

  carName(carId: number): string | null {
    return this.carNames.get(carId) ?? null;
  }

  carIdByName(name: string | null): number | null {
    if (name === null) return null;
    return this.active.cars.find(car => car.name === name)?.id ?? null;
  }

  entry(id: string): CatalogueEntry | null {
    return this.entries.get(id) ?? null;
  }

  list(): CatalogueEntry[] {
    return this.active.entries;
  }

  async listFor(userId: string): Promise<CatalogueListEntry[]> {
    const exercises = latestExerciseByCatalogueId(await exerciseStatuses(this.db, userId));
    return this.list().map(entry => {
      const exercise = exercises.get(entry.id);
      return { ...entry, exerciseId: exercise?.exerciseId ?? null, status: exercise?.status ?? null };
    });
  }
}
