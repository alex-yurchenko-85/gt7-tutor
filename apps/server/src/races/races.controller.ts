import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  deleteRacesSchema,
  raceCompareQuerySchema,
  renameRaceSchema,
  type DeleteRacesRequest,
  type DeleteRacesResult,
  type ProfileUser,
  type RaceCompare,
  type RaceCompareQuery,
  type RaceDetail,
  type RaceDistances,
  type RaceLapsSpeed,
  type RaceOffTrackView,
  type RaceSummary,
  type RecordRaceResponse,
  type RenameRaceRequest,
  type StopRaceResponse
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RaceRecorder } from './race-recorder.service.js';
import { RacesService } from './races.service.js';

@Controller('races')
export class RacesController {
  constructor(
    private readonly recorder: RaceRecorder,
    private readonly races: RacesService
  ) {}

  @Get()
  list(@CurrentUser() user: ProfileUser): Promise<RaceSummary[]> {
    return this.races.list(user.id);
  }

  @Post('record')
  record(@CurrentUser() user: ProfileUser): Promise<RecordRaceResponse> {
    return this.recorder.record(user.id);
  }

  @Post('record/stop')
  stop(@CurrentUser() user: ProfileUser): Promise<StopRaceResponse> {
    return this.recorder.stop(user.id);
  }

  @Post('record/close')
  close(@CurrentUser() user: ProfileUser): { ok: true } {
    return this.recorder.close(user.id);
  }

  @Post('delete')
  @HttpCode(200)
  delete(@CurrentUser() user: ProfileUser, @Body({ schema: deleteRacesSchema }) body: DeleteRacesRequest): Promise<DeleteRacesResult> {
    return this.races.delete(user.id, body.ids);
  }

  @Get(':id')
  get(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<RaceDetail> {
    return this.races.get(user.id, id);
  }

  @Get(':id/compare')
  compare(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string, @Query({ schema: raceCompareQuerySchema }) query: RaceCompareQuery): Promise<RaceCompare> {
    return this.races.compare(user.id, id, query);
  }

  @Get(':id/speed')
  speed(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<RaceLapsSpeed> {
    return this.races.speed(user.id, id);
  }

  @Get(':id/distances')
  distances(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<RaceDistances> {
    return this.races.distances(user.id, id);
  }

  @Get(':id/off-track')
  offTrack(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<RaceOffTrackView> {
    return this.races.offTrack(user.id, id);
  }

  @Patch(':id')
  rename(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: renameRaceSchema }) body: RenameRaceRequest): Promise<RaceSummary> {
    return this.races.rename(user.id, id, body);
  }
}
