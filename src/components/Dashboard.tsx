import { getReconciliationSummary } from '../gst-engine/reconciliation'
import type { GstReport } from '../types'

interface DashboardProps {
  report: GstReport
}

const formatCurrency = (value: number) => value.toLocaleString('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

function Dashboard({ report }: DashboardProps) {
  const summary = getReconciliationSummary(report)

  return (
    <section className="card reconciliation-card" aria-label="GST return summary">
      <div className="section-heading">
        <div>
          <h2>GST Return Summary</h2>
          <p>Amounts are aggregated from the uploaded marketplace rows.</p>
        </div>
        <span className="row-count">{report.records.length} transactions</span>
      </div>
      <div className="reconciliation-table-wrap">
        <table className="reconciliation-table">
          <thead>
            <tr><th scope="col">Description</th><th scope="col">Amount</th></tr>
          </thead>
          <tbody>
            {summary.map((line) => (
              <tr className={line.label.startsWith('Net ') || line.label === 'Total GST' ? 'summary-total' : ''} key={line.label}>
                <th scope="row">
                  <span>{line.label}</span>
                  {line.note && <small>{line.note}</small>}
                </th>
                <td>{formatCurrency(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="summary-disclaimer">
        Credit note values are shown as positive magnitudes and deducted in the net value. Review the validation status before exporting or filing.
      </p>
    </section>
  )
}

export default Dashboard
