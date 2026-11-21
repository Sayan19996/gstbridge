import { isValidGstin } from '../utils/gstinValidator'
import type { ClassifiedSalesRecord, GstReport } from '../types'

export type CheckStatus = 'passed' | 'warning' | 'failed' | 'pending'

export interface ReconciliationLine {
  label: string
  amount: number
  note?: string
}

export interface ValidationStatusRow {
  label: string
  status: CheckStatus
  detail: string
}

export interface GstReconciliationResult {
  status: CheckStatus
  detail: string
  variance?: number
}

export interface TcsReconciliationResult {
  status: CheckStatus
  detail: string
  estimateStatus: CheckStatus
  estimateDetail: string
  estimateComparisonStatus: CheckStatus
  estimateComparisonDetail: string
  reportedStatus: CheckStatus
  reportedDetail: string
  portalStatus: CheckStatus
  portalDetail: string
  portalComparisonStatus: CheckStatus
  portalComparisonDetail: string
  estimatedTaxableBase: number
  estimatedTcs: number
  reportedTcs: number | null
  portalTcsTotal: number | null
  reportedVsEstimateVariance: number | null
  reportedVsPortalVariance: number | null
}

const TCS_RATE_CHANGE_DATE = '2024-07-10'
const TCS_RATE_CHANGE_PERIOD = '2024-07'
const TCS_RECONCILIATION_TOLERANCE = 1

function isCreditNote(record: ClassifiedSalesRecord) {
  return record.isCreditNote || record.documentType === 'credit_note'
}

function isDebitNote(record: ClassifiedSalesRecord) {
  return record.isDebitNote || record.documentType === 'debit_note'
}

function noteSign(record: ClassifiedSalesRecord) {
  if (isCreditNote(record)) return -1
  return 1
}

function totalBy(records: ClassifiedSalesRecord[], value: (record: ClassifiedSalesRecord) => number) {
  return records.reduce((sum, record) => sum + value(record), 0)
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getTcsRate(invoiceDate: string, filingPeriod: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    if (invoiceDate < '2018-10-01') return null
    return invoiceDate < TCS_RATE_CHANGE_DATE ? 1 : 0.5
  }

  if (!/^\d{4}-\d{2}$/.test(filingPeriod) || filingPeriod < '2018-10') return null
  if (filingPeriod === TCS_RATE_CHANGE_PERIOD) return null
  return filingPeriod < TCS_RATE_CHANGE_PERIOD ? 1 : 0.5
}

function compareTcsAmounts(
  left: number | null,
  right: number | null,
  incomplete: boolean,
): { status: CheckStatus; variance: number | null; detail: string } {
  if (left === null || right === null) {
    return { status: 'pending', variance: null, detail: 'Required TCS amounts are not available.' }
  }

  const variance = roundMoney(left - right)
  if (Math.abs(variance) > TCS_RECONCILIATION_TOLERANCE) {
    return {
      status: 'warning',
      variance,
      detail: `Difference of ${Math.abs(variance).toFixed(2)} exceeds the ₹1.00 review tolerance.`,
    }
  }
  if (incomplete) {
    return {
      status: 'pending',
      variance,
      detail: 'Amounts are within tolerance, but some source rows still need review.',
    }
  }
  return { status: 'passed', variance, detail: 'Amounts are within the ₹1.00 review tolerance.' }
}

export function getTcsReconciliation(report: GstReport): TcsReconciliationResult {
  const eligibleRecords = report.records.filter((record) =>
    record.supplyType === 'domestic' && record.taxRate > 0 && !record.reverseCharge)
  const unclassifiedRows = report.records.filter((record) =>
    record.supplyType === 'unknown' && record.taxRate > 0).length
  const reverseChargeRows = report.records.filter((record) =>
    record.supplyType === 'domestic' && record.taxRate > 0 && record.reverseCharge).length
  const missingRateRows = report.records.filter((record) =>
    record.supplyType === 'domestic' && record.taxableValue > 0 && record.taxRate <= 0).length
  const nonDomesticTaxableRows = report.records.filter((record) =>
    record.supplyType !== 'domestic' && record.supplyType !== 'unknown'
      && record.taxableValue > 0 && record.taxRate > 0).length

  let estimatedTaxableBase = 0
  let estimatedTcs = 0
  let missingDateRateRows = 0
  for (const record of eligibleRecords) {
    const rate = getTcsRate(record.invoiceDate, report.filingPeriod)
    if (rate === null) {
      missingDateRateRows += 1
      continue
    }
    const signedTaxableValue = noteSign(record) * Math.abs(record.taxableValue)
    estimatedTaxableBase += signedTaxableValue
    estimatedTcs += signedTaxableValue * rate / 100
  }

  const reportedRecords = report.records.filter((record) => record.reportedTcs !== undefined)
  const reportedTcs = reportedRecords.length > 0
    ? roundMoney(totalBy(reportedRecords, (record) =>
      noteSign(record) * Math.abs(record.reportedTcs ?? 0)))
    : null
  const missingReportedRows = eligibleRecords.filter((record) => record.reportedTcs === undefined).length
  const hasIncompleteEstimate = unclassifiedRows > 0 || reverseChargeRows > 0
    || missingRateRows > 0 || nonDomesticTaxableRows > 0 || missingDateRateRows > 0
  const estimateStatus: CheckStatus = hasIncompleteEstimate ? 'pending' : 'passed'
  const estimateDetails = [
    'Estimate uses positive-rate domestic rows and the period-based TCS rate schedule.',
    `${unclassifiedRows} row(s) have an unknown supply type; ${reverseChargeRows} reverse-charge row(s), ${nonDomesticTaxableRows} non-domestic taxable row(s), and ${missingRateRows} domestic row(s) without a positive GST rate are not estimated.`,
    `${missingDateRateRows} row(s) lack a usable date for the applicable TCS rate.`,
    'This estimate does not determine Section 9(5) treatment, exemptions, or portal adjustments.',
  ]
  const estimateDetail = estimateDetails.join(' ')
  const reportedStatus: CheckStatus = reportedTcs === null || missingReportedRows > 0
    ? 'pending'
    : 'passed'
  const reportedDetail = reportedTcs === null
    ? 'Map and import a marketplace TCS amount column to compare reported TCS.'
    : missingReportedRows > 0
      ? `${missingReportedRows} taxable row(s) have no reported TCS amount.`
      : 'Reported TCS values are available for the estimated taxable rows.'
  const portalTcsTotal = report.portalTcsTotal ?? null
  const portalStatus: CheckStatus = portalTcsTotal === null ? 'pending' : 'passed'
  const portalDetail = portalTcsTotal === null
    ? 'Enter the matching-period GSTR-8 or GST portal TCS total.'
    : 'A portal/GSTR-8 TCS total was supplied for comparison.'

  const estimateComparison = compareTcsAmounts(
    reportedTcs,
    roundMoney(estimatedTcs),
    estimateStatus !== 'passed' || reportedStatus !== 'passed',
  )
  const portalComparison = compareTcsAmounts(
    reportedTcs,
    portalTcsTotal,
    reportedStatus !== 'passed',
  )
  const statuses = [estimateComparison.status, portalComparison.status]
  const status: CheckStatus = statuses.includes('warning')
    ? 'warning'
    : statuses.includes('failed')
      ? 'failed'
      : statuses.includes('pending') ? 'pending' : 'passed'
  const detail = `Marketplace vs estimate: ${estimateComparison.detail} Marketplace vs portal: ${portalComparison.detail}`

  return {
    status,
    detail,
    estimateStatus,
    estimateDetail,
    estimateComparisonStatus: estimateComparison.status,
    estimateComparisonDetail: estimateComparison.detail,
    reportedStatus,
    reportedDetail,
    portalStatus,
    portalDetail,
    portalComparisonStatus: portalComparison.status,
    portalComparisonDetail: portalComparison.detail,
    estimatedTaxableBase: roundMoney(estimatedTaxableBase),
    estimatedTcs: roundMoney(estimatedTcs),
    reportedTcs,
    portalTcsTotal,
    reportedVsEstimateVariance: estimateComparison.variance,
    reportedVsPortalVariance: portalComparison.variance,
  }
}

function reportedTax(record: ClassifiedSalesRecord) {
  if (record.taxStatus === 'unresolved' && record.reportedTaxAmount !== undefined) {
    return Math.abs(record.reportedTaxAmount) + Math.abs(record.cess ?? 0)
  }
  return Math.abs(record.igst) + Math.abs(record.cgst) + Math.abs(record.sgst)
    + Math.abs(record.cess ?? 0)
}

export function getReconciliationSummary(report: GstReport): ReconciliationLine[] {
  const sales = report.records.filter((record) => !isCreditNote(record) && !isDebitNote(record))
  const b2b = sales.filter((record) =>
    record.category === 'B2B' || record.category === 'B2B_REVERSE_CHARGE')
  const b2c = sales.filter((record) => record.category === 'B2CL' || record.category === 'B2CS')
  const other = sales.filter((record) =>
    record.category !== 'B2B'
    && record.category !== 'B2B_REVERSE_CHARGE'
    && record.category !== 'B2CL'
    && record.category !== 'B2CS')
  const creditNotes = report.records.filter(isCreditNote)
  const debitNotes = report.records.filter(isDebitNote)
  const grossSales = totalBy(sales, (record) => record.taxableValue)
  const creditNoteValue = totalBy(creditNotes, (record) => Math.abs(record.taxableValue))
  const debitNoteValue = totalBy(debitNotes, (record) => Math.abs(record.taxableValue))
  const taxTotal = totalBy(report.records, (record) => noteSign(record) * reportedTax(record))

  return [
    { label: 'Total sales (taxable, before notes)', amount: grossSales },
    { label: 'B2B taxable value', amount: totalBy(b2b, (record) => record.taxableValue) },
    { label: 'B2C taxable value', amount: totalBy(b2c, (record) => record.taxableValue) },
    { label: 'Credit notes', amount: creditNoteValue, note: 'Shown separately; deducted in net value.' },
    { label: 'Debit notes', amount: debitNoteValue, note: 'Shown separately; added in net value.' },
    { label: 'Other transactions', amount: totalBy(other, (record) => record.taxableValue) },
    { label: 'Net taxable value after notes', amount: grossSales - creditNoteValue + debitNoteValue },
    {
      label: 'Total GST',
      amount: taxTotal,
      note: report.records.some((record) => record.taxStatus !== 'reported')
        ? 'Includes estimated or incomplete tax; review before filing.'
        : 'Sum of imported tax components and cess.',
    },
  ]
}

export function reconcileGstReport(report: GstReport): GstReconciliationResult {
  if (report.records.length === 0) {
    return { status: 'pending', detail: 'No transactions are available to reconcile.' }
  }

  const groups = new Map<string, {
    invoiceValue: number
    lineValue: number
    inconsistentInvoiceValue: boolean
  }>()
  let incompleteRows = 0

  for (const record of report.records) {
    if (!record.invoiceNumber || !record.invoiceDate || record.invoiceValue === undefined
      || record.documentType === 'unknown' || record.taxStatus !== 'reported'
      || record.cess === null) {
      incompleteRows += 1
      continue
    }

    const key = JSON.stringify([
      record.invoiceNumber.trim().toUpperCase(),
      record.invoiceDate,
      record.customerGstin ?? '',
      record.documentType,
    ])
    const sign = noteSign(record)
    const lineValue = Math.abs(record.taxableValue) + Math.abs(record.igst)
      + Math.abs(record.cgst) + Math.abs(record.sgst) + Math.abs(record.cess)
    const invoiceValue = sign * Math.abs(record.invoiceValue)
    const current = groups.get(key)

    if (!current) {
      groups.set(key, { invoiceValue, lineValue: sign * lineValue, inconsistentInvoiceValue: false })
    } else {
      const tolerance = Math.max(0.02, Math.abs(current.invoiceValue) * 0.0001)
      if (Math.abs(current.invoiceValue - invoiceValue) > tolerance) {
        current.inconsistentInvoiceValue = true
      }
      current.lineValue += sign * lineValue
    }
  }

  const variances: number[] = []
  let ambiguousGroups = 0
  for (const group of groups.values()) {
    if (group.inconsistentInvoiceValue) {
      ambiguousGroups += 1
      continue
    }
    const variance = group.lineValue - group.invoiceValue
    const tolerance = Math.max(0.02, Math.abs(group.invoiceValue) * 0.0001)
    if (Math.abs(variance) > tolerance) variances.push(variance)
  }

  if (variances.length > 0) {
    const totalVariance = variances.reduce((sum, variance) => sum + variance, 0)
    return {
      status: 'warning',
      detail: `${variances.length} invoice group(s) have a difference between invoice value and taxable value plus tax.`,
      variance: totalVariance,
    }
  }
  if (incompleteRows > 0 || ambiguousGroups > 0 || groups.size === 0) {
    return {
      status: 'pending',
      detail: `${incompleteRows + ambiguousGroups} row/group(s) need invoice, tax, cess, or line-item review.`,
    }
  }
  return {
    status: 'passed',
    detail: `${groups.size} invoice group(s) reconcile within the rounding tolerance.`,
    variance: 0,
  }
}

export function getValidationStatusRows(report: GstReport, sellerGstin: string): ValidationStatusRow[] {
  const customerGstinInvalid = report.records.some((record) =>
    record.customerGstin !== null && !isValidGstin(record.customerGstin))
  const gstinFailed = !isValidGstin(sellerGstin) || customerGstinInvalid
  const gstinDetail = gstinFailed
    ? 'Seller or recipient GSTIN needs correction.'
    : 'Seller GSTIN and supplied recipient GSTINs passed structure checks.'

  const invoiceIssues = report.issues.filter((issue) =>
    /invoice number|invoice date|invoice value|document type/i.test(issue.message))
  const invoiceFieldsMissing = report.records.some((record) =>
    !record.invoiceNumber || !/^\d{4}-\d{2}-\d{2}$/.test(record.invoiceDate)
      || record.invoiceValue === undefined || record.documentType === 'unknown')
  const invoiceStatus: CheckStatus = invoiceIssues.some((issue) => issue.severity === 'error')
    ? 'failed'
    : invoiceIssues.length > 0 || invoiceFieldsMissing ? 'warning' : 'passed'

  const hsnRows = new Set(report.issues
    .filter((issue) => /HSN|UQC|turnover/i.test(issue.message))
    .map((issue) => issue.row))
  report.records.forEach((record) => {
    if (!record.hsn || !record.uqc) hsnRows.add(record.sourceRow)
  })

  const taxRows = new Set(report.issues
    .filter((issue) => /tax/i.test(issue.message))
    .map((issue) => issue.row))
  report.records.forEach((record) => {
    if (record.taxStatus !== 'reported') taxRows.add(record.sourceRow)
  })

  const duplicateCount = report.issues
    .filter((issue) => /possible duplicate invoice line/i.test(issue.message)).length
  const reconciliation = reconcileGstReport(report)
  const tcsReconciliation = getTcsReconciliation(report)

  return [
    { label: 'GSTIN validation', status: gstinFailed ? 'failed' : 'passed', detail: gstinDetail },
    {
      label: 'Invoice validation',
      status: invoiceStatus,
      detail: invoiceIssues.length > 0 || invoiceFieldsMissing
        ? `${Math.max(invoiceIssues.length, invoiceFieldsMissing ? 1 : 0)} issue(s) need review.`
        : 'Invoice numbers, dates, and values are present.',
    },
    {
      label: 'HSN validation',
      status: hsnRows.size > 0 ? 'warning' : 'passed',
      detail: hsnRows.size > 0 ? `${hsnRows.size} HSN/UQC check(s) need review.` : 'HSN and UQC checks passed.',
    },
    {
      label: 'Tax calculation',
      status: taxRows.size > 0 ? 'warning' : 'passed',
      detail: taxRows.size > 0
        ? `${taxRows.size} transaction(s) have estimated, incomplete, or mismatched tax.`
        : 'Reported tax components are available with no detected mismatch.',
    },
    {
      label: 'Duplicate invoices',
      status: duplicateCount > 0 ? 'warning' : 'passed',
      detail: duplicateCount > 0
        ? `${duplicateCount} possible duplicate invoice line(s) found.`
        : 'No identical invoice lines were detected.',
    },
    {
      label: 'GST reconciliation',
      status: reconciliation.status,
      detail: reconciliation.detail,
    },
    {
      label: 'TCS reconciliation',
      status: tcsReconciliation.status,
      detail: tcsReconciliation.detail,
    },
  ]
}
