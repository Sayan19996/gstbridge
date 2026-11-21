import type { Marketplace } from '../types'

/**
 * Known marketplace report layouts need values that span several columns
 * (e.g. Amazon splits GST rate into CGST/SGST/UTGST/IGST rate columns and marks
 * refunds in "Transaction Type"). Instead of hiding that logic, we add derived
 * columns prefixed "GSTBridge:" to each row. They appear in the column-mapping
 * screen like any other column, so the user can see and override them.
 */
export const DERIVED = {
  documentType: 'GSTBridge: Document type',
  invoiceNumber: 'GSTBridge: Invoice / note number',
  invoiceDate: 'GSTBridge: Invoice / note date',
  taxRate: 'GSTBridge: GST rate %',
  taxableValue: 'GSTBridge: Taxable value',
  invoiceValue: 'GSTBridge: Invoice value',
  igst: 'GSTBridge: IGST',
  cgst: 'GSTBridge: CGST',
  sgst: 'GSTBridge: SGST / UTGST',
  taxTotal: 'GSTBridge: Total tax',
  cess: 'GSTBridge: Cess',
  tcs: 'GSTBridge: TCS',
  sellerGstin: 'GSTBridge: Seller GSTIN',
  customerGstin: 'GSTBridge: Customer GSTIN',
  placeOfSupply: 'GSTBridge: Place of supply',
  supplyType: 'GSTBridge: Supply type',
  exclude: 'GSTBridge: Exclude reason',
} as const

export type DetectedFormat =
  | 'amazon-mtr'
  | 'flipkart-sales-report'
  | 'meesho-tcs-sales'
  | 'meesho-tcs-sales-return'

export const FORMAT_LABELS: Record<DetectedFormat, string> = {
  'amazon-mtr': 'Amazon Merchant Tax Report (MTR)',
  'flipkart-sales-report': 'Flipkart Sales Report',
  'meesho-tcs-sales': 'Meesho GST report (tcs_sales)',
  'meesho-tcs-sales-return': 'Meesho GST report (tcs_sales_return)',
}

type Row = Record<string, unknown>

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findHeader(headers: string[], ...candidates: string[]): string | undefined {
  const normalized = headers.map((header) => [header, norm(header)] as const)
  for (const candidate of candidates.map(norm)) {
    const exact = normalized.find(([, value]) => value === candidate)
    if (exact) return exact[0]
  }
  for (const candidate of candidates.map(norm)) {
    const prefix = normalized.find(([, value]) => value.startsWith(candidate))
    if (prefix) return prefix[0]
  }
  return undefined
}

function text(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const cleaned = text(value).replace(/[₹,\s%]/g, '')
  if (!cleaned) return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sum(row: Row, headers: Array<string | undefined>): number | undefined {
  let found = false
  let total = 0
  for (const header of headers) {
    if (!header) continue
    const value = num(row[header])
    if (value === undefined) continue
    found = true
    total += value
  }
  return found ? Math.round(total * 100) / 100 : undefined
}

/** Rates may be given as 0.09 (fraction) or 9 (percent). */
function percent(value: number | undefined) {
  if (value === undefined) return undefined
  const asPercent = Math.abs(value) > 0 && Math.abs(value) <= 1 ? value * 100 : value
  return Math.round(asPercent * 1000) / 1000
}

function rateFromComponents(row: Row, rateHeaders: Array<string | undefined>) {
  const parts = rateHeaders
    .filter((header): header is string => Boolean(header))
    .map((header) => num(row[header]))
    .filter((value): value is number => value !== undefined)
  if (parts.length === 0) return undefined
  // Convert each part individually so 0.09 + 0.09 becomes 18, not 0.18.
  return Math.round(parts.reduce((total, part) => total + (percent(part) ?? 0), 0) * 1000) / 1000
}

export function detectFormat(headers: string[], fileName = ''): DetectedFormat | null {
  const set = new Set(headers.map(norm))
  const has = (...names: string[]) => names.every((name) => [...set].some((value) =>
    value === norm(name) || value.startsWith(norm(name))))

  if (has('transaction type', 'tax exclusive gross') && (has('igst rate') || has('igst tax'))) {
    return 'amazon-mtr'
  }
  if (has('event type', 'igst rate') && (has('buyer invoice id') || has('order item id'))) {
    return 'flipkart-sales-report'
  }
  if (has('total taxable sale value') || (has('sub order num') && has('gst rate'))) {
    return /return/i.test(fileName) ? 'meesho-tcs-sales-return' : 'meesho-tcs-sales'
  }
  return null
}

export function expectedFormatsFor(marketplace: Marketplace): DetectedFormat[] {
  switch (marketplace) {
    case 'amazon': return ['amazon-mtr']
    case 'flipkart': return ['flipkart-sales-report']
    case 'meesho': return ['meesho-tcs-sales', 'meesho-tcs-sales-return']
    case 'generic': return []
  }
}

function enrichAmazon(rows: Row[], headers: string[]): Row[] {
  const h = (...names: string[]) => findHeader(headers, ...names)
  const transactionType = h('Transaction Type')
  const invoiceNumber = h('Invoice Number')
  const invoiceDate = h('Invoice Date')
  const creditNoteNumber = h('Credit Note No', 'Credit Note Number')
  const creditNoteDate = h('Credit Note Date')
  const taxable = h('Tax Exclusive Gross')
  const invoiceAmount = h('Invoice Amount')
  const totalTax = h('Total Tax Amount')
  const rateHeaders = [h('Cgst Rate'), h('Sgst Rate'), h('Utgst Rate'), h('Igst Rate')]
  const cessHeaders = [h('Compensatory Cess Tax'), h('Shipping Cess Tax Amount'), h('Gift Wrap Compensatory Cess Tax')]
  const tcsHeaders = [h('Tcs Cgst Amount'), h('Tcs Sgst Amount'), h('Tcs Utgst Amount'), h('Tcs Igst Amount')]
  const sellerGstin = h('Seller Gstin')
  const customerGstin = h('Customer Bill To Gstid', 'Customer Ship To Gstid', 'Buyer Gstin')
  const shipToState = h('Ship To State')
  const billToState = h('Bill To State')
  const shipToCountry = h('Ship To Country')

  return rows.map((row) => {
    const type = text(transactionType ? row[transactionType] : '').toLowerCase()
    const isRefund = type.includes('refund') || type.includes('return')
    const taxableValue = num(taxable ? row[taxable] : undefined)
    const invoiceValue = num(invoiceAmount ? row[invoiceAmount] : undefined)
    let exclude = ''
    if (type.includes('cancel')) exclude = 'Cancelled order (no supply)'
    else if (!taxableValue && !invoiceValue) exclude = 'Zero-value row'

    let rate = rateFromComponents(row, rateHeaders)
    const tax = num(totalTax ? row[totalTax] : undefined)
    if ((rate === undefined || rate === 0) && tax && taxableValue) {
      rate = Math.round(Math.abs(tax / taxableValue) * 10000) / 100
    }

    const noteNumber = creditNoteNumber ? text(row[creditNoteNumber]) : ''
    const noteDate = creditNoteDate ? row[creditNoteDate] : undefined

    return {
      ...row,
      [DERIVED.documentType]: isRefund ? 'Credit Note' : 'Invoice',
      [DERIVED.invoiceNumber]: isRefund && noteNumber ? noteNumber : text(invoiceNumber ? row[invoiceNumber] : ''),
      [DERIVED.invoiceDate]: isRefund && text(noteDate) ? noteDate : (invoiceDate ? row[invoiceDate] : null),
      [DERIVED.taxRate]: rate ?? null,
      [DERIVED.taxableValue]: taxableValue ?? null,
      [DERIVED.invoiceValue]: invoiceValue ?? null,
      [DERIVED.taxTotal]: tax ?? null,
      [DERIVED.cess]: sum(row, cessHeaders) ?? 0,
      [DERIVED.tcs]: sum(row, tcsHeaders) ?? null,
      [DERIVED.sellerGstin]: sellerGstin ? text(row[sellerGstin]).toUpperCase() : null,
      [DERIVED.customerGstin]: customerGstin ? text(row[customerGstin]).toUpperCase() || null : null,
      [DERIVED.placeOfSupply]: text(shipToState ? row[shipToState] : '') || text(billToState ? row[billToState] : '') || null,
      [DERIVED.supplyType]: /^(in|ind|india)?$/i.test(text(shipToCountry ? row[shipToCountry] : '')) ? 'Domestic' : 'Export',
      [DERIVED.exclude]: exclude || null,
    }
  })
}

function enrichFlipkart(rows: Row[], headers: string[]): Row[] {
  const h = (...names: string[]) => findHeader(headers, ...names)
  const eventType = h('Event Type')
  const eventSubType = h('Event Sub Type')
  const invoiceId = h('Buyer Invoice ID', 'Invoice ID')
  const invoiceDate = h('Buyer Invoice Date', 'Invoice Date', 'Order Date')
  const taxable = h('Taxable Value')
  const invoiceAmount = h('Final Invoice Amount', 'Buyer Invoice Amount')
  const igstRate = headers.find((header) => /^igstrate/.test(norm(header)))
  const cgstRate = headers.find((header) => /^cgstrate/.test(norm(header)))
  const sgstRate = headers.find((header) => /^(sgst|utgst)rate/.test(norm(header)))
  const igstAmount = headers.find((header) => /^igstamount/.test(norm(header)))
  const cgstAmount = headers.find((header) => /^cgstamount/.test(norm(header)))
  const sgstAmount = headers.find((header) => /^(sgst|utgst)amount/.test(norm(header)))
  const cess = h('Luxury Cess Amount', 'Cess Amount')
  const tcsTotal = h('Total TCS Deducted')
  const tcsParts = headers.filter((header) => /^tcs(igst|cgst|sgst|utgst)amount/.test(norm(header)))
  const sellerGstin = h('Seller GSTIN')
  const customerGstin = h('Business GST Number', 'Buyer GSTIN', 'Customer GSTIN')
  const deliveryState = h("Customer's Delivery State", 'Customer Delivery State')
  const billingState = h("Customer's Billing State", 'Customer Billing State')

  return rows.map((row) => {
    const event = `${text(eventType ? row[eventType] : '')} ${text(eventSubType ? row[eventSubType] : '')}`.toLowerCase()
    const isReturnCancellation = event.includes('return cancellation')
    const isCredit = !isReturnCancellation && (event.includes('return') || event.includes('cancellation'))
    const taxableValue = num(taxable ? row[taxable] : undefined)
    const invoiceValue = num(invoiceAmount ? row[invoiceAmount] : undefined)
    const igst = num(igstAmount ? row[igstAmount] : undefined)
    const cgst = num(cgstAmount ? row[cgstAmount] : undefined)
    const sgst = num(sgstAmount ? row[sgstAmount] : undefined)

    return {
      ...row,
      [DERIVED.documentType]: isCredit ? 'Credit Note' : 'Invoice',
      [DERIVED.invoiceNumber]: text(invoiceId ? row[invoiceId] : ''),
      [DERIVED.invoiceDate]: invoiceDate ? row[invoiceDate] : null,
      [DERIVED.taxRate]: rateFromComponents(row, [igstRate, cgstRate, sgstRate]) ?? null,
      [DERIVED.taxableValue]: taxableValue ?? null,
      [DERIVED.invoiceValue]: invoiceValue ?? null,
      [DERIVED.igst]: igst ?? null,
      [DERIVED.cgst]: cgst ?? null,
      [DERIVED.sgst]: sgst ?? null,
      [DERIVED.cess]: num(cess ? row[cess] : undefined) ?? 0,
      [DERIVED.tcs]: num(tcsTotal ? row[tcsTotal] : undefined) ?? sum(row, tcsParts) ?? null,
      [DERIVED.sellerGstin]: sellerGstin ? text(row[sellerGstin]).toUpperCase() : null,
      [DERIVED.customerGstin]: customerGstin ? text(row[customerGstin]).toUpperCase() || null : null,
      [DERIVED.placeOfSupply]: text(deliveryState ? row[deliveryState] : '') || text(billingState ? row[billingState] : '') || null,
      [DERIVED.supplyType]: 'Domestic',
      [DERIVED.exclude]: !taxableValue && !invoiceValue ? 'Zero-value row' : null,
    }
  })
}

function enrichMeesho(rows: Row[], headers: string[], isReturn: boolean): Row[] {
  const h = (...names: string[]) => findHeader(headers, ...names)
  const taxable = h('total_taxable_sale_value', 'Taxable Value')
  const shipping = h('taxable_shipping')
  const rate = h('gst_rate', 'GST Rate')
  const taxAmount = h('tax_amount')
  const invoiceValue = h('total_invoice_value')
  const orderDate = h('order_date')
  const state = h('end_customer_state_new', 'end_customer_state')
  const sellerGstin = h('gstin')
  const subOrder = h('sub_order_num', 'sub_order_no')

  return rows.map((row) => {
    const taxableValue = sum(row, [taxable, shipping])
    const total = num(invoiceValue ? row[invoiceValue] : undefined)
    return {
      ...row,
      [DERIVED.documentType]: isReturn ? 'Credit Note' : 'Invoice',
      // Meesho's GST report has no invoice numbers; B2C rows are reported in aggregate (Table 7).
      [DERIVED.invoiceNumber]: subOrder ? text(row[subOrder]) : '',
      [DERIVED.invoiceDate]: orderDate ? row[orderDate] : null,
      [DERIVED.taxRate]: percent(num(rate ? row[rate] : undefined)) ?? null,
      [DERIVED.taxableValue]: taxableValue ?? null,
      [DERIVED.invoiceValue]: total ?? null,
      [DERIVED.taxTotal]: num(taxAmount ? row[taxAmount] : undefined) ?? null,
      [DERIVED.cess]: 0,
      [DERIVED.sellerGstin]: sellerGstin ? text(row[sellerGstin]).toUpperCase() : null,
      [DERIVED.placeOfSupply]: state ? text(row[state]) || null : null,
      [DERIVED.supplyType]: 'Domestic',
      [DERIVED.exclude]: !taxableValue && !total ? 'Zero-value row' : null,
    }
  })
}

export function enrichRows(rows: Row[], fileName = ''): { rows: Row[]; format: DetectedFormat | null } {
  if (rows.length === 0) return { rows, format: null }
  const headers = Object.keys(rows[0])
  const format = detectFormat(headers, fileName)
  switch (format) {
    case 'amazon-mtr':
      return { rows: enrichAmazon(rows, headers), format }
    case 'flipkart-sales-report':
      return { rows: enrichFlipkart(rows, headers), format }
    case 'meesho-tcs-sales':
      return { rows: enrichMeesho(rows, headers, false), format }
    case 'meesho-tcs-sales-return':
      return { rows: enrichMeesho(rows, headers, true), format }
    default:
      return { rows, format: null }
  }
}
