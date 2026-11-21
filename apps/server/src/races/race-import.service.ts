import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readRaw, readSamples } from '@gt7/capture';
import { DEFAULT_CONFIG, analyseRace } from '@gt7/core';
import type { Knex } from 'knex';
import { rawFilePath } from '../captures/capture.service.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { RaceStore, trackCandidateNames } from './race-store.js';

class RaceImportError extends Error {}

type CopiedFile = { rows: number; firstUnixMs: number; lastUnixMs: number; unixMsByRawIndex: Map<number, number> };

async function copyRows(sourcePath: string, targetPath: string, captureId: string): Promise<CopiedFile> {
  const copied: CopiedFile = { rows: 0, firstUnixMs: 0, lastUnixMs: 0, unixMsByRawIndex: new Map() };
  async function* lines(): AsyncIterable<string> {
    for await (const row of readRaw(sourcePath)) {
      if (copied.rows === 0) copied.firstUnixMs = row.receivedUnixMs;
      copied.lastUnixMs = row.receivedUnixMs;
      copied.unixMsByRawIndex.set(row.rawIndex, row.receivedUnixMs);
      copied.rows++;
      yield `${JSON.stringify({ ...row, captureId, peerIp: '0.0.0.0' })}\n`;
    }
  }
  await pipeline(lines, createWriteStream(targetPath, { flags: 'wx' }));
  return copied;
}

@Injectable()
export class RaceImport {
  private readonly dataDir: string;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly catalogue: CatalogueService,
    private readonly store: RaceStore,
    config: ConfigService
  ) {
    this.dataDir = config.getOrThrow<string>('DATA_DIR');
  }

  async importFile(userName: string, sourcePath: string): Promise<{ raceId: string; laterRace: boolean }> {
    const user = await this.db('users').where({ name: userName }).first<{ id: string } | undefined>('id');
    if (!user) throw new RaceImportError(`No profile is named ${userName}.`);
    if (!existsSync(sourcePath)) throw new RaceImportError(`The file does not exist: ${sourcePath}`);
    const captureId = randomUUID();
    const rawPath = rawFilePath(new Date(), 'race', captureId);
    const targetPath = join(this.dataDir, rawPath);
    await mkdir(join(this.dataDir, 'raw'), { recursive: true });
    try {
      const copied = await copyRows(sourcePath, targetPath, captureId);
      const samples = await readSamples(targetPath);
      const analysis = analyseRace(samples, DEFAULT_CONFIG);
      if (analysis === null) throw new RaceImportError('No race with a complete lap is in the file.');
      const candidates = trackCandidateNames(analysis, this.catalogue.active.circuits);
      const raceId = await this.db.transaction(async trx => {
        await trx('captures').insert({
          id: captureId,
          user_id: user.id,
          exercise_id: null,
          purpose: 'race',
          raw_path: rawPath,
          started_at: new Date(copied.firstUnixMs),
          ended_at: new Date(copied.lastUnixMs),
          packets: copied.rows,
          complete: true
        });
        const startedAt = new Date(copied.unixMsByRawIndex.get(analysis.range.first)!);
        return this.store.save(user.id, captureId, analysis, candidates, samples, { trx, startedAt });
      });
      const later = samples.filter(sample => sample.rawIndex > analysis.range.last);
      return { raceId, laterRace: analyseRace(later, DEFAULT_CONFIG) !== null };
    } catch (error) {
      await rm(targetPath, { force: true });
      throw error;
    }
  }
}
