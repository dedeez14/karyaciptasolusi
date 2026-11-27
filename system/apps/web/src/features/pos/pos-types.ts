export interface Outlet {
  id: string;
  code: string;
  name: string;
  mode: 'RETAIL' | 'FNB';
  serviceStyle: 'COUNTER' | 'TABLE';
  pricesIncludeTax: boolean;
  pbjtRate: string;
  serviceChargePct: string;
  serviceChargeToStaff: boolean;
  warehouseId: string;
  queuePrefix: string;
  displayMessage: string | null;
  readyAnnouncement: string;
  kdsWarnMinutes: number;
  kdsLateMinutes: number;
  receiptFooter: string | null;
}
export interface Shift {
  id: string;
  number: string;
  outletId: string | null;
  warehouseId: string;
  cashAccountId: string;
  openingCash: string;
  openedAt: string;
}
export interface Table {
  id: string;
  code: string;
  name: string;
  area: string | null;
  seats: number;
}
export interface PosConfig {
  outlets: { id: string; code: string; name: string; mode: string; serviceStyle: string }[];
  outlet: Outlet | null;
  vatPayer: boolean;
  loyalty: { amountPerPoint: number; pointValue: number };
  session: Shift | null;
  tables: Table[];
}
export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; price: number }[];
}
export interface Product {
  id: string;
  code: string;
  name: string;
  barcode: string | null;
  price: number;
  type: string;
  category: string | null;
  categoryId: string | null;
  station: string | null;
  recipe: boolean;
  stock: number | null;
  modifiers: ModifierGroup[];
}
/** a line being built on the screen (not saved yet) */
export interface DraftLine {
  key: string;
  product: Product;
  qty: number;
  discountPct: number;
  modifiers: { optionId: string; name: string; price: number }[];
  note: string;
  course: number;
}
export interface Totals {
  lines?: { key: string; promoDiscount: number; total: number }[];
  discount: number;
  subtotal: number;
  serviceCharge: number;
  taxTotal: number;
  localTax: number;
  total: number;
  promotions: { promotionId: string; code: string; name: string; amount: number }[];
}
export interface OrderLine {
  id: string;
  lineNo: number;
  productId: string;
  name: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  promoDiscount: string;
  modifiers: { name: string; price: number }[];
  note: string | null;
  course: number;
  station: string | null;
  ticketId: string | null;
  sentAt: string | null;
  status: 'ACTIVE' | 'VOID';
  voidReason: string | null;
  lineTotal: string;
}
export interface Order {
  id: string;
  number: string | null;
  outletId: string;
  status: 'OPEN' | 'PAID' | 'VOID' | 'CANCELLED';
  orderType: 'RETAIL' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableId: string | null;
  table: { id: string; code: string; name: string } | null;
  covers: number;
  label: string | null;
  queueNo: string | null;
  customerId: string | null;
  customer: { id: string; name: string; memberNo: string | null; points: number } | null;
  voucherCode: string | null;
  subtotal: string;
  discount: string;
  serviceCharge: string;
  taxTotal: string;
  localTax: string;
  total: string;
  paid: string;
  change: string;
  promotions: { promotionId: string; code: string; name: string; amount: number }[];
  kitchenStatus: string;
  billPrintedAt: string | null;
  createdAt: string;
  lines: OrderLine[];
  tickets: { id: string; station: string; course: number; status: string; round: number }[];
  pointsEarned: number;
  pointsRedeemed: number;
}
export interface OpenOrder {
  id: string;
  orderType: string;
  tableId: string | null;
  covers: number;
  label: string | null;
  queueNo: string | null;
  total: number;
  kitchenStatus: string;
  billPrintedAt: string | null;
  createdAt: string;
  items: number;
  qrPending?: number;
}
export type Method = 'CASH' | 'QRIS' | 'CARD' | 'TRANSFER' | 'POINTS';
export interface Payment {
  method: Method;
  amount: number;
  reference?: string;
}
export interface Member {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  memberNo: string | null;
  points: number;
}
/** what the customer display shows */
export interface DisplayState {
  phase: 'idle' | 'cart' | 'pay' | 'done';
  lines: { name: string; qty: number; total: number; detail?: string }[];
  totals?: Totals;
  member?: { name: string; points: number } | null;
  paid?: number;
  change?: number;
  queueNo?: string | null;
}

export const toTotals = (o: Order): Totals => ({
  discount: Number(o.discount),
  subtotal: Number(o.subtotal),
  serviceCharge: Number(o.serviceCharge),
  taxTotal: Number(o.taxTotal),
  localTax: Number(o.localTax),
  total: Number(o.total),
  promotions: o.promotions ?? [],
});
