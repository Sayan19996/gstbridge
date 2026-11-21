import { useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, FileCheck2, LockKeyhole, Sparkles } from 'lucide-react'
import ColumnMapping from './components/ColumnMapping'
import Dashboard from './components/Dashboard'
import DownloadPanel from './components/DownloadPanel'
import FileUpload from './components/FileUpload'
import Header from './components/Header'
import MarketplaceSelector from './components/MarketplaceSelector'
import TcsReconciliationPanel from './components/TcsReconciliationPanel'
import Table13DocumentsForm from './components/Table13DocumentsForm'
import ValidationPanel from './components/ValidationPanel'
import { exclusionReason, generateGstReport } from './gst-engine/gstClassifier'
import { buildGstr1 } from './gst-engine/gstr1Builder'
import { suggestTable13 } from './gst-engine/table13Generator'
import { createMarketplaceColumnMapping, processMarketplaceRows } from './processors'
import { FORMAT_LABELS, detectFormat, enrichRows, expectedFormatsFor } from './processors/formatDetection'
import type { DetectedFormat } from './processors/formatDetection'
import { DEFAULT_UQC_LABEL, OFFICIAL_UQC_LABELS } from './utils/uqc'
import type { SalesColumnMapping } from './processors'
import { readExcel } from './utils/excelReader'
import type { ExcelWorkbook } from './utils/excelReader'
import { isValidGstin } from './utils/gstinValidator'
import type {
  SalesRecord,
  B2CSSupplyType,
  EcommerceNatureOfSupply,
  Marketplace,
  Table13DocumentSummary,
} from './types'
import './App.css'

function financialYearFor(date: Date) {
  const startYear = date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear()
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

const today = new Date()
const currentFinancialYear = financialYearFor(today)
const currentFinancialYearStart = Number(currentFinancialYear.slice(0, 4))
const periods = Array.from({ length: 5 }, (_, index) => {
  const startYear = currentFinancialYearStart - index
  return `${startYear}-${String(startYear + 1).slice(-2)}`
})
const months = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
]

interface UploadedFile {
  id: string
  name: string
  workbook: ExcelWorkbook
  sheet: string
}

const ECO_NAMES: Partial<Record<Marketplace, string>> = {
  amazon: 'Amazon Seller Services Private Limited',
  flipkart: 'Flipkart Internet Private Limited',
  meesho: 'Fashnear Technologies Private Limited',
}

const FORMAT_MARKETPLACE: Record<DetectedFormat, Marketplace> = {
  'amazon-mtr': 'amazon',
  'flipkart-sales-report': 'flipkart',
  'meesho-tcs-sales': 'meesho',
  'meesho-tcs-sales-return': 'meesho',
}

const TURNOVER_BANDS = {
  upto5: 5_00_00_000,
  above5: 5_00_00_001,
} as const

const NO_RECORDS: SalesRecord[] = []

function preferredSheet(workbook: ExcelWorkbook, fileName: string) {
  const sheets = Object.keys(workbook).filter((name) => workbook[name].length > 0)
  return sheets.find((name) => detectFormat(Object.keys(workbook[name][0]), fileName) !== null) ?? sheets[0] ?? ''
}

function App() {
  const [marketplace, setMarketplace] = useState<Marketplace>('amazon')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const enrichedFiles = useMemo(() => files.map((file) => {
    const { rows, format } = enrichRows(file.workbook[file.sheet] ?? [], file.name)
    return { ...file, rows, format }
  }), [files])
  const rawRows = useMemo(() => enrichedFiles.flatMap((file) => file.rows), [enrichedFiles])
  const allHeaders = useMemo(() => [...new Set(enrichedFiles.flatMap((file) =>
    file.rows.length > 0 ? Object.keys(file.rows[0]) : []))], [enrichedFiles])
  const [columnMapping, setColumnMapping] = useState<SalesColumnMapping | null>(null)
  const fileName = files.map((file) => file.name).join(', ')
  const [defaultUqc, setDefaultUqc] = useState(DEFAULT_UQC_LABEL)
  const [sellerGstin, setSellerGstin] = useState('')
  const [portalTcsInput, setPortalTcsInput] = useState('')
  const [b2csSupplyType, setB2csSupplyType] = useState<B2CSSupplyType>('E')
  const [ecommerceOperatorGstin, setEcommerceOperatorGstin] = useState('')
  const [ecommerceOperatorName, setEcommerceOperatorName] = useState(ECO_NAMES.amazon ?? '')
  const [ecommerceNatureOfSupply, setEcommerceNatureOfSupply] = useState<EcommerceNatureOfSupply | ''>('Liable to collect tax u/s 52(TCS)')
  const [table13Documents, setTable13Documents] = useState<Table13DocumentSummary[]>([])
  const [turnoverBand, setTurnoverBand] = useState<'' | keyof typeof TURNOVER_BANDS>('')
  const [financialPeriod, setFinancialPeriod] = useState(currentFinancialYear)
  const [returnMonth, setReturnMonth] = useState(String(today.getMonth() + 1).padStart(2, '0'))
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)

  const financialYearStart = Number(financialPeriod.slice(0, 4))
  const returnYear = Number(returnMonth) >= 4 ? financialYearStart : financialYearStart + 1
  const filingPeriod = `${returnYear}-${returnMonth}`
  const turnoverValue = turnoverBand ? TURNOVER_BANDS[turnoverBand] : undefined
  const portalTcsValue = portalTcsInput.trim() === '' ? undefined : Number(portalTcsInput)
  const validPortalTcsValue = portalTcsValue !== undefined
    && Number.isFinite(portalTcsValue)
    && portalTcsValue >= 0
    ? portalTcsValue
    : undefined
  const records = useMemo<SalesRecord[]>(
    () => enrichedFiles.flatMap((file) => processMarketplaceRows(marketplace, file.rows, columnMapping ?? undefined)
      .map((record) => ({ ...record, sourceFile: files.length > 1 ? file.name : undefined }))),
    [marketplace, enrichedFiles, columnMapping, files.length],
  )
  // The full return is only calculated after "Generate", so typing stays fast with large files.
  const baseReport = useMemo(
    () => generateGstReport(hasGenerated ? records : NO_RECORDS, sellerGstin, {
      filingPeriod,
      annualAggregateTurnover: turnoverValue,
      b2csSupplyType,
      ecommerceOperator: { gstin: ecommerceOperatorGstin, name: ecommerceOperatorName },
      ecommerceNatureOfSupply: ecommerceNatureOfSupply || undefined,
      table13Documents,
    }),
    [
      hasGenerated,
      records,
      sellerGstin,
      filingPeriod,
      turnoverValue,
      b2csSupplyType,
      ecommerceOperatorGstin,
      ecommerceOperatorName,
      ecommerceNatureOfSupply,
      table13Documents,
    ],
  )
  const report = useMemo(
    () => ({ ...baseReport, portalTcsTotal: validPortalTcsValue }),
    [baseReport, validPortalTcsValue],
  )
  const gstr1 = useMemo(
    () => buildGstr1(report, sellerGstin, { defaultUqc }),
    [report, sellerGstin, defaultUqc],
  )
  const suggestTable13FromFile = marketplace === 'meesho' || records.length === 0
    ? null
    : () => suggestTable13(records.filter((record) => !exclusionReason(record, sellerGstin)))
  const unexpectedFormats = enrichedFiles.filter((file) => {
    const expected = expectedFormatsFor(marketplace)
    return expected.length > 0 && file.format !== null && !expected.includes(file.format)
  })

  const handleMarketplaceChange = (nextMarketplace: Marketplace) => {
    setMarketplace(nextMarketplace)
    setPortalTcsInput('')
    setEcommerceOperatorGstin('')
    setEcommerceOperatorName(ECO_NAMES[nextMarketplace] ?? '')
    setEcommerceNatureOfSupply(nextMarketplace === 'generic' ? '' : 'Liable to collect tax u/s 52(TCS)')
    setB2csSupplyType(nextMarketplace === 'generic' ? 'OE' : 'E')
    if (allHeaders.length > 0) {
      setColumnMapping(createMarketplaceColumnMapping(nextMarketplace, allHeaders))
    }
    setHasGenerated(false)
    setError('')
  }

  const remap = (nextFiles: UploadedFile[], nextMarketplace: Marketplace) => {
    const headers = [...new Set(nextFiles.flatMap((file) => {
      const { rows } = enrichRows(file.workbook[file.sheet] ?? [], file.name)
      return rows.length > 0 ? Object.keys(rows[0]) : []
    }))]
    setColumnMapping(headers.length > 0 ? createMarketplaceColumnMapping(nextMarketplace, headers) : null)
  }

  const handleSheetChange = (fileId: string, nextSheet: string) => {
    const nextFiles = files.map((file) => file.id === fileId ? { ...file, sheet: nextSheet } : file)
    setFiles(nextFiles)
    remap(nextFiles, marketplace)
    setHasGenerated(false)
    setError('')
  }

  const handleFiles = async (selected: File[]) => {
    setIsLoading(true)
    setError('')
    setHasGenerated(false)
    try {
      const added: UploadedFile[] = []
      for (const file of selected) {
        const workbook = await readExcel(file)
        const sheet = preferredSheet(workbook, file.name)
        if (!sheet) throw new Error(`"${file.name}" has no worksheet with a header row and data.`)
        added.push({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, workbook, sheet })
      }
      const nextFiles = [...files.filter((file) => !added.some((item) => item.id === file.id)), ...added]

      // Switch marketplace automatically when the first recognised report says which one it is.
      let nextMarketplace = marketplace
      if (files.length === 0) {
        const first = added[0]
        const format = detectFormat(Object.keys(first.workbook[first.sheet][0]), first.name)
        if (format && FORMAT_MARKETPLACE[format] !== marketplace) {
          nextMarketplace = FORMAT_MARKETPLACE[format]
          setMarketplace(nextMarketplace)
          setEcommerceOperatorName(ECO_NAMES[nextMarketplace] ?? '')
        }
      }

      const processed = nextFiles.flatMap((file) => processMarketplaceRows(
        nextMarketplace,
        enrichRows(file.workbook[file.sheet], file.name).rows,
      ))
      if (processed.length === 0) throw new Error('No sales rows were found in the uploaded file(s).')
      setFiles(nextFiles)
      remap(nextFiles, nextMarketplace)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read this file.')
    } finally {
      setIsLoading(false)
    }
  }

  const removeFile = (fileId: string) => {
    const nextFiles = files.filter((file) => file.id !== fileId)
    setFiles(nextFiles)
    remap(nextFiles, marketplace)
    setHasGenerated(false)
  }

  const clearFile = () => {
    setFiles([])
    setColumnMapping(null)
    setError('')
    setHasGenerated(false)
  }

  const generateReport = () => {
    if (!rawRows.length) {
      setError('Upload a marketplace sales report before generating your GST report.')
      return
    }
    if (!isValidGstin(sellerGstin)) {
      setError('Enter a valid 15-character GSTIN to generate your report.')
      return
    }
    setError('')
    setHasGenerated(true)
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>GST file converter</strong></div>
          <div className="topbar-tag"><LockKeyhole size={14} /> Files stay on your device</div>
        </header>
        <main className="workspace">
          <section className="intro" id="home">
            <div className="eyebrow"><Sparkles size={14} /> GST REPORTING WORKSPACE</div>
            <h1>Convert Your E-commerce Sales Reports into GST-Ready Returns</h1>
            <p>Upload your Amazon, Flipkart or Meesho sales reports and get a GSTR-1 JSON you can upload on the GST portal (Prepare Offline), plus the same data in the official offline-tool Excel workbook.</p>
          </section>

          <section className="conversion-card" id="convert" aria-label="Generate GST report">
            <div className="conversion-heading">
              <div>
                <div className="step-label">01 <span>·</span> CREATE A REPORT</div>
                <h2>Start with your marketplace report</h2>
                <p>Choose a marketplace, add your filing details, and upload the sales file.</p>
              </div>
              <div className="supported-badge"><CheckCircle2 size={14} /> GSTR-1 JSON + Excel</div>
            </div>

            <div className="form-section" id="marketplaces">
              <div className="field-heading">
                <span className="field-number">1</span>
                <div><strong>Select your marketplace</strong><small>Choose the source of your sales report</small></div>
              </div>
              <MarketplaceSelector value={marketplace} onChange={handleMarketplaceChange} />
            </div>

            <div className="form-section">
              <div className="field-heading">
                <span className="field-number">2</span>
                <div><strong>Filing details</strong><small>Set the period and GSTIN for this return</small></div>
              </div>
              <div className="filing-grid">
                <label className="form-control">
                  <span>Financial period</span>
                  <select
                    className="market-select"
                    value={financialPeriod}
                    onChange={(event) => {
                      setFinancialPeriod(event.currentTarget.value)
                      setPortalTcsInput('')
                      setTable13Documents([])
                      setHasGenerated(false)
                    }}
                  >
                    {periods.map((period) => <option key={period} value={period}>FY {period}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span>Return month</span>
                  <select
                    className="market-select"
                    value={returnMonth}
                    onChange={(event) => {
                      setReturnMonth(event.currentTarget.value)
                      setPortalTcsInput('')
                      setTable13Documents([])
                      setHasGenerated(false)
                    }}
                  >
                    {months.map(([value, name]) => (
                      <option key={value} value={value}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span>GSTIN</span>
                  <input
                    autoCapitalize="characters"
                    className="market-select"
                    maxLength={15}
                    placeholder="Enter your 15-character GSTIN"
                    value={sellerGstin}
                    onChange={(event) => {
                      setSellerGstin(event.currentTarget.value.toUpperCase())
                      setPortalTcsInput('')
                      setHasGenerated(false)
                    }}
                  />
                </label>
                <label className="form-control">
                  <span>Annual aggregate turnover (previous FY)</span>
                  <select
                    className="market-select"
                    value={turnoverBand}
                    onChange={(event) => {
                      setTurnoverBand(event.currentTarget.value as '' | keyof typeof TURNOVER_BANDS)
                      setHasGenerated(false)
                    }}
                  >
                    <option value="">Select (decides 4- or 6-digit HSN)</option>
                    <option value="upto5">Up to ₹5 crore</option>
                    <option value="above5">Above ₹5 crore</option>
                  </select>
                </label>
                <label className="form-control">
                  <span>Unit (UQC) when the file has none</span>
                  <select
                    className="market-select"
                    value={defaultUqc}
                    onChange={(event) => setDefaultUqc(event.currentTarget.value)}
                  >
                    {OFFICIAL_UQC_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="field-heading">
                <span className="field-number">4</span>
                <div>
                  <strong>Marketplace return details</strong>
                  <small>Required for B2CS and e-commerce operator reporting in the GSTN workbook.</small>
                </div>
              </div>
              <div className="filing-grid">
                <label className="form-control">
                  <span>B2CS source type</span>
                  <select
                    className="market-select"
                    value={b2csSupplyType}
                    onChange={(event) => {
                      setB2csSupplyType(event.currentTarget.value as B2CSSupplyType)
                      setHasGenerated(false)
                    }}
                  >
                    <option value="E">Through e-commerce operator (E)</option>
                    <option value="OE">Other than e-commerce operator (OE)</option>
                  </select>
                </label>
                <label className="form-control">
                  <span>E-commerce operator GSTIN</span>
                  <input
                    autoCapitalize="characters"
                    className="market-select"
                    maxLength={15}
                    placeholder="Operator's GSTIN for your state (see TCS credit / GSTR-2B)"
                    value={ecommerceOperatorGstin}
                    onChange={(event) => {
                      setEcommerceOperatorGstin(event.currentTarget.value.toUpperCase())
                      setHasGenerated(false)
                    }}
                  />
                </label>
                <label className="form-control">
                  <span>E-commerce operator name</span>
                  <input
                    className="market-select"
                    placeholder="Name as registered with GST"
                    value={ecommerceOperatorName}
                    onChange={(event) => {
                      setEcommerceOperatorName(event.currentTarget.value)
                      setHasGenerated(false)
                    }}
                  />
                </label>
                <label className="form-control">
                  <span>Table 14 nature of supply</span>
                  <select
                    className="market-select"
                    value={ecommerceNatureOfSupply}
                    onChange={(event) => {
                      setEcommerceNatureOfSupply(event.currentTarget.value as EcommerceNatureOfSupply | '')
                      setHasGenerated(false)
                    }}
                  >
                    <option value="">Select the applicable GSTN option</option>
                    <option value="Liable to collect tax u/s 52(TCS)">Liable to collect tax u/s 52 (TCS)</option>
                    <option value="Liable to pay tax u/s 9(5)">Liable to pay tax u/s 9(5)</option>
                  </select>
                </label>
              </div>
              <p className="mapping-note">
                These details apply to this uploaded report. Confirm the operator GSTIN and supply treatment from your tax records.
              </p>
            </div>

            <div className="form-section upload-section">
              <div className="field-heading">
                <span className="field-number">3</span>
                <div><strong>Upload your file</strong><small>Excel or CSV · processed securely in your browser</small></div>
              </div>
              <FileUpload
                fileName={fileName}
                isLoading={isLoading}
                onFiles={handleFiles}
                onClear={clearFile}
              />
              {enrichedFiles.length > 0 && (
                <div className="file-list">
                  {enrichedFiles.map((file) => {
                    const sheets = Object.keys(file.workbook).filter((name) => file.workbook[name].length > 0)
                    return (
                      <div className="file-chip" key={file.id}>
                        <strong>{file.name}</strong>
                        <span className={`format-tag${file.format ? '' : ' unknown'}`}>
                          {file.format ? FORMAT_LABELS[file.format] : 'Unrecognised layout — check the column mapping'}
                        </span>
                        <span>{file.rows.length} rows</span>
                        {sheets.length > 1 && (
                          <select
                            aria-label={`Worksheet in ${file.name}`}
                            value={file.sheet}
                            onChange={(event) => handleSheetChange(file.id, event.currentTarget.value)}
                          >
                            {sheets.map((sheetName) => <option key={sheetName} value={sheetName}>{sheetName}</option>)}
                          </select>
                        )}
                        <button className="text-button" type="button" onClick={() => removeFile(file.id)}>Remove</button>
                      </div>
                    )
                  })}
                </div>
              )}
              {unexpectedFormats.length > 0 && (
                <div className="notice notice-error" role="alert">
                  <AlertCircle size={18} />
                  <span>
                    {unexpectedFormats.map((file) => file.name).join(', ')} look like a different marketplace's report.
                    One return can only use one marketplace here — check the marketplace selection.
                  </span>
                </div>
              )}
            </div>

            {fileName && rawRows.length > 0 && columnMapping && (
              <ColumnMapping
                headers={allHeaders}
                mapping={columnMapping}
                onChange={(nextMapping) => {
                  setColumnMapping(nextMapping)
                  setHasGenerated(false)
                  setError('')
                }}
              />
            )}

            {filingPeriod >= '2025-05' && (
              <Table13DocumentsForm
                documents={table13Documents}
                suggest={suggestTable13FromFile}
                onChange={(documents) => {
                  setTable13Documents(documents)
                  setHasGenerated(false)
                }}
              />
            )}

            {error && (
              <div className="notice notice-error" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="generate-row">
              <span><LockKeyhole size={14} /> Your files are never uploaded to a server</span>
              <button className="generate-button" disabled={isLoading} onClick={generateReport} type="button">
                Generate GST report <ArrowRight size={17} />
              </button>
            </div>
          </section>

          {hasGenerated && records.length > 0 ? (
            <section className="report-results" aria-live="polite">
              <div className="loaded-file">
                <CheckCircle2 size={17} />
                <span><strong>{fileName}</strong> · Return period {filingPeriod} · {report.records.length} rows included{report.excluded.length > 0 ? ` · ${report.excluded.length} left out` : ''}</span>
              </div>
              <Dashboard report={report} />
              <TcsReconciliationPanel
                report={report}
                portalTcsInput={portalTcsInput}
                onPortalTcsInputChange={setPortalTcsInput}
              />
              <ValidationPanel report={report} sellerGstin={sellerGstin} />
              <DownloadPanel report={report} gstr1={gstr1} sellerGstin={sellerGstin} />
              <section className="preview-card">
                <div className="section-heading">
                  <div>
                    <h2>Transaction preview</h2>
                    <p>Showing up to 8 rows from your processed file.</p>
                  </div>
                  <span className="row-count">{records.length} transactions</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Customer GSTIN</th>
                        <th>Place of supply</th>
                        <th>Taxable value</th>
                        <th>GST rate</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.records.slice(0, 8).map((record, index) => (
                        <tr key={`${record.invoiceNumber}-${index}`}>
                          <td>{record.invoiceNumber || '—'}</td>
                          <td>{record.invoiceDate || '—'}</td>
                          <td>{record.customerGstin || 'Unregistered'}</td>
                          <td>{record.placeOfSupply || '—'}</td>
                          <td>{record.taxableValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                          <td>{record.taxRate}%</td>
                          <td><span className="type-pill">{record.category}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          ) : (
            <section className="benefit-strip" id="how-it-works">
              <div className="benefit-icon"><FileCheck2 size={18} /></div>
              <div className="benefit-copy">
                <strong>From sales file to a structured return draft</strong>
                <span>We organize transactions into GSTR-1 sections, highlight missing filing data, and give you a review before export.</span>
              </div>
              <div className="benefit-steps"><span>Upload</span><i /> <span>Review</span><i /> <span>Export</span></div>
            </section>
          )}

          <footer className="app-footer" id="help">
            <span>Need help? Check your marketplace report headings and try again.</span>
            <span>GSTBridge · Review the return on the GST portal before filing · <a href="/policies.html">Terms, privacy &amp; refunds</a></span>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
