import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { CartonService, estimateSchema, fluteSchema, gradeSchema, quoteSchema, specSchema, toolSchema, trimSchema } from './carton.service';

const UUID = /^[0-9a-f-]{36}$/i;

@Controller('carton')
export class CartonController {
  constructor(private readonly svc: CartonService) {}

  @Get('meta')
  meta() {
    return this.svc.meta();
  }

  @Put('flutes/:id')
  saveFlute(@Param('id') id: string, @Body(new ZodPipe(fluteSchema)) body: z.infer<typeof fluteSchema>) {
    return this.svc.saveFlute(id, body);
  }

  @Get('grades')
  grades() {
    return this.svc.grades();
  }

  @Post('grades')
  createGrade(@Body(new ZodPipe(gradeSchema)) body: z.infer<typeof gradeSchema>) {
    return this.svc.saveGrade(null, body);
  }

  @Put('grades/:id')
  updateGrade(@Param('id') id: string, @Body(new ZodPipe(gradeSchema)) body: z.infer<typeof gradeSchema>) {
    return this.svc.saveGrade(id, body);
  }

  @Get('specs')
  specs() {
    return this.svc.specs();
  }

  @Get('specs/:id')
  spec(@Param('id') id: string) {
    return this.svc.spec(id);
  }

  @Post('specs')
  createSpec(@Body(new ZodPipe(specSchema)) body: z.infer<typeof specSchema>) {
    return this.svc.saveSpec(null, body);
  }

  @Put('specs/:id')
  updateSpec(@Param('id') id: string, @Body(new ZodPipe(specSchema)) body: z.infer<typeof specSchema>) {
    return this.svc.saveSpec(id, body);
  }

  @Post('estimates/preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(estimateSchema)) body: z.infer<typeof estimateSchema>) {
    return this.svc.preview(body);
  }

  @Get('estimates')
  estimates(@Query('status') status?: string) {
    return this.svc.estimates(status || undefined);
  }

  @Get('estimates/:id')
  estimate(@Param('id') id: string) {
    return this.svc.estimate(id);
  }

  @Post('estimates')
  createEstimate(@Body(new ZodPipe(estimateSchema)) body: z.infer<typeof estimateSchema>) {
    return this.svc.createEstimate(body);
  }

  @Post('estimates/:id/quote')
  @HttpCode(200)
  quote(@Param('id') id: string, @Body(new ZodPipe(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    return this.svc.quote(id, body);
  }

  @Post('estimates/:id/status')
  @HttpCode(200)
  status(@Param('id') id: string, @Body() body: { status?: string }) {
    if (!['WON', 'LOST', 'DRAFT'].includes(body?.status ?? '')) throw new BadRequestException('Choose won, lost or open');
    return this.svc.setStatus(id, body.status as 'WON' | 'LOST' | 'DRAFT');
  }

  @Post('trim')
  @HttpCode(200)
  trim(@Body(new ZodPipe(trimSchema)) body: z.infer<typeof trimSchema>) {
    return this.svc.trim(body);
  }

  @Get('tools')
  tools(@Query('specId') specId?: string, @Query('status') status?: string) {
    return this.svc.tools({ specId: UUID.test(specId ?? '') ? specId : undefined, status: status || undefined });
  }

  @Post('tools')
  createTool(@Body(new ZodPipe(toolSchema)) body: z.infer<typeof toolSchema>) {
    return this.svc.saveTool(null, body);
  }

  @Put('tools/:id')
  updateTool(@Param('id') id: string, @Body(new ZodPipe(toolSchema)) body: z.infer<typeof toolSchema>) {
    return this.svc.saveTool(id, body);
  }

  @Post('tools/:id/impressions')
  @HttpCode(200)
  impressions(@Param('id') id: string, @Body() body: { count?: number }) {
    return this.svc.addImpressions(id, Number(body?.count));
  }

  @Post('tools/:id/retire')
  @HttpCode(200)
  retire(@Param('id') id: string) {
    return this.svc.retireTool(id);
  }
}
