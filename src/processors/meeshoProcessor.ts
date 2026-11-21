import { normalizeRows } from './genericProcessor'
import type { SalesAliases, SalesColumnMapping } from './genericProcessor'

export const meeshoAliases: SalesAliases = {
  orderId: ['sub order no', 'order number', 'order id'],
  invoiceNumber: ['invoice no', 'invoice number', 'bill number'],
  invoiceDate: ['order date', 'invoice date'],
  customerGstin: ['customer gstin', 'buyer gstin'],
  placeOfSupply: ['customer state', 'shipping state', 'state'],
  hsn: ['hsn code', 'hsn'],
  taxableValue: ['taxable amount', 'taxable value', 'product price'],
  taxRate: ['gst rate', 'tax rate'],
  invoiceValue: ['order value', 'total amount', 'invoice amount'],
}

export default function processMeeshoRows(
  rows: Record<string, unknown>[],
  columnMapping?: SalesColumnMapping,
) {
  return normalizeRows(rows, 'meesho', meeshoAliases, columnMapping)
}
