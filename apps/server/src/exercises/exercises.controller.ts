import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createExerciseSchema,
  updateExerciseSchema,
  type CreateExerciseRequest,
  type Exercise,
  type ProfileUser,
  type UpdateExerciseRequest
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ExercisesService } from './exercises.service.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Post()
  create(@CurrentUser() user: ProfileUser, @Body({ schema: createExerciseSchema }) body: CreateExerciseRequest): Promise<Exercise> {
    return this.exercises.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: ProfileUser): Promise<Exercise[]> {
    return this.exercises.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<Exercise> {
    return this.exercises.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: ProfileUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateExerciseSchema }) body: UpdateExerciseRequest
  ): Promise<Exercise> {
    return this.exercises.update(user.id, id, body);
  }
}
