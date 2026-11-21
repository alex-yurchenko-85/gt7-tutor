import { randomBytes } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogueSourceError, CatalogueValidationError, diffCatalogue, fetchCatalogue } from '@gt7/catalogue';
import type { Catalogue, CatalogueCheckResponse, CatalogueDiff } from '@gt7/contracts';
import { httpError } from '../http-errors.js';
import { CatalogueService } from './catalogue.service.js';
import { CATALOGUE_FETCH } from './catalogue.tokens.js';

export const CHECK_LIFETIME_MS = 10 * 60 * 1000;

type PendingUpdate = { next: Catalogue; diff: CatalogueDiff; base: Catalogue; expiresAt: number };

function updateFailed(detail: string): HttpException {
  return httpError(502, 'update-failed', { detail });
}

@Injectable()
export class CatalogueUpdateService {
  private readonly pending = new Map<string, PendingUpdate>();
  private busy = false;

  constructor(
    private readonly catalogue: CatalogueService,
    @Inject(CATALOGUE_FETCH) private readonly fetchFunction: typeof fetch,
    private readonly config: ConfigService
  ) {}

  async check(): Promise<CatalogueCheckResponse> {
    this.forgetExpired();
    const base = this.catalogue.active;
    const next = await this.fetchSources();
    const diff = diffCatalogue(base, next);
    const token = randomBytes(24).toString('base64url');
    this.pending.set(token, { next, diff, base, expiresAt: Date.now() + CHECK_LIFETIME_MS });
    return { token, diff };
  }

  async apply(token: string): Promise<void> {
    this.forgetExpired();
    const update = this.pending.get(token);
    if (!update) throw httpError(409, 'unknown-token');
    if (update.diff.rejected) throw httpError(409, 'rejected', update.diff.rejected);
    if (update.base !== this.catalogue.active) throw httpError(409, 'stale-check');
    await this.exclusively(async () => {
      await this.catalogue.files.save(update.next, update.base);
      this.catalogue.activate(update.next);
      this.pending.delete(token);
    });
  }

  async restore(): Promise<void> {
    if (!this.catalogue.files.hasPrevious()) throw httpError(409, 'no-previous');
    await this.exclusively(async () => {
      const previous = await this.catalogue.files.previous();
      await this.catalogue.files.restore(previous);
      this.catalogue.activate(previous);
      this.pending.clear();
    });
  }

  private async fetchSources(): Promise<Catalogue> {
    try {
      return await fetchCatalogue({
        fetch: this.fetchFunction,
        aliases: await this.catalogue.files.aliases(),
        timeoutMs: this.config.getOrThrow<number>('CATALOGUE_TIMEOUT_MS')
      });
    } catch (error) {
      if (error instanceof CatalogueSourceError || error instanceof CatalogueValidationError) throw updateFailed(error.message);
      throw error;
    }
  }

  private async exclusively(work: () => Promise<void>): Promise<void> {
    if (this.busy) throw httpError(409, 'catalogue-busy');
    this.busy = true;
    try {
      await work();
    } finally {
      this.busy = false;
    }
  }

  private forgetExpired(): void {
    const now = Date.now();
    for (const [token, update] of this.pending) if (update.expiresAt <= now) this.pending.delete(token);
  }
}
