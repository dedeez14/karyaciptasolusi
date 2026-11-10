import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'kcs:isPublic';
export const PERMISSION = 'kcs:permission';
export const ACTIVITY = 'kcs:activity';

/** Route accessible without authentication */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require one permission code (any of them when an array is given) */
export const Permission = (...codes: string[]) => SetMetadata(PERMISSION, codes);

/** Override the activity name written to the activity log */
export const Activity = (name: string) => SetMetadata(ACTIVITY, name);
