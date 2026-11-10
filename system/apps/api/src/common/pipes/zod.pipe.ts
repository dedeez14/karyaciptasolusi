import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates & strips unknown keys using a zod schema. Usage: @Body(new ZodPipe(schema)) */
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message])),
      });
    }
    return r.data;
  }
}
