import { Prisma } from '@prisma/client';

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);

/** Round half-up to N decimals (accounting rounding) */
export const round = (v: Prisma.Decimal, dp = 2) => v.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO);

export const toNum = (v: Prisma.Decimal.Value | null | undefined) => Number(v ?? 0);
