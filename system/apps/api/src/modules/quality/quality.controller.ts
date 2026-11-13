import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { decideSchema, ncrSchema, ncrUpdateSchema, planSchema, QualityService, resultsSchema } from './quality.service';

@Controller('quality')
export class QualityController {
  constructor(private readonly qc: QualityService) {}

  @Get('plans')
  plans() {
    return this.qc.plans();
  }

  @Post('plans')
  createPlan(@Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.qc.savePlan(null, body);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.qc.savePlan(id, body);
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.qc.deletePlan(id);
  }

  @Get('inspections')
  inspections(@Query('status') status?: string, @Query('search') search?: string) {
    return this.qc.inspections(status || undefined, search);
  }

  @Get('inspections/:id')
  inspection(@Param('id') id: string) {
    return this.qc.inspection(id);
  }

  @Put('inspections/:id/results')
  record(@Param('id') id: string, @Body(new ZodPipe(resultsSchema)) body: z.infer<typeof resultsSchema>) {
    return this.qc.record(id, body);
  }

  @Post('inspections/:id/decide')
  @HttpCode(200)
  decide(@Param('id') id: string, @Body(new ZodPipe(decideSchema)) body: z.infer<typeof decideSchema>) {
    return this.qc.decide(id, body);
  }

  @Get('ncrs')
  ncrs(@Query('status') status?: string) {
    return this.qc.ncrs(status || undefined);
  }

  @Post('ncrs')
  createNcr(@Body(new ZodPipe(ncrSchema)) body: z.infer<typeof ncrSchema>) {
    return this.qc.createNcr(body);
  }

  @Put('ncrs/:id')
  updateNcr(@Param('id') id: string, @Body(new ZodPipe(ncrUpdateSchema)) body: z.infer<typeof ncrUpdateSchema>) {
    return this.qc.updateNcr(id, body);
  }
}
