import { BadGatewayException, BadRequestException, Controller, Get, Param, Post } from '@nestjs/common';
import { Activity, Permission } from '../../common/decorators';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';

/** Allow-listed Hostinger API endpoints (read-only unless stated). Prevents SSRF / arbitrary proxying. */
const READ: Record<string, string> = {
  vps: '/api/vps/v1/virtual-machines',
  domains: '/api/domains/v1/portfolio',
  subscriptions: '/api/billing/v1/subscriptions',
  websites: '/api/hosting/v1/websites',
  'data-centers': '/api/vps/v1/data-centers',
};
const ALLOWED_HOSTS = new Set(['developers.hostinger.com']);

@Controller('integrations/hostinger')
export class HostingerController {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService) {}

  private async call(path: string, method: 'GET' | 'POST' = 'GET') {
    const companyId = RequestCtx.companyId();
    const token = await this.settings.str('integration.hostinger.apiToken', companyId);
    if (!token) throw new BadRequestException('Hostinger API token is not set. Add it in System > Settings > Integrations.');
    const base = new URL(await this.settings.str('integration.hostinger.baseUrl', companyId, 'https://developers.hostinger.com'));
    if (base.protocol !== 'https:' || !ALLOWED_HOSTS.has(base.hostname)) throw new BadRequestException('Hostinger base URL is not allowed');
    let res: Response;
    try {
      res = await fetch(new URL(path, base), { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'kcs-erp' }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new BadGatewayException(`Hostinger is unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = (body as any)?.message ?? `HTTP ${res.status}`;
      throw new BadGatewayException(`Hostinger API error: ${msg}`);
    }
    return body;
  }

  @Get('status')
  @Permission('integration.hostinger.read')
  async status() {
    const configured = !!(await this.settings.str('integration.hostinger.apiToken', RequestCtx.companyId()));
    return { configured, resources: Object.keys(READ) };
  }

  @Get(':resource')
  @Permission('integration.hostinger.read')
  list(@Param('resource') resource: string) {
    const path = READ[resource];
    if (!path) throw new BadRequestException('Unknown Hostinger resource');
    return this.call(path);
  }

  @Get('dns/:domain')
  @Permission('integration.hostinger.read')
  dns(@Param('domain') domain: string) {
    if (!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(domain)) throw new BadRequestException('Invalid domain');
    return this.call(`/api/dns/v1/zones/${encodeURIComponent(domain)}`);
  }

  @Activity('hostinger.vps.action')
  @Post('vps/:id/:action')
  @Permission('integration.hostinger.manage')
  async vpsAction(@Param('id') id: string, @Param('action') action: string) {
    if (!/^\d{1,12}$/.test(id) || !['start', 'stop', 'restart'].includes(action)) throw new BadRequestException('Invalid VPS action');
    const r = await this.call(`/api/vps/v1/virtual-machines/${id}/${action}`, 'POST');
    await this.audit.record('Hostinger VPS', id, action.toUpperCase());
    return r;
  }
}
