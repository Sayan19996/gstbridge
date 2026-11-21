import { normalizeRows } from './genericProcessor'
import type { SalesAliases, SalesColumnMapping } from './genericProcessor'

export const amazonAliases: SalesAliases = {
  orderId: ['amazon order id', 'order id', 'amazon order number'],
  invoiceNumber: ['invoice number', 'seller invoice number', 'invoice no'],
  invoiceDate: ['invoice date', 'purchase date', 'order date'],
  customerGstin: ['buyer gstin', 'customer gstin'],
  placeOfSupply: ['ship to state', 'ship-state', 'state'],
  hsn: ['hsn', 'hsn/sac', 'hsn code'],
  taxableValue: ['item taxable value', 'taxable value', 'item price'],
  taxRate: ['gst rate', 'tax rate', 'item tax rate'],
  invoiceValue: ['total', 'invoice amount', 'item total'],
}

export default function processAmazonRows(
  rows: Record<string, unknown>[],
  columnMapping?: SalesColumnMapping,
) {
  return normalizeRows(rows, 'amazon', amazonAliases, columnMapping)
}
