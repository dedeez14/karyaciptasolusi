import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { catchError, defer, distinctUntilChanged, EMPTY, from, interval, map, merge, Observable, startWith, switchMap, takeUntil, throttleTime, timer } from 'rxjs';
import { RequestCtx } from '../../common/context/request-context';
import { AccessService } from '../../common/access/access.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { NotificationService } from './notification.service';

/** Max lifetime of one stream; the client reconnects with a fresh access token (revocation takes effect). */
const STREAM_LIFETIME_MS = 10 * 60_000;

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService, private readonly bus: NotificationBus, private readonly access: AccessService) {}

  @Get()
  summary() {
    return this.notifications.summary(RequestCtx.user());
  }

  /**
   * Real-time stream (Server-Sent Events). Pushes a new summary immediately whenever data changes in the
   * company (any create/update/confirm/cancel) and at the configured refresh interval as a fallback.
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const u = RequestCtx.user();
    const tick$ = defer(() => from(this.notifications.summary(u))).pipe(map((s) => s.refreshSeconds));
    const refresh$ = tick$.pipe(switchMap((sec) => interval(sec * 1000)));
    const changes$ = this.bus.changes(u.companyId).pipe(throttleTime(1500, undefined, { leading: true, trailing: true }));

    const key = (s: { enabled: boolean; items: unknown[] }) => JSON.stringify([s.enabled, s.items]);
    const data$ = merge(refresh$, changes$).pipe(
      startWith(0),
      // re-validate the account on every push: deactivated users / revoked access stop receiving data
      switchMap(() => from(this.access.profile(u.id, u.companyId, u.branchId).then((p) => this.notifications.summary(p)))),
      distinctUntilChanged((a, b) => key(a) === key(b)),
      map((s): MessageEvent => ({ type: 'notifications', data: s })),
      catchError(() => EMPTY),
    );
    const ping$ = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: { t: Date.now() } })));
    return merge(data$, ping$).pipe(takeUntil(timer(STREAM_LIFETIME_MS)));
  }
}
