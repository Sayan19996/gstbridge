import { generateB2B } from './b2bGenerator'
import { generateB2CL } from './b2clGenerator'
import { generateB2CS } from './b2csGenerator'
import { generateCDN } from './cdnGenerator'
import { generateHsnSummary } from './hsnGenerator'
import { generateTable13 } from './table13Generator'
import { generateTable14 } from './table14Generator'
import { validateSalesRecords } from './gstValidator'
import { calculateGST } from '../utils/taxCalculator'
import { isValidGstin, stateCodeFromPlace } from '../utils/gstinValidator'
import type {
  ClassifiedSalesRecord,
  GstCategory,
  GstReport,
  GstReportOptions,
  Gstr1Table,
  SalesRecord,
  TaxStatus,
} from '../types'

const B2CL_THRESHOLD_BEFORE_AUGUST_2024 = 250_000
const B2CL_THRESHOLD_FROM_AUGUST_2024 = 100_000
const B2CL_THRESHOLD_CHANGE_DATE = '2024-08-01'

function getInterstateStatus(record: SalesRecord, sellerGstin: string): boolean | null {
  const sellerState = isValidGstin(sellerGstin) ? sellerGstin.slice(0, 2) : ''
  const placeState = stateCodeFromPlace(record.placeOfSupply)
  const buyerGstin = record.customerGstin ?? ''
  const buyerState = isValidGstin(buyerGstin)
    ? buyerGstin.slice(0, 2)
    : ''
  const destinationState = placeState || buyerState

  if (!sellerState || !destinationState) return null
  return sellerState !== destinationState
}

function getB2cThreshold(invoiceDate: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return undefined
  return invoiceDate < B2CL_THRESHOLD_CHANGE_DATE
    ? B2CL_THRESHOLD_BEFORE_AUGUST_2024
    : B2CL_THRESHOLD_FROM_AUGUST_2024
}

function classifyCategory(
  record: SalesRecord,
  interstate: boolean | null,
  sellerGstin: string,
  invoiceTotal?: number,
): GstCategory {
  if (record.isCreditNote || record.isDebitNote
    || record.documentType === 'credit_note' || record.documentType === 'debit_note') {
    return 'CDN'
  }

  switch (record.supplyType) {
    case 'export':
      return 'EXPORT'
    case 'sez':
      return 'SEZ'
    case 'deemed_export':
      return 'DEEMED_EXPORT'
    case 'nil':
    case 'exempt':
    case 'non_gst':
      return 'NIL_EXEMPT_NON_GST'
  }

  if (record.reverseCharge) {
    return record.customerGstin ? 'B2B_REVERSE_CHARGE' : 'REVERSE_CHARGE'
  }

  if (record.customerGstin) {
    return isValidGstin(record.customerGstin) ? 'B2B' : 'REVIEW_REQUIRED'
  }

  if (!sellerGstin || interstate === null) return 'REVIEW_REQUIRED'
  if (!interstate) return 'B2CS'

  const threshold = getB2cThreshold(record.invoiceDate)
  if (threshold === undefined) return 'REVIEW_REQUIRED'
  // B2CL is decided on the whole invoice value, not on a single line of it.
  const value = invoiceTotal ?? estimatedInvoiceValue(record)
  return Math.abs(value) > threshold ? 'B2CL' : 'B2CS'
}

function estimatedInvoiceValue(record: SalesRecord) {
  if (record.invoiceValue !== undefined) return record.invoiceValue
  return record.taxableValue * (1 + record.taxRate / 100) + (record.reportedCess ?? 0)
}

/** Key used to add up the lines of one unregistered-buyer invoice. */
function b2cInvoiceKey(record: SalesRecord) {
  return record.invoiceNumber
    ? `${record.invoiceNumber.trim().toUpperCase()}|${record.invoiceDate}`
    : `row:${record.sourceFile ?? ''}:${record.sourceRow}`
}

/** Why a row should be left out of the return, or '' to include it. */
export function exclusionReason(record: SalesRecord, sellerGstin: string) {
  if (record.excludeReason) return record.excludeReason
  if (record.sellerGstin && isValidGstin(sellerGstin) && isValidGstin(record.sellerGstin)
    && record.sellerGstin !== sellerGstin.trim().toUpperCase()) {
    return `Belongs to another GSTIN (${record.sellerGstin})`
  }
  return ''
}

function resolveTax(record: SalesRecord, interstate: boolean | null): {
  cgst: number
  sgst: number
  igst: number
  taxStatus: TaxStatus
} {
  const parts = [record.reportedIgst, record.reportedCgst, record.reportedSgst]
  const hasReportedPart = parts.some((value) => value !== undefined)

  if (hasReportedPart) {
    const taxStatus = parts.every((value) => value !== undefined) ? 'reported' : 'partially_reported'
    return {
      igst: record.reportedIgst ?? 0,
      cgst: record.reportedCgst ?? 0,
      sgst: record.reportedSgst ?? 0,
      taxStatus,
    }
  }

  if (record.reportedTaxAmount !== undefined) {
    if (interstate === null) {
      return { igst: 0, cgst: 0, sgst: 0, taxStatus: 'unresolved' }
    }
    if (interstate) {
      return { igst: record.reportedTaxAmount, cgst: 0, sgst: 0, taxStatus: 'partially_reported' }
    }
    const halfTax = Math.round((record.reportedTaxAmount / 2 + Number.EPSILON) * 100) / 100
    return {
      igst: 0,
      cgst: halfTax,
      sgst: record.reportedTaxAmount - halfTax,
      taxStatus: 'partially_reported',
    }
  }

  if (record.supplyType === 'nil' || record.supplyType === 'exempt'
    || record.supplyType === 'non_gst') {
    return { igst: 0, cgst: 0, sgst: 0, taxStatus: 'estimated' }
  }

  if (interstate === null) {
    return { igst: 0, cgst: 0, sgst: 0, taxStatus: 'unresolved' }
  }

  return {
    ...calculateGST(record.taxableValue, record.taxRate, interstate),
    taxStatus: 'estimated',
  }
}

function getReturnTable(category: GstCategory): Gstr1Table | null {
  switch (category) {
    case 'B2B':
      return '4A'
    case 'B2B_REVERSE_CHARGE':
    case 'REVERSE_CHARGE':
      return '4B'
    case 'B2CL':
      return '5'
    case 'B2CS':
      return '7'
    case 'EXPORT':
      return '6A'
    case 'SEZ':
      return '6B'
    case 'DEEMED_EXPORT':
      return '6C'
    case 'NIL_EXEMPT_NON_GST':
      return '8'
    case 'CDN':
      return '9B'
    case 'REVIEW_REQUIRED':
      return null
  }
}

export function classifyTransaction(
  transaction: SalesRecord,
  sellerGstin = '',
  invoiceTotal?: number,
): ClassifiedSalesRecord {
  const interstate = transaction.supplyType === 'export'
    || transaction.supplyType === 'sez'
    ? null
    : getInterstateStatus(transaction, sellerGstin)
  const category = classifyCategory(transaction, interstate, sellerGstin, invoiceTotal)
  const tax = resolveTax(transaction, interstate)

  return {
    ...transaction,
    category,
    returnTable: getReturnTable(category),
    interstate,
    ...tax,
    cess: transaction.reportedCess ?? null,
  }
}

export function classifyRecord(record: SalesRecord, sellerGstin = ''): ClassifiedSalesRecord {
  return classifyTransaction(record, sellerGstin)
}

export function generateGstReport(
  records: SalesRecord[],
  sellerGstin = '',
  options: GstReportOptions = {},
): GstReport {
  const excluded = records
    .map((record) => ({ ...record, excludeReason: exclusionReason(record, sellerGstin) }))
    .filter((record) => record.excludeReason)
  const included = records.filter((record) => !exclusionReason(record, sellerGstin))

  const invoiceTotals = new Map<string, number>()
  for (const record of included) {
    if (record.customerGstin || record.documentType !== 'invoice') continue
    const key = b2cInvoiceKey(record)
    invoiceTotals.set(key, (invoiceTotals.get(key) ?? 0) + Math.abs(estimatedInvoiceValue(record)))
  }

  const classified = included.map((record) => classifyTransaction(
    record,
    sellerGstin,
    record.customerGstin || record.documentType !== 'invoice' ? undefined : invoiceTotals.get(b2cInvoiceKey(record)),
  ))
  const issues = validateSalesRecords(included, sellerGstin, options)

  classified.forEach((record) => {
    if (record.category === 'REVIEW_REQUIRED') {
      issues.push({
        row: record.sourceRow,
        severity: 'warning',
        message: 'Transaction category is unresolved from the supplied GSTIN, place-of-supply, invoice-date, and supply-type data.',
      })
    }
    if (record.taxStatus === 'unresolved') {
      issues.push({
        row: record.sourceRow,
        severity: 'warning',
        message: 'Tax components could not be determined without usable place-of-supply and seller registration data.',
      })
    }
  })

  if (!sellerGstin) {
    issues.unshift({
      row: 0,
      severity: 'warning',
      message: 'Enter the seller GSTIN to determine intra-state versus inter-state tax accurately.',
    })
  }

  return {
    filingPeriod: options.filingPeriod ?? '',
    annualAggregateTurnover: options.annualAggregateTurnover,
    records: classified,
    excluded,
    b2b: generateB2B(classified),
    reverseCharge: classified.filter((record) =>
      record.category === 'B2B_REVERSE_CHARGE' || record.category === 'REVERSE_CHARGE'),
    b2cl: generateB2CL(classified),
    b2cs: generateB2CS(classified),
    cdn: generateCDN(classified),
    exports: classified.filter((record) => record.category === 'EXPORT'),
    sez: classified.filter((record) => record.category === 'SEZ'),
    deemedExports: classified.filter((record) => record.category === 'DEEMED_EXPORT'),
    nilExemptNonGst: classified.filter((record) => record.category === 'NIL_EXEMPT_NON_GST'),
    reviewRequired: classified.filter((record) => record.category === 'REVIEW_REQUIRED'),
    hsn: generateHsnSummary(classified),
    table13: generateTable13(options.table13Documents),
    table14: generateTable14(classified),
    portalTcsTotal: options.portalTcsTotal,
    b2csSupplyType: options.b2csSupplyType,
    ecommerceOperator: options.ecommerceOperator,
    ecommerceNatureOfSupply: options.ecommerceNatureOfSupply,
    issues,
  }
}
