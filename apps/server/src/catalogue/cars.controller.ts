import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { CatalogueService } from './catalogue.service.js';

@Controller('cars')
export class CarsController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get(':carId')
  car(@Param('carId', ParseIntPipe) carId: number): { name: string } {
    const name = this.catalogue.carName(carId);
    if (name === null) throw new NotFoundException(`Car ${carId} is not in the catalogue`);
    return { name };
  }
}
