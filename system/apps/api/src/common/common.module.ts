import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CryptoService } from './crypto/crypto.service';
import { MemoryCache } from './cache/memory-cache';
import { AccessService } from './access/access.service';
import { AuditService } from './audit/audit.service';
import { SettingsService } from './settings/settings.service';
import { SequenceService } from './sequence/sequence.service';
import { TicketService } from './access/ticket.service';
import { NotificationBus } from './events/notification-bus';

const providers = [PrismaService, CryptoService, MemoryCache, AccessService, AuditService, SettingsService, SequenceService, TicketService, NotificationBus];

/** Cross-cutting services available everywhere (single instances). */
@Global()
@Module({ providers, exports: providers })
export class CommonModule {}
