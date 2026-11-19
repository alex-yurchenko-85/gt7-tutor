import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  deleteAttemptsSchema,
  deleteHistorySchema,
  deleteProfileSchema,
  removeExercisesSchema,
  type DeleteAttemptsRequest,
  type DeleteAttemptsResult,
  type DeleteHistoryRequest,
  type DeleteHistoryResult,
  type DeleteProfileRequest,
  type DeleteProfileResult,
  type ProfileUser,
  type RemoveExercisesRequest,
  type RemoveExercisesResult
} from '@gt7/contracts';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session-cookie.js';
import { NotInDemoGuard } from '../demo/not-in-demo.guard.js';
import { HistoryService } from './history.service.js';

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Post('attempts/delete')
  @HttpCode(200)
  deleteAttempts(@CurrentUser() user: ProfileUser, @Body({ schema: deleteAttemptsSchema }) body: DeleteAttemptsRequest): Promise<DeleteAttemptsResult> {
    return this.history.deleteAttempts(user.id, body.ids);
  }

  @Post('history/delete')
  @HttpCode(200)
  deleteHistory(@CurrentUser() user: ProfileUser, @Body({ schema: deleteHistorySchema }) body: DeleteHistoryRequest): Promise<DeleteHistoryResult> {
    return this.history.deleteHistory(user.id, body);
  }

  @Post('exercises/remove')
  @HttpCode(200)
  removeExercises(@CurrentUser() user: ProfileUser, @Body({ schema: removeExercisesSchema }) body: RemoveExercisesRequest): Promise<RemoveExercisesResult> {
    return this.history.removeExercises(user.id, body);
  }

  @Post('profiles/me/delete')
  @HttpCode(200)
  @UseGuards(NotInDemoGuard)
  async deleteProfile(
    @CurrentUser() user: ProfileUser,
    @Body({ schema: deleteProfileSchema }) body: DeleteProfileRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<DeleteProfileResult> {
    const result = await this.history.deleteProfile(user, body, request.ip ?? request.socket.remoteAddress ?? 'unknown');
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    return result;
  }
}
