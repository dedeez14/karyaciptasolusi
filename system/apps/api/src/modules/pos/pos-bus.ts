import { Injectable } from '@nestjs/common';
import { filter, Observable, Subject } from 'rxjs';

/**
 * Realtime channel of an outlet (in-process). One stream feeds every device of the outlet:
 * - `orders`: open bills / tables changed (cashier tablets)
 * - `kitchen`: kitchen tickets changed (KDS, expo)
 * - `queue`: queue numbers preparing / ready (order-ready board)
 * - `display`: the cart shown to the customer (customer display), relayed from the cashier
 */
export type PosTopic = 'orders' | 'kitchen' | 'queue' | 'display';

export interface PosEvent {
  companyId: string;
  outletId: string;
  topic: PosTopic;
  data?: unknown;
}

@Injectable()
export class PosBus {
  private readonly subject = new Subject<PosEvent>();

  emit(e: PosEvent) {
    this.subject.next(e);
  }

  /** the usual set after an order changes */
  changed(companyId: string, outletId: string | null | undefined, topics: PosTopic[] = ['orders', 'kitchen', 'queue']) {
    if (!outletId) return;
    for (const topic of topics) this.emit({ companyId, outletId, topic });
  }

  stream(companyId: string, outletId: string, topics: PosTopic[]): Observable<PosEvent> {
    return this.subject.pipe(filter((e) => e.companyId === companyId && e.outletId === outletId && topics.includes(e.topic)));
  }
}
