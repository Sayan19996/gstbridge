import {
  getReconciliationSummary,
  getTcsReconciliation,
  getValidationStatusRows,
} from '../gst-engine/reconciliation'
import type { GstReport } from '../types'

const statusLabels = {
  passed: 'Passed',
  warning: 'Warnings',
  failed: 'Failed',
  pending: 'Pending review',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

export function printReport(report: GstReport, sellerGstin: string) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    throw new Error('The print window was blocked. Allow pop-ups to print or save as PDF.')
  }

  const summaryRows = getReconciliationSummary(report).map((line) => `
    <tr>
      <th>${escapeHtml(line.label)}${line.note ? `<small>${escapeHtml(line.note)}</small>` : ''}</th>
      <td>${line.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })}</td>
    </tr>`).join('')
  const validationRows = getValidationStatusRows(report, sellerGstin).map((row) => `
    <tr>
      <th>${escapeHtml(row.label)}</th>
      <td>${statusLabels[row.status]}</td>
      <td>${escapeHtml(row.detail)}</td>
    </tr>`).join('')
  const tcs = getTcsReconciliation(report)
  const tcsRows = [
    ['Marketplace-reported TCS', tcs.reportedTcs],
    ['Estimated taxable base', tcs.estimatedTaxableBase],
    ['Estimated TCS', tcs.estimatedTcs],
    ['GST portal TCS credit', tcs.portalTcsTotal],
    ['Marketplace vs estimate variance', tcs.reportedVsEstimateVariance],
    ['Marketplace vs portal variance', tcs.reportedVsPortalVariance],
  ].map(([label, amount]) => `
    <tr>
      <th>${escapeHtml(String(label))}</th>
      <td>${amount === null ? 'Not available' : Number(amount).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  })}</td>
    </tr>`).join('')
  const rows = report.records.map((record) => `
    <tr>
      <td>${escapeHtml(record.invoiceNumber)}</td>
      <td>${escapeHtml(record.invoiceDate)}</td>
      <td>${escapeHtml(record.customerGstin || 'Unregistered')}</td>
      <td>${escapeHtml(record.category)}</td>
      <td>${record.taxableValue.toFixed(2)}</td>
      <td>${(record.cgst + record.sgst + record.igst + (record.cess ?? 0)).toFixed(2)}</td>
    </tr>`).join('')

  printWindow.document.write(`<!doctype html>
    <html><head><title>GSTBridge report</title>
    <style>
      body{font:12px Arial,sans-serif;color:#20382e;margin:32px}
      h1{font-size:20px}h2{font-size:15px;margin-top:24px}p{color:#66766d}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:8px;border:1px solid #dce5df;text-align:left}
      th{background:#f1f6f2}
      small{display:block;color:#66766d;font-weight:400;margin-top:3px}
      @media print{body{margin:12mm}}
    </style></head><body>
    <h1>GSTBridge reconciliation summary</h1>
    <p>Draft summary · Period ${escapeHtml(report.filingPeriod || 'not specified')} · ${report.records.length} transactions · Review before filing.</p>
    <h2>GST Return Summary</h2>
    <table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <h2>Validation Status</h2>
    <table><thead><tr><th>Validation</th><th>Status</th><th>Details</th></tr></thead><tbody>${validationRows}</tbody></table>
    <h2>TCS Reconciliation</h2>
    <table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${tcsRows}</tbody></table>
    <p>${escapeHtml(tcs.estimateDetail)} ${escapeHtml(tcs.detail)}</p>
    <h2>Transactions</h2>
    <table><thead><tr><th>Invoice</th><th>Date</th><th>Customer GSTIN</th><th>Type</th><th>Taxable value</th><th>Tax components + cess</th></tr></thead>
    <tbody>${rows}</tbody></table>
    </body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}
