import { Injectable } from '@nestjs/common';
import { filter, Observable, Subject } from 'rxjs';

/** In-process event bus: "something changed in company X" -> connected clients refresh their notifications. */
@Injectable()
export class NotificationBus {
  private readonly subject = new Subject<string>();

  emit(companyId: string | undefined | null) {
    if (companyId) this.subject.next(companyId);
  }

  changes(companyId: string): Observable<string> {
    return this.subject.pipe(filter((c) => c === companyId));
  }
}
