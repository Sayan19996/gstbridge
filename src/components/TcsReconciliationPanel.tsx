import { AlertCircle, CheckCircle2, Clock3, TriangleAlert } from 'lucide-react'
import { getTcsReconciliation, type CheckStatus } from '../gst-engine/reconciliation'
import type { GstReport } from '../types'

interface TcsReconciliationPanelProps {
  report: GstReport
  portalTcsInput: string
  onPortalTcsInputChange: (value: string) => void
}

const statusLabels: Record<CheckStatus, string> = {
  passed: 'Passed',
  warning: 'Review difference',
  failed: 'Failed',
  pending: 'Pending review',
}

const statusIcons = {
  passed: CheckCircle2,
  warning: TriangleAlert,
  failed: AlertCircle,
  pending: Clock3,
}

function formatCurrency(value: number | null) {
  return value === null
    ? 'Not available'
    : value.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    })
}

function TcsReconciliationPanel({
  report,
  portalTcsInput,
  onPortalTcsInputChange,
}: TcsReconciliationPanelProps) {
  const reconciliation = getTcsReconciliation(report)
  const parsedPortalTcs = portalTcsInput.trim() === '' ? undefined : Number(portalTcsInput)
  const invalidPortalTcs = parsedPortalTcs !== undefined
    && (!Number.isFinite(parsedPortalTcs) || parsedPortalTcs < 0)

  const comparisons = [
    {
      label: 'Marketplace vs statutory estimate',
      status: reconciliation.estimateComparisonStatus,
      detail: reconciliation.estimateComparisonDetail,
      variance: reconciliation.reportedVsEstimateVariance,
    },
    {
      label: 'Marketplace vs GST portal credit',
      status: reconciliation.portalComparisonStatus,
      detail: reconciliation.portalComparisonDetail,
      variance: reconciliation.reportedVsPortalVariance,
    },
  ]

  return (
    <section className="card tcs-card" aria-labelledby="tcs-title">
      <div className="section-heading">
        <div>
          <h2 id="tcs-title">TCS Reconciliation</h2>
          <p>Compare TCS reported by the marketplace with an estimate and your portal statement.</p>
        </div>
      </div>
      <div className="tcs-portal-input">
        <label className="form-control">
          <span>GST portal TCS credit for {report.filingPeriod || 'this period'}</span>
          <input
            aria-describedby="tcs-portal-help"
            className="market-select"
            min="0"
            placeholder="Enter portal total"
            step="0.01"
            type="number"
            value={portalTcsInput}
            onChange={(event) => onPortalTcsInputChange(event.currentTarget.value)}
          />
        </label>
        <small id="tcs-portal-help">Enter the matching GSTIN and return-period credit reflected from GSTR-8, not a payout amount.</small>
        {invalidPortalTcs && (
          <p className="tcs-input-error" role="alert">Enter a valid non-negative TCS amount.</p>
        )}
      </div>

      <div className="reconciliation-table-wrap">
        <table className="reconciliation-table tcs-table">
          <thead><tr><th scope="col">TCS amount</th><th scope="col">Value</th></tr></thead>
          <tbody>
            <tr><th scope="row">Marketplace-reported TCS</th><td>{formatCurrency(reconciliation.reportedTcs)}</td></tr>
            <tr><th scope="row">Estimated taxable base</th><td>{formatCurrency(reconciliation.estimatedTaxableBase)}</td></tr>
            <tr><th scope="row">Estimated TCS</th><td>{formatCurrency(reconciliation.estimatedTcs)}</td></tr>
            <tr><th scope="row">GST portal TCS credit</th><td>{formatCurrency(reconciliation.portalTcsTotal)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="tcs-comparisons">
        {comparisons.map(({ label, status, detail, variance }) => {
          const Icon = statusIcons[status]
          return (
            <div className="tcs-comparison" key={label}>
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
              <div className="tcs-comparison-result">
                <span className={`status-pill status-${status}`}><Icon size={13} /> {statusLabels[status]}</span>
                <small>Variance: {formatCurrency(variance)}</small>
              </div>
            </div>
          )
        })}
      </div>

      <p className="tcs-disclaimer">
        Estimate uses a 1% rate through 9 July 2024 and 0.5% from 10 July 2024, applied to positive-rate domestic rows.
        It does not determine Section 9(5) treatment, exemptions, or portal adjustments. Verify the estimate against GSTR-8.
      </p>
    </section>
  )
}

export default TcsReconciliationPanel
