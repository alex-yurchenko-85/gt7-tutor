import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'gt7:isPublic';

export const Public = () => SetMetadata(IS_PUBLIC, true);
