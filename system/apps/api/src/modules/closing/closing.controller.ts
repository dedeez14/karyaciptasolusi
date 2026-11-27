import { Controller, Get, Param, Post } from '@nestjs/common';
import { Activity, Permission } from '../../common/decorators';
import { ClosingService } from './closing.service';

@Controller('year-end')
export class ClosingController {
  constructor(private readonly closing: ClosingService) {}

  @Get()
  @Permission('accounting.closing.read')
  list() {
    return this.closing.list();
  }

  @Get(':id')
  @Permission('accounting.closing.read')
  preview(@Param('id') id: string) {
    return this.closing.preview(id);
  }

  @Post(':id/close')
  @Permission('accounting.closing.close')
  @Activity('year-end.close')
  close(@Param('id') id: string) {
    return this.closing.close(id);
  }

  @Post(':id/reopen')
  @Permission('accounting.closing.reopen')
  @Activity('year-end.reopen')
  reopen(@Param('id') id: string) {
    return this.closing.reopen(id);
  }
}
