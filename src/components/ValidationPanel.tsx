import { AlertCircle, CheckCircle2, Clock3, Info, TriangleAlert } from 'lucide-react'
import { getValidationStatusRows, type CheckStatus } from '../gst-engine/reconciliation'
import type { GstReport } from '../types'

interface ValidationPanelProps {
  report: GstReport
  sellerGstin: string
}

const statusLabels: Record<CheckStatus, string> = {
  passed: 'Passed',
  warning: 'Warnings',
  failed: 'Failed',
  pending: 'Pending review',
}

const statusIcons = {
  passed: CheckCircle2,
  warning: TriangleAlert,
  failed: AlertCircle,
  pending: Clock3,
}

function ValidationPanel({ report, sellerGstin }: ValidationPanelProps) {
  const statuses = getValidationStatusRows(report, sellerGstin)

  return (
    <section className="card validation-card" aria-labelledby="validation-title">
      <div className="section-heading">
        <div>
          <h2 id="validation-title">Validation Status</h2>
          <p>Review exceptions and unresolved data before downloading a return draft.</p>
        </div>
      </div>
      <div className="validation-table-wrap">
        <table className="validation-table">
          <thead>
            <tr><th scope="col">Validation</th><th scope="col">Status</th><th scope="col">Details</th></tr>
          </thead>
          <tbody>
            {statuses.map(({ label, status, detail }) => {
              const Icon = statusIcons[status]
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>
                    <span className={`status-pill status-${status}`}>
                      <Icon size={13} /> {statusLabels[status]}
                    </span>
                  </td>
                  <td>{detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="validation-issues">
        <h3>Detailed checks</h3>
        {report.issues.length === 0 ? (
          <div className="issue issue-success"><CheckCircle2 size={16} /> No row-level validation issues were reported.</div>
        ) : (
          <div className="issue-list">
            {report.issues.slice(0, 6).map((issue, index) => (
              <div className={`issue issue-${issue.severity}`} key={`${issue.row}-${index}`}>
                {issue.severity === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
                <span>{issue.row > 0 ? `Row ${issue.row}: ` : ''}{issue.message}</span>
              </div>
            ))}
            {report.issues.length > 6 && (
              <div className="issue">
                And {report.issues.length - 6} more issue(s); download the error report for the full list.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default ValidationPanel
