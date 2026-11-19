import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  catalogueApplySchema,
  catalogueQuerySchema,
  type CatalogueApplyRequest,
  type CatalogueCheckResponse,
  type CatalogueInfo,
  type CatalogueListEntry,
  type CatalogueQuery,
  type Circuit,
  type ProfileUser
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CatalogueUpdateService } from './catalogue-update.service.js';
import { CatalogueService } from './catalogue.service.js';
import { NotInDemoGuard } from '../demo/not-in-demo.guard.js';

@Controller('catalogue')
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly updates: CatalogueUpdateService
  ) {}

  @Get()
  list(@CurrentUser() user: ProfileUser, @Query({ schema: catalogueQuerySchema }) query: CatalogueQuery): Promise<CatalogueListEntry[]> {
    return this.catalogue.list(user.id, query);
  }

  @Get('info')
  info(): Promise<CatalogueInfo> {
    return this.catalogue.info();
  }

  @Get('circuits')
  circuits(): Circuit[] {
    return this.catalogue.circuits();
  }

  @Post('update/check')
  @UseGuards(NotInDemoGuard)
  check(): Promise<CatalogueCheckResponse> {
    return this.updates.check();
  }

  @Post('update/apply')
  @UseGuards(NotInDemoGuard)
  async apply(@Body({ schema: catalogueApplySchema }) body: CatalogueApplyRequest): Promise<{ ok: true }> {
    await this.updates.apply(body.token);
    return { ok: true };
  }

  @Post('update/restore')
  @UseGuards(NotInDemoGuard)
  async restore(): Promise<{ ok: true }> {
    await this.updates.restore();
    return { ok: true };
  }
}
