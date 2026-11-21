import type { Table13DocumentNature, Table13DocumentSummary } from '../types'

export const TABLE13_DOCUMENT_NATURES: Table13DocumentNature[] = [
  'Invoices for outward supply',
  'Invoices for inward supply from unregistered person',
  'Revised Invoice',
  'Debit Note',
  'Credit Note',
  'Receipt Voucher',
  'Payment Voucher',
  'Refund Voucher',
  'Delivery Challan for job work',
  'Delivery Challan for supply on approval',
  'Delivery Challan in case of liquid gas',
  'Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)',
]

export function generateTable13(documents: Table13DocumentSummary[] = []) {
  return documents
}

interface SeriesEntry {
  prefix: string
  numbers: Map<string, bigint>
}

function seriesKey(documentNumber: string) {
  const match = documentNumber.match(/^(.*?)(\d+)$/)
  return match ? { prefix: match[1], serial: BigInt(match[2]) } : { prefix: documentNumber, serial: 0n }
}

function summariseSeries(
  nature: Table13DocumentNature,
  numbers: string[],
): Table13DocumentSummary[] {
  const series = new Map<string, SeriesEntry>()
  for (const raw of numbers) {
    const number = raw.trim()
    if (!number) continue
    const { prefix, serial } = seriesKey(number)
    const entry = series.get(prefix) ?? { prefix, numbers: new Map<string, bigint>() }
    entry.numbers.set(number.toUpperCase(), serial)
    series.set(prefix, entry)
  }
  return [...series.values()].map((entry) => {
    const sorted = [...entry.numbers.entries()].sort((left, right) =>
      left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : left[0].localeCompare(right[0]))
    return {
      natureOfDocument: nature,
      fromNumber: sorted[0][0],
      toNumber: sorted[sorted.length - 1][0],
      totalIssued: sorted.length,
      totalCancelled: 0,
    }
  })
}

/**
 * Suggests Table 13 rows from the document numbers in the uploaded file:
 * one row per numbering series (same prefix), counting distinct numbers.
 * Cancelled counts are left at 0 for the user to fill in.
 */
export function suggestTable13(records: Array<{
  invoiceNumber: string
  orderId: string
  documentType: string
}>): Table13DocumentSummary[] {
  const invoiceNumbers = records
    .filter((record) => record.documentType === 'invoice' && record.invoiceNumber
      && record.invoiceNumber !== record.orderId)
    .map((record) => record.invoiceNumber)
  const invoiceSet = new Set(invoiceNumbers.map((number) => number.trim().toUpperCase()))
  const creditNotes = records
    .filter((record) => record.documentType === 'credit_note' && record.invoiceNumber
      && !invoiceSet.has(record.invoiceNumber.trim().toUpperCase()))
    .map((record) => record.invoiceNumber)
  const debitNotes = records
    .filter((record) => record.documentType === 'debit_note' && record.invoiceNumber)
    .map((record) => record.invoiceNumber)

  return [
    ...summariseSeries('Invoices for outward supply', invoiceNumbers),
    ...summariseSeries('Credit Note', creditNotes),
    ...summariseSeries('Debit Note', debitNotes),
  ]
}
