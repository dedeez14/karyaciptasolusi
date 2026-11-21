import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { chargeSchema, checkInSchema, checkOutSchema, configSchema, HotelService, receiptSchema, reservationSchema, roomSchema, roomTypeSchema } from './hotel.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const statusSchema = z.object({ status: z.enum(['VACANT_CLEAN', 'VACANT_DIRTY', 'OUT_OF_ORDER']) });
const apoaSchema = z.object({ ref: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(60).nullable().optional()) });
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};

@Controller('hotel')
export class HotelController {
  constructor(private readonly svc: HotelService) {}

  @Get('config')
  config() {
    return this.svc.config();
  }

  @Put('config')
  saveConfig(@Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>) {
    return this.svc.saveConfig(body);
  }

  @Get('room-types')
  roomTypes() {
    return this.svc.roomTypes();
  }

  @Post('room-types')
  createType(@Body(new ZodPipe(roomTypeSchema)) body: z.infer<typeof roomTypeSchema>) {
    return this.svc.saveRoomType(null, body);
  }

  @Put('room-types/:id')
  updateType(@Param('id') tid: string, @Body(new ZodPipe(roomTypeSchema)) body: z.infer<typeof roomTypeSchema>) {
    return this.svc.saveRoomType(id(tid), body);
  }

  @Get('board')
  board() {
    return this.svc.board();
  }

  @Post('rooms')
  createRoom(@Body(new ZodPipe(roomSchema)) body: z.infer<typeof roomSchema>) {
    return this.svc.saveRoom(null, body);
  }

  @Put('rooms/:id')
  updateRoom(@Param('id') rid: string, @Body(new ZodPipe(roomSchema)) body: z.infer<typeof roomSchema>) {
    return this.svc.saveRoom(id(rid), body);
  }

  @Post('rooms/:id/status')
  @HttpCode(200)
  roomStatus(@Param('id') rid: string, @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    return this.svc.setRoomStatus(id(rid), body.status);
  }

  @Get('reservations')
  reservations(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.reservations({
      status: ['TENTATIVE', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(status ?? '') ? status : undefined,
      from: DAY.test(from ?? '') ? new Date(from!) : undefined,
      to: DAY.test(to ?? '') ? new Date(to!) : undefined,
    });
  }

  @Get('reservations/:id')
  reservation(@Param('id') rid: string) {
    return this.svc.reservation(id(rid));
  }

  @Post('reservations')
  create(@Body(new ZodPipe(reservationSchema)) body: z.infer<typeof reservationSchema>) {
    return this.svc.saveReservation(null, body);
  }

  @Put('reservations/:id')
  update(@Param('id') rid: string, @Body(new ZodPipe(reservationSchema)) body: z.infer<typeof reservationSchema>) {
    return this.svc.saveReservation(id(rid), body);
  }

  @Post('reservations/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') rid: string) {
    return this.svc.cancel(id(rid));
  }

  @Post('reservations/:id/charge')
  @HttpCode(200)
  charge(@Param('id') rid: string, @Body(new ZodPipe(chargeSchema)) body: z.infer<typeof chargeSchema>) {
    return this.svc.charge(id(rid), body);
  }

  @Post('reservations/:id/receipt')
  @HttpCode(200)
  receipt(@Param('id') rid: string, @Body(new ZodPipe(receiptSchema)) body: z.infer<typeof receiptSchema>) {
    return this.svc.receipt(id(rid), body);
  }

  @Post('folio-lines/:id/void')
  @HttpCode(200)
  voidLine(@Param('id') lid: string) {
    return this.svc.voidLine(id(lid));
  }

  @Post('reservations/:id/check-in')
  @HttpCode(200)
  checkIn(@Param('id') rid: string, @Body(new ZodPipe(checkInSchema)) body: z.infer<typeof checkInSchema>) {
    return this.svc.checkIn(id(rid), body);
  }

  @Post('reservations/:id/check-out')
  @HttpCode(200)
  checkOut(@Param('id') rid: string, @Body(new ZodPipe(checkOutSchema)) body: z.infer<typeof checkOutSchema>) {
    return this.svc.checkOut(id(rid), body);
  }

  @Post('reservations/:id/apoa')
  @HttpCode(200)
  apoa(@Param('id') rid: string, @Body(new ZodPipe(apoaSchema)) body: z.infer<typeof apoaSchema>) {
    return this.svc.markReported(id(rid), body.ref ?? null);
  }

  @Post('night-audit')
  @HttpCode(200)
  nightAudit() {
    return this.svc.nightAudit();
  }

  @Get('reports')
  reports(@Query('from') from?: string, @Query('to') to?: string) {
    const t = new Date();
    return this.svc.reports(
      new Date(DAY.test(from ?? '') ? from! : new Date(t.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)),
      new Date(DAY.test(to ?? '') ? to! : t.toISOString().slice(0, 10)),
    );
  }
}
