import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Activity, Public } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { FileOutputService } from '../files/file-output.service';
import { CampaignService } from './campaign.service';
import { InboxService } from './inbox.service';
import { PublicEmailService } from './public-email.service';

const code = z
  .string()
  .regex(/^[A-Z_]+$/)
  .max(30)
  .optional();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  status: code,
});
const recipientSchema = listSchema;
const suppressionSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  reason: code,
});
const replySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  kind: code,
  open: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  campaignId: z.uuid().optional(),
});
const exportSchema = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx'), status: code });

@Controller('email-campaigns')
export class EmailCampaignController {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly inbox: InboxService,
    private readonly output: FileOutputService,
  ) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.campaigns.list(q);
  }

  @Get('summary')
  summary() {
    return this.campaigns.summary();
  }

  @Get('defaults')
  defaults() {
    return this.campaigns.defaults();
  }

  @Get('map-jobs')
  mapJobs() {
    return this.campaigns.mapJobs();
  }

  @Post('audience/preview')
  @HttpCode(200)
  previewAudience(@Body() body: unknown) {
    return this.campaigns.previewAudience(body);
  }

  @Get('suppressions')
  suppressions(@Query(new ZodPipe(suppressionSchema)) q: z.infer<typeof suppressionSchema>) {
    return this.campaigns.suppressions(q);
  }

  @Post('suppressions')
  addSuppressions(@Body() body: unknown) {
    return this.campaigns.addSuppressions(body);
  }

  @Delete('suppressions/:id')
  removeSuppression(@Param('id') id: string) {
    return this.campaigns.removeSuppression(id);
  }

  @Get('replies')
  replies(@Query(new ZodPipe(replySchema)) q: z.infer<typeof replySchema>) {
    return this.inbox.list(q);
  }

  @Activity('email-campaign.check-replies')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('replies/check')
  @HttpCode(200)
  checkReplies() {
    return this.inbox.checkNow();
  }

  @Post('replies/:rid/handled')
  @HttpCode(200)
  handled(@Param('rid') rid: string, @Body() body: { handled?: unknown }) {
    return this.inbox.setHandled(rid, body?.handled !== false);
  }

  @Post(':id/recipients/:rid/replied')
  @HttpCode(200)
  markReplied(@Param('id') id: string, @Param('rid') rid: string) {
    return this.inbox.markReplied(id, rid);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Get(':id/recipients')
  recipients(@Param('id') id: string, @Query(new ZodPipe(recipientSchema)) q: z.infer<typeof recipientSchema>) {
    return this.campaigns.recipients(id, q);
  }

  @Activity('email-campaign.export')
  @Get(':id/recipients/export')
  async exportRecipients(@Param('id') id: string, @Query(new ZodPipe(exportSchema)) q: z.infer<typeof exportSchema>, @Res() res: Response) {
    await this.output.sendTable(res, await this.campaigns.recipientsTable(id, q.status), q.format);
  }

  @Get(':id/preview')
  preview(@Param('id') id: string, @Query('email') email?: string, @Query('step') step?: string) {
    const n = Number(step);
    return this.campaigns.preview(id, email ? String(email).slice(0, 200) : undefined, Number.isInteger(n) && n > 0 && n <= 5 ? n : undefined);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.campaigns.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.campaigns.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.campaigns.duplicate(id);
  }

  @Activity('email-campaign.test')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string, @Body() body: unknown) {
    return this.campaigns.testSend(id, body);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  schedule(@Param('id') id: string, @Body() body: unknown) {
    return this.campaigns.schedule(id, body);
  }

  @Activity('email-campaign.send')
  @Post(':id/send-now')
  @HttpCode(200)
  sendNow(@Param('id') id: string) {
    return this.campaigns.sendNow(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string) {
    return this.campaigns.pause(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string) {
    return this.campaigns.resume(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.campaigns.cancel(id);
  }
}

/** 1x1 transparent GIF */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Reached from the e-mails (no sign-in). Paths under /public skip the encrypted transport. */
@Controller('public/email')
export class PublicEmailController {
  constructor(private readonly svc: PublicEmailService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('unsubscribe/:token')
  info(@Param('token') token: string) {
    return this.svc.info(token);
  }

  /** Confirm button on the page and the one-click POST of mail clients (RFC 8058) */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('unsubscribe/:token')
  @HttpCode(200)
  unsubscribe(@Param('token') token: string) {
    return this.svc.unsubscribe(token);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('open/:file')
  async open(@Param('file') file: string, @Res() res: Response) {
    await this.svc.open(String(file).replace(/\.gif$/, '')).catch(() => undefined);
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': String(PIXEL.length) });
    res.end(PIXEL);
  }
}
