import type { ClassifiedSalesRecord, HsnSummary } from '../types'

export function generateHsnSummary(records: ClassifiedSalesRecord[]): HsnSummary[] {
  const summary = new Map<string, HsnSummary>()

  for (const record of records) {
    const sign = record.isCreditNote || record.documentType === 'credit_note' ? -1 : 1
    const hsn = record.hsn || 'Not provided'
    const key = JSON.stringify([hsn, record.description, record.uqc, record.taxRate])
    const current = summary.get(key) ?? {
      hsn,
      description: record.description,
      uqc: record.uqc,
      taxRate: record.taxRate,
      quantity: 0,
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      cessUnreportedRows: 0,
      unallocatedTax: 0,
    }

    current.quantity += sign * Math.abs(record.quantity)
    current.taxableValue += sign * Math.abs(record.taxableValue)
    current.igst += sign * Math.abs(record.igst)
    current.cgst += sign * Math.abs(record.cgst)
    current.sgst += sign * Math.abs(record.sgst)
    current.cess += sign * Math.abs(record.cess ?? 0)
    if (record.cess === null) current.cessUnreportedRows += 1
    if (record.taxStatus === 'unresolved') {
      current.unallocatedTax += sign * Math.abs(record.reportedTaxAmount ?? 0)
    }
    summary.set(key, current)
  }

  return [...summary.values()]
}
