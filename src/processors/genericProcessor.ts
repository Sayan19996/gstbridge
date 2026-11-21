import type { CdnurType, DocumentType, Marketplace, SalesRecord, SupplyType } from '../types'
import { formatDate } from '../utils/dateFormatter'
import { normalizeUqc } from '../utils/uqc'
import { DERIVED } from './formatDetection'

type RawSalesFields = Pick<SalesRecord,
  | 'orderId'
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'customerName'
  | 'customerGstin'
  | 'placeOfSupply'
  | 'hsn'
  | 'description'
  | 'quantity'
  | 'taxableValue'
  | 'taxRate'
  | 'invoiceValue'
  | 'uqc'
  | 'reportedIgst'
  | 'reportedCgst'
  | 'reportedSgst'
  | 'reportedTaxAmount'
  | 'reportedCess'
  | 'reportedTcs'
  | 'supplyType'
  | 'documentType'
  | 'reverseCharge'
  | 'urType'
  | 'sellerGstin'
  | 'excludeReason'
>

// Derived "GSTBridge:" columns (added for recognised marketplace layouts) are listed
// first so they win over raw columns with similar names.
const aliases: Record<keyof RawSalesFields, string[]> = {
  orderId: ['order id', 'order number', 'order no', 'transaction id', 'sub order no', 'order item id'],
  invoiceNumber: [DERIVED.invoiceNumber, 'invoice number', 'invoice no', 'invoice id', 'bill number'],
  invoiceDate: [DERIVED.invoiceDate, 'invoice date', 'order date', 'date'],
  customerName: ['customer name', 'buyer name', 'billing name', 'receiver name'],
  customerGstin: [DERIVED.customerGstin, 'customer gstin', 'buyer gstin', 'gstin/uin of recipient', 'customer gst number', 'customer bill to gstid'],
  placeOfSupply: [DERIVED.placeOfSupply, 'place of supply', 'ship to state', 'shipping state', 'customer state', 'state'],
  hsn: ['hsn/sac', 'hsn', 'hsn code', 'sac', 'hsn sac'],
  description: ['product name', 'item description', 'product title/description', 'description', 'sku name', 'product title'],
  quantity: ['quantity', 'qty', 'item quantity', 'units'],
  taxableValue: [DERIVED.taxableValue, 'taxable value', 'taxable amount', 'net amount', 'item taxable value'],
  taxRate: [DERIVED.taxRate, 'gst rate', 'tax rate', 'gst %', 'gst percentage', 'rate'],
  invoiceValue: [DERIVED.invoiceValue, 'invoice value', 'invoice amount', 'gross amount', 'total amount', 'order total'],
  uqc: ['uqc', 'unit of quantity code', 'unit'],
  reportedIgst: [DERIVED.igst, 'igst amount', 'integrated tax amount', 'igst'],
  reportedCgst: [DERIVED.cgst, 'cgst amount', 'central tax amount', 'cgst'],
  reportedSgst: [DERIVED.sgst, 'sgst amount', 'state tax amount', 'sgst', 'utgst'],
  reportedTaxAmount: [DERIVED.taxTotal, 'reported tax amount', 'tax amount', 'gst amount', 'total gst', 'total tax', 'total tax amount'],
  reportedCess: [DERIVED.cess, 'cess amount', 'cess'],
  reportedTcs: [DERIVED.tcs, 'tcs amount', 'tcs collected', 'tax collected at source amount', 'tax collected at source', 'tcs'],
  supplyType: [DERIVED.supplyType, 'supply type', 'supply category'],
  documentType: [DERIVED.documentType, 'document type', 'note type'],
  reverseCharge: ['reverse charge', 'rcm'],
  urType: ['ur type', 'unregistered recipient type'],
  sellerGstin: [DERIVED.sellerGstin, 'seller gstin', 'supplier gstin'],
  excludeReason: [DERIVED.exclude],
}

export type SalesField = keyof typeof aliases
export type SalesAliases = Partial<Record<SalesField, string[]>>
export type SalesColumnMapping = Record<SalesField, string>

const exactOnlyFields = new Set<SalesField>([
  'reportedIgst',
  'reportedCgst',
  'reportedSgst',
  'reportedTaxAmount',
  'reportedCess',
  'reportedTcs',
  'reverseCharge',
  'urType',
  'sellerGstin',
  'excludeReason',
])

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findColumn(headers: string[], names: string[], exactOnly = false) {
  const normalizedAliases = names.map(normalizeHeader)
  // Alias order is priority order: try every header against the first alias, then the next.
  for (const alias of normalizedAliases) {
    const exact = headers.find((header) => normalizeHeader(header) === alias)
    if (exact) return exact
  }
  if (exactOnly) return undefined
  for (const alias of normalizedAliases) {
    if (alias.length < 3) continue
    const partial = headers.find((header) => normalizeHeader(header).includes(alias))
    if (partial) return partial
  }
  return undefined
}

function getValue(row: Record<string, unknown>, names: string[], exactOnly = false): unknown {
  const column = findColumn(Object.keys(row), names, exactOnly)
  return column ? row[column] : ''
}

const derivedNames = new Set<string>(Object.values(DERIVED))

/** Marketplace aliases are added after the derived columns but before the generic ones. */
function mergeAliases(customAliases: SalesAliases): Record<SalesField, string[]> {
  const merged = {} as Record<SalesField, string[]>
  for (const field of Object.keys(aliases) as SalesField[]) {
    const base = aliases[field]
    merged[field] = [...new Set([
      ...base.filter((name) => derivedNames.has(name)),
      ...(customAliases[field] ?? []),
      ...base,
    ])]
  }
  return merged
}

export function createDefaultColumnMapping(
  headers: string[],
  customAliases: SalesAliases = {},
): SalesColumnMapping {
  const columnAliases = mergeAliases(customAliases)
  const mapping = {} as SalesColumnMapping

  for (const field of Object.keys(aliases) as SalesField[]) {
    mapping[field] = findColumn(headers, columnAliases[field], exactOnlyFields.has(field)) ?? ''
  }

  return mapping
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function asNullableText(value: unknown): string | null {
  const text = asText(value)
  return !text || /^(null|none|n\/a|na|urp|-+|0)$/i.test(text) ? null : text
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asText(value).replace(/[₹,\s%]/g, '')
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function asNullableNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || asText(value) === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const parsed = Number(asText(value).replace(/[₹,\s%]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

/** GST rates may arrive as 0.18 (fraction) or 18 (percent). */
function asRate(value: unknown): number {
  const rate = asNumber(value)
  const percent = rate > 0 && rate < 1 ? rate * 100 : rate
  return Math.round(percent * 1000) / 1000
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return /^(true|yes|y|1)$/i.test(asText(value))
}

function parseSupplyType(value: unknown): SupplyType {
  const normalized = asText(value).toLowerCase().replace(/[^a-z]/g, '')
  if (normalized.includes('deemedexport')) return 'deemed_export'
  if (normalized.includes('sez')) return 'sez'
  if (normalized.includes('export') || normalized.includes('overseas')
    || normalized.includes('international')) return 'export'
  if (normalized.includes('nongst')) return 'non_gst'
  if (normalized.includes('exempt')) return 'exempt'
  if (normalized.includes('nil')) return 'nil'
  return normalized ? 'domestic' : 'unknown'
}

function parseDocumentType(value: unknown, hasInvoiceNumber: boolean): DocumentType {
  const normalized = asText(value).toLowerCase()
  if (normalized.includes('credit')) return 'credit_note'
  if (normalized.includes('debit')) return 'debit_note'
  return normalized || hasInvoiceNumber ? 'invoice' : 'unknown'
}

function parseCdnurType(value: unknown): CdnurType | undefined {
  const normalized = asText(value).toUpperCase().replace(/[^A-Z]/g, '')
  if (normalized === 'B2CL' || normalized === 'EXPWP' || normalized === 'EXPWOP') {
    return normalized
  }
  return undefined
}

export function normalizeRows(
  rows: Record<string, unknown>[],
  marketplace: Marketplace,
  customAliases: SalesAliases = {},
  columnMapping?: SalesColumnMapping,
): SalesRecord[] {
  const columnAliases = mergeAliases(customAliases)

  return rows.map((row, index) => {
    const raw = Object.fromEntries(
      Object.entries(columnAliases).map(([field, names]) => [
        field,
        columnMapping
          ? columnMapping[field as SalesField] ? row[columnMapping[field as SalesField]] : ''
          : getValue(row, names, exactOnlyFields.has(field as SalesField)),
      ]),
    ) as Record<keyof typeof aliases, unknown>
    const invoiceValue = asNullableNumber(raw.invoiceValue)
    const documentType = parseDocumentType(raw.documentType, asText(raw.invoiceNumber) !== '')

    return {
      orderId: asText(raw.orderId),
      invoiceNumber: asText(raw.invoiceNumber) || asText(raw.orderId),
      invoiceDate: formatDate(raw.invoiceDate),
      customerName: asText(raw.customerName),
      customerGstin: asNullableText(raw.customerGstin)?.toUpperCase() ?? null,
      placeOfSupply: asText(raw.placeOfSupply),
      hsn: asText(raw.hsn),
      description: asText(raw.description),
      quantity: asNullableNumber(raw.quantity) ?? 0,
      taxableValue: asNumber(raw.taxableValue),
      taxRate: asRate(raw.taxRate),
      invoiceValue,
      uqc: normalizeUqc(asText(raw.uqc)) || asText(raw.uqc),
      supplyType: parseSupplyType(raw.supplyType),
      documentType,
      reverseCharge: asBoolean(raw.reverseCharge),
      urType: parseCdnurType(raw.urType),
      reportedIgst: asNullableNumber(raw.reportedIgst),
      reportedCgst: asNullableNumber(raw.reportedCgst),
      reportedSgst: asNullableNumber(raw.reportedSgst),
      reportedTaxAmount: asNullableNumber(raw.reportedTaxAmount),
      reportedCess: asNullableNumber(raw.reportedCess),
      reportedTcs: asNullableNumber(raw.reportedTcs),
      sellerGstin: asNullableText(raw.sellerGstin)?.toUpperCase() ?? undefined,
      excludeReason: asText(raw.excludeReason) || undefined,
      isCreditNote: documentType === 'credit_note',
      isDebitNote: documentType === 'debit_note',
      marketplace,
      sourceRow: index + 2,
    }
  })
}

export default function processGenericRows(rows: Record<string, unknown>[]) {
  return normalizeRows(rows, 'generic')
}
