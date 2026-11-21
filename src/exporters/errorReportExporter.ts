import type { Gstr1Return } from '../gst-engine/gstr1Builder'
import type { GstReport, ValidationIssue } from '../types'

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

export function downloadErrorReport(report: GstReport, gstr1?: Gstr1Return) {
  const issues: ValidationIssue[] = [
    ...(gstr1?.blockers ?? []).map((message) => ({
      row: 0,
      severity: 'error' as const,
      message: `Export blocked: ${message}`,
    })),
    ...(gstr1?.warnings ?? []).map((message) => ({ row: 0, severity: 'warning' as const, message })),
    ...report.issues,
    ...report.excluded.map((record) => ({
      row: record.sourceRow,
      severity: 'warning' as const,
      message: `Left out: ${record.excludeReason ?? ''}`,
    })),
  ]
  const rows = issues.length > 0
    ? issues.map((issue) => [issue.row || '', issue.severity, issue.message])
    : [['', 'info', 'No validation issues or export blockers were found.']]
  const csv = [
    ['Source row', 'Severity', 'Details'].map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `GSTBridge_Error_Report_${/^\d{4}-\d{2}$/.test(report.filingPeriod) ? report.filingPeriod : 'review'}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
