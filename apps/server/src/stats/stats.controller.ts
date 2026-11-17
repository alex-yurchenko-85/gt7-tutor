import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { recurringQuerySchema, type Progress, type ProfileUser, type RecurringDifference, type RecurringQuery } from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { StatsService } from './stats.service.js';

@Controller()
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('exercises/:id/recurring')
  recurring(
    @CurrentUser() user: ProfileUser,
    @Param('id', ParseUUIDPipe) exerciseId: string,
    @Query({ schema: recurringQuerySchema }) query: RecurringQuery
  ): Promise<RecurringDifference[]> {
    return this.stats.recurring(user.id, exerciseId, query.last);
  }

  @Get('progress')
  progress(@CurrentUser() user: ProfileUser): Promise<Progress> {
    return this.stats.progress(user.id);
  }
}
