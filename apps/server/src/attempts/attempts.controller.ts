import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type BrakeReactionSummary,
  reviewQuerySchema,
  type AttemptList,
  type AttemptReview,
  type AttemptSummary,
  type ProfileUser,
  type ReviewQuery
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AttemptsService } from './attempts.service.js';

@Controller()
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get('exercises/:id/attempts')
  list(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) exerciseId: string): Promise<AttemptList> {
    return this.attempts.list(user.id, exerciseId);
  }

  @Get('exercises/:id/reactions')
  reactions(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) exerciseId: string): Promise<BrakeReactionSummary[]> {
    return this.attempts.reactions(user.id, exerciseId);
  }

  @Get('attempts/:id')
  get(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<AttemptSummary> {
    return this.attempts.get(user.id, id);
  }

  @Get('attempts/:id/review')
  review(
    @CurrentUser() user: ProfileUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: reviewQuerySchema }) query: ReviewQuery
  ): Promise<AttemptReview> {
    return this.attempts.review(user.id, id, query.referenceId);
  }
}
