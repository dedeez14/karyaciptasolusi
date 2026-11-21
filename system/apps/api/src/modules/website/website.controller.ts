import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { WebsiteService } from './website.service';

/** Read by the public website (karyaciptasolusi.com); no sign-in, plain JSON (exempt from transport encryption) */
@Controller('public/website')
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  content() {
    return this.website.content();
  }

  /** Contact form and newsletter: a few messages per visitor per 10 minutes */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('enquiry')
  @HttpCode(201)
  enquiry(@Body() body: unknown) {
    return this.website.enquiry(body);
  }
}
