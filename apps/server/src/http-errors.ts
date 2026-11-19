import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ErrorCode } from '@gt7/contracts';

export function conflict(code: ErrorCode, reason: string): ConflictException {
  return new ConflictException({ code, reason });
}

export function badRequest(code: ErrorCode, reason: string): BadRequestException {
  return new BadRequestException({ code, reason });
}
