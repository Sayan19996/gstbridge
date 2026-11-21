import { useState } from 'react'
import {
  AlertCircle, AlertTriangle, CheckCircle2, CreditCard, Download, FileJson, FileSpreadsheet,
  FileWarning, LoaderCircle, LockKeyhole, Printer,
} from 'lucide-react'
import { downloadExcel, downloadOfficialGstnTemplate } from '../exporters/excelExporter'
import { downloadGstr1Json } from '../exporters/jsonExporter'
import { downloadErrorReport } from '../exporters/errorReportExporter'
import { printReport } from '../exporters/pdfExporter'
import {
  PRICE_RUPEES, PaymentBackendMissingError, PaymentCancelledError, findReceipt, payForExport,
  simulatePaymentForDevelopment,
} from '../payments/payment'
import type { ExportReceipt } from '../payments/payment'
import type { Gstr1Return } from '../gst-engine/gstr1Builder'
import type { GstReport } from '../types'

interface DownloadPanelProps {
  report: GstReport
  gstr1: Gstr1Return
  sellerGstin: string
}

const inr = (value: number) => value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

function DownloadPanel({ report, gstr1, sellerGstin }: DownloadPanelProps) {
  const [busy, setBusy] = useState<'' | 'pay' | 'excel' | 'json'>('')
  const [message, setMessage] = useState('')
  const [canSimulate, setCanSimulate] = useState(false)
  // Kept in state as well as localStorage so the unlock works even when storage is blocked.
  const [lastReceipt, setReceipt] = useState<ExportReceipt | undefined>()
  const receipt = lastReceipt && lastReceipt.gstin === gstr1.gstin && lastReceipt.period === gstr1.period
    ? lastReceipt
    : findReceipt(gstr1.gstin, gstr1.period)
  const ready = gstr1.blockers.length === 0

  const run = async (kind: 'excel' | 'json', action: () => Promise<void> | void) => {
    setBusy(kind)
    setMessage('')
    try {
      await action()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Download failed.')
    } finally {
      setBusy('')
    }
  }

  const pay = async () => {
    setBusy('pay')
    setMessage('')
    try {
      setReceipt(await payForExport(gstr1.gstin, gstr1.period))
    } catch (cause) {
      if (cause instanceof PaymentCancelledError) return
      if (cause instanceof PaymentBackendMissingError && import.meta.env.DEV) setCanSimulate(true)
      setMessage(cause instanceof Error ? cause.message : 'Payment failed.')
    } finally {
      setBusy('')
    }
  }

  const counts = [
    ['B2B invoices (4A)', gstr1.b2b.length],
    ['B2C large invoices (5)', gstr1.b2cl.length],
    ['B2C small rows (7)', gstr1.b2cs.length],
    ['Credit/debit notes (9B)', gstr1.cdnr.length + gstr1.cdnur.length],
    ['HSN rows (12)', gstr1.hsnB2b.length + gstr1.hsnB2c.length],
    ['Document series (13)', gstr1.docs.length],
    ['E-commerce operator (14)', gstr1.eco.length],
  ] as const

  return (
    <section className="card export-card">
      <div className="section-heading">
        <div>
          <h2 className="panel-title">Export GSTR-1</h2>
          <p className="download-intro">
            The JSON uploads directly at GST portal → Returns → GSTR-1 → Prepare Offline → Upload.
            The Excel is the official offline-tool workbook with the same data.
          </p>
        </div>
        <span className={`export-status ${ready ? 'ready' : 'blocked'}`}>
          {ready ? <><CheckCircle2 size={14} /> Ready to export</> : <><AlertCircle size={14} /> {gstr1.blockers.length} to fix</>}
        </span>
      </div>

      <div className="export-summary">
        {counts.map(([name, value]) => (
          <div key={name}><span>{name}</span><strong>{value}</strong></div>
        ))}
        <div><span>Net taxable value</span><strong>{inr(gstr1.totals.taxableValue)}</strong></div>
        <div><span>Net tax (IGST + CGST + SGST)</span><strong>{inr(gstr1.totals.igst + gstr1.totals.cgst + gstr1.totals.sgst)}</strong></div>
      </div>

      {!ready && (
        <div className="export-blockers" role="status">
          <strong>Fix these before exporting:</strong>
          <ul>{gstr1.blockers.slice(0, 25).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          {gstr1.blockers.length > 25 && <p>…and {gstr1.blockers.length - 25} more in the error report.</p>}
        </div>
      )}

      {gstr1.warnings.length > 0 && (
        <details className="export-warnings">
          <summary><AlertTriangle size={13} /> {gstr1.warnings.length} note(s) to review</summary>
          <ul>{gstr1.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}

      {receipt ? (
        <div className="paywall paid">
          <p className="paid-line">
            <CheckCircle2 size={15} /> Paid · {receipt.gstin} · {receipt.period} · Payment ID <code>{receipt.paymentId}</code>
            <small>Re-downloads and corrections for this GSTIN and month are free.</small>
          </p>
          <div className="downloads">
            <button className="download-button primary" disabled={!ready || busy !== ''} type="button"
              onClick={() => run('json', () => downloadGstr1Json(gstr1))}>
              {busy === 'json' ? <LoaderCircle size={15} className="spin" /> : <FileJson size={15} />} Download JSON (for GST portal)
            </button>
            <button className="download-button" disabled={!ready || busy !== ''} type="button"
              onClick={() => run('excel', () => downloadExcel(gstr1))}>
              {busy === 'excel' ? <LoaderCircle size={15} className="spin" /> : <FileSpreadsheet size={15} />} Download Excel (offline tool)
            </button>
          </div>
        </div>
      ) : (
        <div className="paywall">
          <div>
            <strong>₹{PRICE_RUPEES} per return</strong>
            <small>
              One payment unlocks JSON + Excel for <b>{gstr1.gstin || 'your GSTIN'}</b>, period <b>{gstr1.period}</b>.
              UPI, cards and net-banking via Razorpay.
            </small>
          </div>
          <button className="generate-button" disabled={!ready || busy !== ''} type="button" onClick={pay}>
            {busy === 'pay' ? <LoaderCircle size={16} className="spin" /> : <CreditCard size={16} />}
            Pay ₹{PRICE_RUPEES} &amp; unlock downloads
          </button>
          {!ready && <small className="paywall-note"><LockKeyhole size={12} /> Payment opens once everything above is fixed, so you never pay for a file that can't be filed.</small>}
          {import.meta.env.DEV && canSimulate && (
            <button className="text-button" type="button"
              onClick={() => setReceipt(simulatePaymentForDevelopment(gstr1.gstin, gstr1.period))}>
              Simulate payment (development only)
            </button>
          )}
        </div>
      )}

      {message && <p className="export-error" role="alert"><AlertCircle size={13} /> {message}</p>}

      <div className="downloads free-downloads">
        <button className="download-button" type="button" onClick={() => downloadErrorReport(report, gstr1)}>
          <FileWarning size={15} /> Error report (free)
        </button>
        <button className="download-button" type="button" onClick={() => {
          try { printReport(report, sellerGstin) } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Unable to open the print dialog.')
          }
        }}>
          <Printer size={15} /> PDF summary (free)
        </button>
        <button className="download-button" type="button" onClick={() => run('excel', downloadOfficialGstnTemplate)}>
          <Download size={15} /> Blank GSTN template
        </button>
      </div>
      <p className="download-note">
        Uses the GSTN offline tool v3.2.4 workbook (V2.2) layout. Uploading the JSON is not filing: review the
        summary on the portal, then file with EVC/DSC.
      </p>
    </section>
  )
}

export default DownloadPanel
