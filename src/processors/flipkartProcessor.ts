import { normalizeRows } from './genericProcessor'
import type { SalesAliases, SalesColumnMapping } from './genericProcessor'

export const flipkartAliases: SalesAliases = {
  orderId: ['order item id', 'order id', 'sub order id'],
  invoiceNumber: ['invoice id', 'invoice number', 'seller invoice number'],
  invoiceDate: ['invoice date', 'order date'],
  customerGstin: ['buyer gstin', 'customer gstin'],
  placeOfSupply: ['ship to state', 'customer state', 'state'],
  hsn: ['hsn code', 'hsn', 'sac code'],
  taxableValue: ['taxable value', 'taxable amount', 'selling price'],
  taxRate: ['gst rate', 'tax rate'],
  invoiceValue: ['total amount', 'invoice amount', 'selling price'],
}

export default function processFlipkartRows(
  rows: Record<string, unknown>[],
  columnMapping?: SalesColumnMapping,
) {
  return normalizeRows(rows, 'flipkart', flipkartAliases, columnMapping)
}
