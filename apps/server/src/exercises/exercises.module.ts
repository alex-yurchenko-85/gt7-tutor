import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesService } from './exercises.service.js';

@Module({
  imports: [CatalogueModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService]
})
export class ExercisesModule {}
