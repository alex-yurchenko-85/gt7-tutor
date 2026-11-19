import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type CornerInfo,
  createReferenceSchema,
  referenceCheckSchema,
  referenceProposalSchema,
  type CreateReferenceRequest,
  type ProfileUser,
  type ReferenceCheckRequest,
  type ReferenceCheckResult,
  type ReferenceCue,
  type ReferenceInfo,
  type ReferenceProposal,
  type ReferenceTrace,
  type ReferenceProposalRequest
} from '@gt7/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReferencesService } from './references.service.js';

@Controller()
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  @Post('exercises/:id/reference-proposals')
  proposals(
    @CurrentUser() user: ProfileUser,
    @Param('id', ParseUUIDPipe) exerciseId: string,
    @Body({ schema: referenceProposalSchema }) body: ReferenceProposalRequest
  ): Promise<ReferenceProposal[]> {
    return this.references.proposals(user.id, exerciseId, body.captureIds);
  }

  @Get('exercises/:id/references')
  history(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) exerciseId: string): Promise<ReferenceInfo[]> {
    return this.references.history(user.id, exerciseId);
  }

  @Post('references')
  create(@CurrentUser() user: ProfileUser, @Body({ schema: createReferenceSchema }) body: CreateReferenceRequest): Promise<ReferenceInfo> {
    return this.references.create(user.id, body);
  }

  @Post('references/:id/activate')
  activate(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReferenceInfo> {
    return this.references.activate(user.id, id);
  }

  @Delete('references/:id')
  remove(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    return this.references.remove(user.id, id);
  }

  @Post('references/:id/check')
  check(
    @CurrentUser() user: ProfileUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: referenceCheckSchema }) body: ReferenceCheckRequest
  ): Promise<ReferenceCheckResult> {
    return this.references.check(user.id, id, body.captureId);
  }

  @Get('references/:id/cues')
  cues(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReferenceCue[]> {
    return this.references.cues(user.id, id);
  }

  @Get('references/:id/clips')
  clips(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<string[]> {
    return this.references.clips(user.id, id);
  }

  @Get('references/:id/corners')
  corners(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<CornerInfo[]> {
    return this.references.corners(user.id, id);
  }

  @Get('references/:id/path')
  trace(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReferenceTrace> {
    return this.references.trace(user.id, id);
  }

  @Post('attempts/:id/promote')
  promote(@CurrentUser() user: ProfileUser, @Param('id', ParseUUIDPipe) attemptId: string): Promise<ReferenceInfo> {
    return this.references.promote(user.id, attemptId);
  }
}
