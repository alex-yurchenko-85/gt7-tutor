import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CATALOGUE_SOURCES } from '@gt7/catalogue';
import type {
  Car,
  Catalogue,
  CatalogueEntry,
  CatalogueInfo,
  CatalogueListEntry,
  CatalogueQuery,
  Circuit,
  MedalTargetTimes,
  SupportState
} from '@gt7/contracts';
import type { Knex } from 'knex';
import { exerciseStatuses, type ExerciseStatusSummary } from '../exercises/exercise-status.js';
import { KNEX } from '../storage/knex.provider.js';
import { CatalogueFiles } from './catalogue-files.js';
import { importCatalogue } from './catalogue-import.js';

type EntryRow = {
  id: string;
  family: string;
  collection: string;
  code: string | null;
  name: string;
  track: string | null;
  circuit_id: string | null;
  car: string | null;
  targets: MedalTargetTimes | null;
  sections: number | null;
  source: string;
  support: SupportState;
};

function entryFromRow(row: EntryRow): CatalogueEntry {
  return {
    id: row.id,
    family: row.family,
    collection: row.collection,
    code: row.code,
    name: row.name,
    track: row.track,
    circuitId: row.circuit_id === null ? null : Number(row.circuit_id),
    car: row.car,
    targets: row.targets,
    sections: row.sections,
    source: row.source,
    support: row.support
  };
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

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
  private order = new Map<string, number>();

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    config: ConfigService
  ) {
    this.files = new CatalogueFiles(config.getOrThrow<string>('CATALOGUE_DIR'), config.getOrThrow<string>('DATA_DIR'));
  }

  async onModuleInit(): Promise<void> {
    const loaded = await this.files.active(reason => this.logger.warn(`Saved catalogue ignored: ${reason}`));
    await this.activate(loaded.catalogue);
  }

  get active(): Catalogue {
    if (!this.current) throw new Error('Catalogue not loaded');
    return this.current;
  }

  async activate(catalogue: Catalogue): Promise<void> {
    await importCatalogue(this.db, catalogue);
    this.current = catalogue;
    this.carNames = new Map(catalogue.cars.map((car: Car) => [car.id, car.name]));
    this.order = new Map(catalogue.entries.map((entry, index) => [entry.id, index]));
  }

  info(): CatalogueInfo {
    const entries: Record<string, number> = {};
    for (const entry of this.active.entries) entries[entry.family] = (entries[entry.family] ?? 0) + 1;
    return {
      retrieved: this.active.retrieved,
      gameVersionNote: this.active.gameVersionNote,
      counts: { entries, circuits: this.active.circuits.length, cars: this.active.cars.length },
      sources: CATALOGUE_SOURCES,
      hasPrevious: this.files.hasPrevious()
    };
  }

  circuits(): Circuit[] {
    return this.active.circuits;
  }

  carName(carId: number): string | null {
    return this.carNames.get(carId) ?? null;
  }

  carIdByName(name: string | null): number | null {
    if (name === null) return null;
    return this.active.cars.find(car => car.name === name)?.id ?? null;
  }

  async list(userId: string, query: CatalogueQuery): Promise<CatalogueListEntry[]> {
    const rows = await this.db<EntryRow>('catalogue_entries')
      .modify(builder => {
        if (query.family) builder.where('family', query.family);
        if (query.collection) builder.where('collection', query.collection);
        if (query.track) builder.where('track', query.track);
        if (query.support) builder.where('support', query.support);
        if (query.q) {
          const pattern = likePattern(query.q);
          builder.where(inner =>
            inner
              .whereILike('name', pattern)
              .orWhereILike('code', pattern)
              .orWhereILike('track', pattern)
              .orWhereILike('car', pattern)
              .orWhereILike('collection', pattern)
          );
        }
      })
      .select<EntryRow[]>('*');
    const exercises = latestExerciseByCatalogueId(await exerciseStatuses(this.db, userId));
    const position = (id: string) => this.order.get(id) ?? Number.MAX_SAFE_INTEGER;
    return rows
      .map(entryFromRow)
      .sort((left, right) => position(left.id) - position(right.id) || left.id.localeCompare(right.id))
      .map(entry => {
        const exercise = exercises.get(entry.id);
        return { ...entry, exerciseId: exercise?.exerciseId ?? null, status: exercise?.status ?? null };
      });
  }
}
