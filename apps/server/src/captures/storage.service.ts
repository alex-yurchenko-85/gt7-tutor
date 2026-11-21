import { createWriteStream, existsSync, statSync } from 'node:fs';
import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readRaw } from '@gt7/capture';
import { clockWarmupStart } from '@gt7/core';
import type { CleanupResult, RawRange, StorageUse } from '@gt7/contracts';
import type { Knex } from 'knex';
import type { CaptureRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { CaptureService } from './capture.service.js';
import { SampleCache } from './sample-cache.js';

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function inside(ranges: RawRange[], rawIndex: number): boolean {
  return ranges.some(range => rawIndex >= clockWarmupStart(range.first) && rawIndex <= range.last);
}

async function rewriteKeeping(path: string, ranges: RawRange[]): Promise<void> {
  const temporary = `${path}.cleanup-${process.pid}.tmp`;
  const output = createWriteStream(temporary, { flags: 'wx' });
  for await (const row of readRaw(path)) {
    if (inside(ranges, row.rawIndex) && !output.write(`${JSON.stringify(row)}\n`)) {
      await once(output, 'drain');
    }
  }
  output.end();
  await finished(output);
  await rename(temporary, path);
}

@Injectable()
export class StorageService {
  private readonly rawDir: string;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly captures: CaptureService,
    private readonly samples: SampleCache,
    config: ConfigService
  ) {
    this.rawDir = join(config.getOrThrow<string>('DATA_DIR'), 'raw');
  }

  async use(userId: string): Promise<StorageUse> {
    const rows = await this.db<CaptureRow>('captures').where({ user_id: userId });
    const profileRawBytes = rows.reduce((total, row) => total + fileSize(this.captures.rawPath(row)), 0);
    return { rawBytes: await this.directoryBytes(), profileRawBytes, profileCaptures: rows.length };
  }

  async cleanup(userId: string): Promise<CleanupResult> {
    const rows = (await this.db<CaptureRow>('captures').where({ user_id: userId })).filter(row => !this.captures.inUse(row.id));
    const result: CleanupResult = { captures: 0, bytesBefore: 0, bytesAfter: 0 };
    for (const row of rows) {
      const path = this.captures.rawPath(row);
      if (!existsSync(path)) continue;
      result.bytesBefore += fileSize(path);
      await rewriteKeeping(path, await this.usedRanges(row.id));
      this.samples.forget(row.id);
      result.bytesAfter += fileSize(path);
      result.captures++;
    }
    return result;
  }

  async removeFiles(rows: Pick<CaptureRow, 'raw_path'>[]): Promise<CleanupResult> {
    const result: CleanupResult = { captures: 0, bytesBefore: 0, bytesAfter: 0 };
    for (const row of rows) {
      const path = this.captures.rawPath(row);
      if (!existsSync(path)) continue;
      result.bytesBefore += fileSize(path);
      await unlink(path);
      result.captures++;
    }
    return result;
  }

  private async usedRanges(captureId: string): Promise<RawRange[]> {
    const select = (table: string) =>
      this.db(table).where({ capture_id: captureId }).select<{ first: number; last: number }[]>('first_raw_index as first', 'last_raw_index as last');
    return [...(await select('references')), ...(await select('attempts')), ...(await select('races'))];
  }

  private async directoryBytes(): Promise<number> {
    if (!existsSync(this.rawDir)) return 0;
    const names = await readdir(this.rawDir);
    const sizes = await Promise.all(names.map(async name => (await stat(join(this.rawDir, name))).size));
    return sizes.reduce((total, size) => total + size, 0);
  }
}
