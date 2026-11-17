import { Module } from '@nestjs/common';
import { CarsController } from './cars.controller.js';
import { CatalogueUpdateService } from './catalogue-update.service.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { CATALOGUE_FETCH } from './catalogue.tokens.js';

const networkFetch: typeof fetch = (input, init) => fetch(input, init);

@Module({
  controllers: [CatalogueController, CarsController],
  providers: [CatalogueService, CatalogueUpdateService, { provide: CATALOGUE_FETCH, useValue: networkFetch }],
  exports: [CatalogueService]
})
export class CatalogueModule {}
