import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ProfileUser } from '@gt7/contracts';
import type { Request } from 'express';

export type AuthenticatedRequest = Request & { user?: ProfileUser };

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): ProfileUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without a session');
  return user;
});
