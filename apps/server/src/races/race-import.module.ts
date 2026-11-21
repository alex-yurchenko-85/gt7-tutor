import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { RaceImport } from './race-import.service.js';
import { RaceStore } from './race-store.js';

@Module({
  imports: [CatalogueModule],
  providers: [RaceStore, RaceImport],
  exports: [RaceStore, RaceImport]
})
export class RaceImportModule {}
