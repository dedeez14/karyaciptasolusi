/**
 * Trade document types handled by the generic document engine.
 * Behaviour is declarative; numbering prefixes, accounts, taxes etc. come from the database.
 */
export interface DocTypeDef {
  code: string;
  label: string;
  printTitle: string;
  module: 'sales' | 'purchase' | 'inventory';
  /** permission prefix -> .read .create .update .delete .confirm .cancel .print */
  permission: string;
  partner: 'customer' | 'supplier' | null;
  priced: boolean;
  priceField?: 'salePrice' | 'purchasePrice';
  taxField?: 'saleTaxId' | 'purchaseTaxId';
  warehouse: 'none' | 'optional' | 'required' | 'transfer';
  stock?: 'in' | 'out' | 'adjust' | 'transfer';
  /** documents that can be generated from this one */
  convertTo: string[];
  /** receives payments (invoices) */
  payable?: boolean;
  dueDate?: boolean;
  /** only stock items allowed (deliveries, receipts, adjustments) */
  stockItemsOnly?: boolean;
  partyLabel?: string;
  signatures: string[];
}

export const DOC_TYPES: DocTypeDef[] = [
  { code: 'SQ', label: 'Sales Quotation', printTitle: 'Quotation', module: 'sales', permission: 'sales.quotation', partner: 'customer', priced: true, priceField: 'salePrice', taxField: 'saleTaxId', warehouse: 'none', convertTo: ['SO', 'SI'], dueDate: true, partyLabel: 'Quotation For', signatures: ['Prepared by', 'Approved by', 'Customer Acceptance'] },
  { code: 'SO', label: 'Sales Order', printTitle: 'Sales Order', module: 'sales', permission: 'sales.order', partner: 'customer', priced: true, priceField: 'salePrice', taxField: 'saleTaxId', warehouse: 'optional', convertTo: ['DO', 'SI'], partyLabel: 'Customer', signatures: ['Prepared by', 'Approved by'] },
  { code: 'DO', label: 'Delivery Order', printTitle: 'Delivery Order', module: 'sales', permission: 'sales.delivery', partner: 'customer', priced: false, warehouse: 'required', stock: 'out', convertTo: ['SI'], stockItemsOnly: true, partyLabel: 'Deliver To', signatures: ['Prepared by', 'Delivered by', 'Received by'] },
  { code: 'SI', label: 'Sales Invoice', printTitle: 'Invoice', module: 'sales', permission: 'sales.invoice', partner: 'customer', priced: true, priceField: 'salePrice', taxField: 'saleTaxId', warehouse: 'none', convertTo: [], payable: true, dueDate: true, partyLabel: 'Bill To', signatures: ['Authorized Signature'] },
  { code: 'PR', label: 'Purchase Request', printTitle: 'Purchase Request', module: 'purchase', permission: 'purchase.request', partner: null, priced: true, priceField: 'purchasePrice', taxField: 'purchaseTaxId', warehouse: 'optional', convertTo: ['PO'], signatures: ['Requested by', 'Approved by'] },
  { code: 'PO', label: 'Purchase Order', printTitle: 'Purchase Order', module: 'purchase', permission: 'purchase.order', partner: 'supplier', priced: true, priceField: 'purchasePrice', taxField: 'purchaseTaxId', warehouse: 'optional', convertTo: ['GR', 'PI'], dueDate: true, partyLabel: 'Vendor', signatures: ['Prepared by', 'Approved by', 'Vendor Confirmation'] },
  { code: 'GR', label: 'Goods Receipt', printTitle: 'Goods Receipt', module: 'purchase', permission: 'purchase.receipt', partner: 'supplier', priced: true, priceField: 'purchasePrice', warehouse: 'required', stock: 'in', convertTo: ['PI'], stockItemsOnly: true, partyLabel: 'Received From', signatures: ['Received by', 'Checked by'] },
  { code: 'PI', label: 'Purchase Invoice', printTitle: 'Purchase Invoice', module: 'purchase', permission: 'purchase.invoice', partner: 'supplier', priced: true, priceField: 'purchasePrice', taxField: 'purchaseTaxId', warehouse: 'none', convertTo: [], payable: true, dueDate: true, partyLabel: 'Vendor', signatures: ['Verified by', 'Approved by'] },
  { code: 'ADJ', label: 'Stock Adjustment', printTitle: 'Stock Adjustment', module: 'inventory', permission: 'inventory.adjustment', partner: null, priced: false, warehouse: 'required', stock: 'adjust', convertTo: [], stockItemsOnly: true, signatures: ['Prepared by', 'Approved by'] },
  { code: 'TRF', label: 'Stock Transfer', printTitle: 'Stock Transfer', module: 'inventory', permission: 'inventory.transfer', partner: null, priced: false, warehouse: 'transfer', stock: 'transfer', convertTo: [], stockItemsOnly: true, signatures: ['Sent by', 'Received by'] },
];

export const DOC_MAP = new Map(DOC_TYPES.map((d) => [d.code, d]));
