import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { StorageService } from '../files/storage.service';
import { csvRecords } from './csv';
import { EmailFinderService } from './email-finder.service';
import { PlaceImportService } from './place-import.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_MAX = 4000;

interface Running {
  jobId: string;
  companyId: string;
  child: ChildProcess;
  startedAt: number;
  dir: string;
  resultsPath: string;
  queries: Map<string, string>;
  log: string;
  rows: number;
  cancelled: boolean;
  timedOut: boolean;
  progress?: NodeJS.Timeout;
  timeout?: NodeJS.Timeout;
}

export const SCRAPER_PATH_HELP = 'The Google Maps scraper program is not set up. Ask an administrator to fill in System > Settings > Marketing > "Google Maps scraper program" with the full path of google-maps-scraper.exe.';

/**
 * Runs google-maps-scraper (gosom/google-maps-scraper) as a child process, one search at a time.
 * The program is started with an argument list (no shell), works in its own folder under the
 * API storage directory, and its CSV output is imported into map_places when it finishes.
 */
@Injectable()
export class ScraperRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LeadFinder');
  private current: Running | null = null;
  private ticking = false;
  private ticker?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly bus: NotificationBus,
    private readonly storage: StorageService,
    private readonly importer: PlaceImportService,
    private readonly emails: EmailFinderService,
  ) {}

  async onModuleInit() {
    // a search that was running when the server stopped can never finish
    await this.prisma.scrapeJob
      .updateMany({ where: { statusCode: 'RUNNING', deletedAt: null }, data: { statusCode: 'FAILED', finishedAt: new Date(), error: 'The server restarted while this search was running. Start it again.' } })
      .catch(() => undefined);
    this.ticker = setInterval(() => void this.tick(), 15_000);
    this.ticker.unref?.();
    setTimeout(() => void this.tick(), 5_000).unref?.();
  }

  onModuleDestroy() {
    if (this.ticker) clearInterval(this.ticker);
    if (this.current) this.killTree(this.current.child);
  }

  /** Folder of one search inside the API storage directory */
  jobDir(jobId: string) {
    if (!UUID.test(jobId)) throw new Error('Invalid job id');
    const base = resolve(this.storage.root, 'leadfinder');
    const dir = resolve(base, jobId);
    if (!dir.startsWith(base + sep)) throw new Error('Path traversal blocked');
    return dir;
  }

  async removeFiles(jobId: string) {
    await rm(this.jobDir(jobId), { recursive: true, force: true }).catch(() => undefined);
  }

  /** Configured program path, or an error message for the admin */
  async program(companyId: string): Promise<{ path: string | null; problem: string | null }> {
    const path = (await this.settings.str('marketing.scraperPath', companyId, '')).trim();
    if (!path) return { path: null, problem: SCRAPER_PATH_HELP };
    // only the google-maps-scraper program itself, on a local absolute path (no other program, no network share)
    const name = path.split(/[\\/]/).pop() ?? '';
    const programName = process.platform === 'win32' ? /^google-maps-scraper[\w.-]*\.exe$/i : /^google-maps-scraper[\w.-]*$/i;
    if (!isAbsolute(path) || /^[\\/]{2}/.test(path) || !programName.test(name) || /\.(sh|bash|py|pl|rb|js|bat|cmd|ps1)$/i.test(name))
      return { path: null, problem: `"${path}" is not the google-maps-scraper program. Set the full local path of google-maps-scraper(.exe) in System > Settings > Marketing.` };
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return { path: null, problem: `The scraper program was not found at "${path}". Check System > Settings > Marketing > "Google Maps scraper program".` };
    } catch {
      return { path: null, problem: SCRAPER_PATH_HELP };
    }
    return { path, problem: null };
  }

  live(jobId: string) {
    const c = this.current;
    if (!c || c.jobId !== jobId) return null;
    return { elapsedSeconds: Math.round((Date.now() - c.startedAt) / 1000), rows: c.rows, log: c.log.slice(-LOG_MAX) };
  }

  busyWith() {
    return this.current?.jobId ?? null;
  }

  kick() {
    setImmediate(() => void this.tick());
  }

  async tick() {
    if (this.current || this.ticking) return;
    this.ticking = true;
    try {
      const job = await this.prisma.scrapeJob.findFirst({ where: { statusCode: 'QUEUED', deletedAt: null }, orderBy: { createdAt: 'asc' } });
      if (job) await this.start(job);
    } catch (e) {
      this.logger.error(`queue: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async fail(jobId: string, companyId: string, error: string) {
    await this.prisma.scrapeJob.update({ where: { id: jobId }, data: { statusCode: 'FAILED', finishedAt: new Date(), error: error.slice(0, 2000) } });
    this.bus.emit(companyId);
  }

  private async start(job: { id: string; companyId: string; queries: string; latitude: unknown; longitude: unknown; radiusKm: unknown; zoom: number | null; depth: number; languageCode: string; extractEmails: boolean; fastMode: boolean }) {
    const { path, problem } = await this.program(job.companyId);
    if (!path) return this.fail(job.id, job.companyId, problem!);

    const dir = this.jobDir(job.id);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(dir, { recursive: true });
    const lines = job.queries.split('\n').map((l) => l.trim()).filter(Boolean);
    // custom input ids ("query #!#id") tell which search found which place
    const queries = new Map(lines.map((q, i) => [`q${i + 1}`, q]));
    const queriesPath = join(dir, 'queries.txt');
    const resultsPath = join(dir, 'results.csv');
    await writeFile(queriesPath, lines.map((q, i) => `${q} #!#q${i + 1}`).join('\n') + '\n', 'utf8');

    const concurrency = Math.min(8, Math.max(1, Math.round(await this.settings.num('marketing.scraperConcurrency', job.companyId, 2))));
    const timeoutMin = Math.min(240, Math.max(1, await this.settings.num('marketing.scraperTimeoutMinutes', job.companyId, 30)));
    const args = ['-input', queriesPath, '-results', resultsPath, '-depth', String(job.depth), '-lang', job.languageCode, '-c', String(concurrency), '-exit-on-inactivity', '3m'];
    if (job.latitude !== null && job.longitude !== null) {
      args.push('-geo', `${Number(job.latitude)},${Number(job.longitude)}`);
      if (job.zoom) args.push('-zoom', String(job.zoom));
      if (job.radiusKm !== null) args.push('-radius', String(Math.round(Number(job.radiusKm) * 1000)));
    }
    if (job.extractEmails) args.push('-email');
    if (job.fastMode) args.push('-fast-mode');

    let child: ChildProcess;
    try {
      child = spawn(path, args, { cwd: dirname(path), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return this.fail(job.id, job.companyId, `The scraper could not be started: ${(e as Error).message}`);
    }
    const run: Running = { jobId: job.id, companyId: job.companyId, child, startedAt: Date.now(), dir, resultsPath, queries, log: '', rows: 0, cancelled: false, timedOut: false };
    this.current = run;
    await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { statusCode: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null, resultCount: 0, newCount: 0, logTail: null } });
    this.bus.emit(job.companyId);
    this.logger.log(`search ${job.id} started (${lines.length} queries)`);

    const append = (b: Buffer) => {
      run.log = (run.log + b.toString('utf8')).slice(-LOG_MAX * 2);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    run.progress = setInterval(() => void this.progress(run), 5_000);
    run.timeout = setTimeout(() => {
      run.timedOut = true;
      this.killTree(child);
    }, timeoutMin * 60_000);

    child.on('error', (e) => {
      append(Buffer.from(`\n${e.message}\n`));
    });
    child.on('close', (code) => void this.finish(run, code));
  }

  private async progress(run: Running) {
    try {
      if (!existsSync(run.resultsPath)) return;
      run.rows = csvRecords(await readFile(run.resultsPath, 'utf8')).length;
      await this.prisma.scrapeJob.update({ where: { id: run.jobId }, data: { resultCount: run.rows, logTail: this.tail(run.log) } });
      this.bus.emit(run.companyId);
    } catch {
      /* the file is being written - next tick */
    }
  }

  private tail(log: string) {
    // strip ANSI colour codes the scraper prints
    return log.replace(/\u001b\[[0-9;]*m/g, '').slice(-LOG_MAX) || null;
  }

  private async finish(run: Running, code: number | null) {
    if (run.progress) clearInterval(run.progress);
    if (run.timeout) clearTimeout(run.timeout);
    let imported = { rows: 0, created: 0, updated: 0, skipped: 0 };
    let importError: string | null = null;
    try {
      if (existsSync(run.resultsPath)) {
        const records = csvRecords(await readFile(run.resultsPath, 'utf8'));
        imported = await this.importer.importRecords(run.companyId, run.jobId, records, run.queries);
      }
    } catch (e) {
      importError = `The results could not be read: ${(e as Error).message}`;
    }
    const minutes = Math.round((Date.now() - run.startedAt) / 60_000);
    let status = 'DONE';
    let error: string | null = importError;
    if (run.cancelled) status = 'CANCELLED';
    else if (run.timedOut) {
      status = imported.rows ? 'DONE' : 'FAILED';
      error = `Stopped after ${minutes} minute(s) (time limit in System > Settings > Marketing).`;
    } else if (code !== 0 && !imported.rows) {
      status = 'FAILED';
      const last = this.tail(run.log)?.split('\n').filter((l) => l.trim()).slice(-3).join(' ') ?? '';
      error = `The scraper stopped with exit code ${code}. ${last}`.trim();
    } else if (!imported.rows && !importError) {
      error = /unexpected page type|captcha|consent|unusual traffic/i.test(run.log)
        ? 'Google Maps did not return a results list (a consent or "unusual traffic" page). Try again later, run fewer searches at once, use fast mode with a map centre, or set up proxies for the scraper.'
        : 'The search finished without results. Try other keywords, a larger radius or a higher depth.';
    }
    try {
      await this.prisma.scrapeJob.update({
        where: { id: run.jobId },
        data: { statusCode: status, finishedAt: new Date(), resultCount: imported.rows, newCount: imported.created, error: error?.slice(0, 2000) ?? null, logTail: this.tail(run.log) },
      });
    } catch (e) {
      this.logger.error(`search ${run.jobId}: ${(e as Error).message}`);
    }
    this.logger.log(`search ${run.jobId} ${status}: ${imported.rows} rows, ${imported.created} new places`);
    // e-mail addresses: the scraper's fast mode never opens the websites, so the ERP reads them itself
    if (imported.rows && !run.cancelled) {
      const job = await this.prisma.scrapeJob.findUnique({ where: { id: run.jobId }, select: { extractEmails: true } }).catch(() => null);
      if (job?.extractEmails) await this.emails.enqueueJob(run.companyId, run.jobId).catch((e) => this.logger.warn(`e-mail lookup not started: ${(e as Error).message}`));
    }
    this.current = null;
    this.bus.emit(run.companyId);
    this.kick();
  }

  /** Stops the running search (and the browsers it started) */
  cancel(jobId: string) {
    const c = this.current;
    if (!c || c.jobId !== jobId) return false;
    c.cancelled = true;
    this.killTree(c.child);
    return true;
  }

  private killTree(child: ChildProcess) {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      k.on('error', () => child.kill());
    } else child.kill('SIGTERM');
  }
}
