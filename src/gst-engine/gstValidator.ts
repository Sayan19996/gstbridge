import { isValidGstin } from '../utils/gstinValidator'
import type { GstReportOptions, SalesRecord, ValidationIssue } from '../types'

const HSN_RULES_START = '2025-05'
const GSTIN_HSN_THRESHOLD = 5_00_00_000

function isValidInvoiceDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const [, year, month, day] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    .toISOString()
    .slice(0, 10) === value
}

function duplicateInvoiceLineKey(record: SalesRecord) {
  if (!record.invoiceNumber) return ''
  return JSON.stringify([
    record.orderId.trim().toUpperCase(),
    record.invoiceNumber.trim().toUpperCase(),
    record.invoiceDate,
    record.customerGstin ?? '',
    record.documentType,
    record.hsn.trim(),
    record.description.trim().toLowerCase(),
    record.quantity,
    record.uqc.trim().toUpperCase(),
    record.taxableValue,
    record.taxRate,
    record.reportedIgst ?? null,
    record.reportedCgst ?? null,
    record.reportedSgst ?? null,
    record.reportedCess ?? null,
  ])
}

export function validateSalesRecords(
  records: SalesRecord[],
  sellerGstin = '',
  options: GstReportOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { filingPeriod, annualAggregateTurnover, table13Documents = [] } = options
  const hasValidPeriod = filingPeriod !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(filingPeriod)
  const hasUnreportedCess = records.some((record) => record.reportedCess === undefined)

  if (sellerGstin && !isValidGstin(sellerGstin)) {
    issues.push({ row: 0, severity: 'error', message: 'Seller GSTIN failed format or checksum validation.' })
  }

  if (!hasValidPeriod) {
    issues.push({ row: 0, severity: 'warning', message: 'Select the monthly filing period to apply effective-date-specific GSTR-1 checks.' })
  } else if (filingPeriod >= HSN_RULES_START) {
    if (annualAggregateTurnover !== undefined && annualAggregateTurnover < 0) {
      issues.push({ row: 0, severity: 'error', message: 'Annual aggregate turnover cannot be negative.' })
    }
    if (annualAggregateTurnover === undefined) {
      issues.push({
        row: 0,
        severity: 'warning',
        message: 'Annual aggregate turnover was not provided; the applicable HSN digit requirement cannot be validated.',
      })
    }
    if (table13Documents.length === 0) {
      issues.push({
        row: 0,
        severity: 'warning',
        message: 'Table 13 applies from this return period; document-series details were not supplied. Confirm applicability and provide the required series data.',
      })
    }
  }

  records.forEach((record) => {
    if (!record.invoiceNumber) {
      // B2C small supplies are reported in aggregate, so a missing number only blocks registered-buyer rows.
      issues.push({
        row: record.sourceRow,
        severity: record.customerGstin ? 'error' : 'warning',
        message: 'Invoice number is missing.',
      })
    }
    if (!isValidInvoiceDate(record.invoiceDate)) {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Invoice date is missing or invalid.' })
    }
    if (record.customerGstin && !isValidGstin(record.customerGstin)) {
      issues.push({ row: record.sourceRow, severity: 'error', message: 'Customer GSTIN failed format or checksum validation.' })
    }
    const isNote = record.documentType === 'credit_note' || record.documentType === 'debit_note'
    if (!isNote && (record.taxableValue < 0 || (record.invoiceValue !== undefined && record.invoiceValue < 0))) {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Negative value found; verify credit-note treatment.' })
    }
    if (record.invoiceValue === undefined) {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Invoice value is missing; B2C Table 5/7 classification may require review.' })
    }
    if (record.taxRate < 0 || record.taxRate > 100) {
      issues.push({ row: record.sourceRow, severity: 'error', message: 'GST rate must be between 0 and 100.' })
    }
    if (record.supplyType === 'nil' || record.supplyType === 'exempt'
      || record.supplyType === 'non_gst') {
      const reportedTax = (record.reportedIgst ?? 0) + (record.reportedCgst ?? 0)
        + (record.reportedSgst ?? 0) + (record.reportedTaxAmount ?? 0)
      if (record.taxRate > 0 || reportedTax > 0) {
        issues.push({
          row: record.sourceRow,
          severity: 'warning',
          message: 'The transaction is marked nil/exempt/non-GST but has a non-zero rate or reported tax; verify its treatment.',
        })
      }
    }
    if (record.taxableValue === 0) {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Taxable value is zero or could not be read from this row.' })
    }
    if (!(Math.abs(record.quantity) > 0)) {
      issues.push({
        row: record.sourceRow,
        severity: 'warning',
        message: 'Quantity is missing or not positive; verify the HSN summary quantity.',
      })
    }
    if (!record.placeOfSupply && record.supplyType === 'domestic') {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Place of supply is missing; tax type cannot be confirmed.' })
    }
    if (record.documentType === 'unknown') {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'Document type could not be identified; verify invoice or credit/debit note treatment.' })
    }
    const exemptSupply = record.supplyType === 'nil' || record.supplyType === 'exempt'
      || record.supplyType === 'non_gst'
    if (!exemptSupply && record.taxRate > 0 && record.reportedIgst === undefined
      && record.reportedCgst === undefined && record.reportedSgst === undefined
      && record.reportedTaxAmount === undefined) {
      issues.push({
        row: record.sourceRow,
        severity: 'warning',
        message: 'Marketplace-reported tax was not found; any tax amount is estimated from the rate and must be reviewed.',
      })
    }

    const hasReportedSplit = record.reportedIgst !== undefined
      || record.reportedCgst !== undefined
      || record.reportedSgst !== undefined
    if (hasReportedSplit && record.reportedTaxAmount !== undefined) {
      const splitTotal = (record.reportedIgst ?? 0)
        + (record.reportedCgst ?? 0)
        + (record.reportedSgst ?? 0)
      if (Math.abs(splitTotal - record.reportedTaxAmount) > 0.02) {
        issues.push({
          row: record.sourceRow,
          severity: 'warning',
          message: 'Reported tax total does not match the reported IGST/CGST/SGST split; source values were retained.',
        })
      }
    } else if (record.reportedIgst !== undefined && record.reportedCgst !== undefined
      && record.reportedSgst !== undefined && record.taxRate > 0) {
      const reportedSplit = record.reportedIgst + record.reportedCgst + record.reportedSgst
      const estimatedTax = record.taxableValue * record.taxRate / 100
      const tolerance = Math.max(0.02, Math.abs(estimatedTax) * 0.0001)
      if (Math.abs(estimatedTax - reportedSplit) > tolerance) {
        issues.push({
          row: record.sourceRow,
          severity: 'warning',
          message: 'Reported tax components differ from the rate-based estimate; source values were retained. Review rounding, exemptions, and adjustments.',
        })
      }
    } else if (record.reportedTaxAmount !== undefined && record.taxRate > 0) {
      const calculatedTax = record.taxableValue * record.taxRate / 100
      const tolerance = Math.max(0.02, Math.abs(calculatedTax) * 0.0001)
      if (Math.abs(calculatedTax - record.reportedTaxAmount) > tolerance) {
        issues.push({
          row: record.sourceRow,
          severity: 'warning',
          message: 'Reported tax differs from the rate-based estimate; the reported amount was retained. Review rounding, exemptions, and adjustments.',
        })
      }
    }

    if (hasValidPeriod && filingPeriod >= HSN_RULES_START && !record.hsn) {
      issues.push({ row: record.sourceRow, severity: 'warning', message: 'HSN/SAC is missing for the filing period; verify Table 12 reporting requirements.' })
    } else if (hasValidPeriod && filingPeriod >= HSN_RULES_START && annualAggregateTurnover !== undefined) {
      const requiredDigits = annualAggregateTurnover > GSTIN_HSN_THRESHOLD ? 6 : 4
      const hsnDigits = record.hsn.replace(/\D/g, '').length
      if (hsnDigits < requiredDigits) {
        issues.push({
          row: record.sourceRow,
          severity: 'warning',
          message: `HSN/SAC needs at least ${requiredDigits} digits for the supplied turnover; verify the applicable requirement.`,
        })
      }
    }
  })

  const seenInvoiceLines = new Set<string>()
  records.forEach((record) => {
    const key = duplicateInvoiceLineKey(record)
    if (!key) return
    if (seenInvoiceLines.has(key)) {
      issues.push({
        row: record.sourceRow,
        severity: 'warning',
        message: `Possible duplicate invoice line detected for ${record.invoiceNumber}.`,
      })
    } else {
      seenInvoiceLines.add(key)
    }
  })

  if (hasValidPeriod && filingPeriod >= HSN_RULES_START && hasUnreportedCess) {
    issues.push({
      row: 0,
      severity: 'warning',
      message: 'Cess values were not found for every row; the HSN summary separates unreported cess rows from reported totals.',
    })
  }

  table13Documents.forEach((document) => {
    if (document.totalIssued < 0 || document.totalCancelled < 0
      || document.totalCancelled > document.totalIssued
      || !document.fromNumber || !document.toNumber
      || !document.natureOfDocument.trim()) {
      issues.push({
        row: 0,
        severity: 'error',
        message: `Table 13 document counts or serial range are invalid for ${document.natureOfDocument || 'the selected document nature'}.`,
      })
    }
  })

  return issues
}
