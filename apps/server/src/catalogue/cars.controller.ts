import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CatalogueService } from './catalogue.service.js';
import { httpError } from '../http-errors.js';

@Controller('cars')
export class CarsController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get(':carId')
  car(@Param('carId', ParseIntPipe) carId: number): { name: string } {
    const name = this.catalogue.carName(carId);
    if (name === null) throw httpError(404, 'not-found');
    return { name };
  }
}
