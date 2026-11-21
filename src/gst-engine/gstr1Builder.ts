/**
 * Builds one canonical GSTR-1 model from the classified report. Both the Excel
 * workbook and the GSTN JSON are written from this model, so the two downloads
 * always contain exactly the same invoices, values and taxes.
 *
 * Tax amounts are calculated from rate × taxable value (CGST = SGST = half),
 * the same way the GST offline tool calculates them when it imports the Excel
 * workbook. Marketplace-reported tax is used to check the data, not copied.
 */
import { TABLE13_DOCUMENT_NATURES } from './table13Generator'
import { isValidGstin, stateCodeFromPlace } from '../utils/gstinValidator'
import { DEFAULT_UQC_LABEL, isServiceCode, normalizeUqc } from '../utils/uqc'
import type { ClassifiedSalesRecord, GstReport } from '../types'

export const OFFICIAL_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40]
const TABLE_13_START = '2025-05'
const TABLE_14_START = '2024-01'
const HSN_PHASE_3_START = '2025-05'
const SIX_DIGIT_HSN_TURNOVER = 5_00_00_000
const B2CL_THRESHOLD_FROM_AUGUST_2024 = 100_000
const B2CL_THRESHOLD_BEFORE_AUGUST_2024 = 250_000
const DOCUMENT_NUMBER = /^[A-Za-z0-9/-]{1,16}$/

export interface Gstr1Item {
  rt: number
  txval: number
  iamt: number
  camt: number
  samt: number
  csamt: number
}

export interface Gstr1Invoice {
  ctin?: string
  receiverName?: string
  number: string
  date: string
  value: number
  pos: string
  reverseCharge: boolean
  ecoGstin?: string
  items: Gstr1Item[]
}

export interface Gstr1B2csRow extends Gstr1Item {
  type: 'OE' | 'E'
  pos: string
  supplyType: 'INTRA' | 'INTER'
  ecoGstin?: string
}

export interface Gstr1Note {
  ctin?: string
  receiverName?: string
  urType?: 'B2CL' | 'EXPWP' | 'EXPWOP'
  number: string
  date: string
  noteType: 'C' | 'D'
  pos: string
  reverseCharge: boolean
  value: number
  items: Gstr1Item[]
}

export interface Gstr1HsnRow extends Gstr1Item {
  hsn: string
  description: string
  uqc: string
  qty: number
  totalValue: number
}

export interface Gstr1DocRow {
  docNum: number
  nature: string
  from: string
  to: string
  total: number
  cancelled: number
  net: number
}

export interface Gstr1EcoRow {
  nature: string
  ecoGstin: string
  ecoName: string
  netValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

export interface Gstr1Return {
  gstin: string
  period: string
  fp: string
  b2b: Gstr1Invoice[]
  b2cl: Gstr1Invoice[]
  b2cs: Gstr1B2csRow[]
  cdnr: Gstr1Note[]
  cdnur: Gstr1Note[]
  hsnB2b: Gstr1HsnRow[]
  hsnB2c: Gstr1HsnRow[]
  docs: Gstr1DocRow[]
  eco: Gstr1EcoRow[]
  blockers: string[]
  warnings: string[]
  totals: {
    taxableValue: number
    igst: number
    cgst: number
    sgst: number
    cess: number
    invoices: number
    notes: number
  }
}

export interface Gstr1BuildOptions {
  /** Unit used for HSN rows whose source file has no UQC column. */
  defaultUqc?: string
}

// ---- money helpers: everything is summed in paise to avoid floating-point drift ----
const toPaise = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100)
const toRupees = (paise: number) => paise / 100

function taxFor(txvalPaise: number, rate: number, interstate: boolean) {
  if (interstate) {
    return { iamt: Math.round(txvalPaise * rate / 100), camt: 0, samt: 0 }
  }
  const half = Math.round(txvalPaise * rate / 200)
  return { iamt: 0, camt: half, samt: half }
}

interface ItemAccumulator {
  rt: number
  txval: number
  cess: number
}

function itemsFrom(accumulators: Map<number, ItemAccumulator>, interstate: boolean): Gstr1Item[] {
  return [...accumulators.values()]
    .sort((left, right) => left.rt - right.rt)
    .map((item) => {
      const tax = taxFor(item.txval, item.rt, interstate)
      return {
        rt: item.rt,
        txval: toRupees(item.txval),
        iamt: toRupees(tax.iamt),
        camt: toRupees(tax.camt),
        samt: toRupees(tax.samt),
        csamt: toRupees(item.cess),
      }
    })
}

function addItem(map: Map<number, ItemAccumulator>, rate: number, txvalPaise: number, cessPaise: number) {
  const current = map.get(rate) ?? { rt: rate, txval: 0, cess: 0 }
  current.txval += txvalPaise
  current.cess += cessPaise
  map.set(rate, current)
}

function itemTotal(items: Gstr1Item[]) {
  return toRupees(items.reduce((total, item) => total
    + toPaise(item.txval) + toPaise(item.iamt) + toPaise(item.camt) + toPaise(item.samt) + toPaise(item.csamt), 0))
}

function isCredit(record: ClassifiedSalesRecord) {
  return record.isCreditNote || record.documentType === 'credit_note'
}

function isNote(record: ClassifiedSalesRecord) {
  return isCredit(record) || record.isDebitNote || record.documentType === 'debit_note'
}

function label(record: ClassifiedSalesRecord) {
  const file = record.sourceFile ? `${record.sourceFile} ` : ''
  return `${file}row ${record.sourceRow}`
}

function periodEnd(period: string) {
  const [year, month] = period.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period}-${String(last).padStart(2, '0')}`
}

function b2clThreshold(date: string) {
  return date < '2024-08-01' ? B2CL_THRESHOLD_BEFORE_AUGUST_2024 : B2CL_THRESHOLD_FROM_AUGUST_2024
}

function unique(values: string[]) {
  return [...new Set(values)]
}

/** Limits a list of per-row problems so one bad column doesn't produce 5,000 messages. */
function collapse(messages: string[], limit = 8) {
  const grouped = new Map<string, string[]>()
  for (const message of messages) {
    const [key, where] = message.split('@@')
    grouped.set(key, [...(grouped.get(key) ?? []), ...(where ? [where] : [])])
  }
  return [...grouped.entries()].slice(0, 200).map(([key, places]) => {
    if (places.length === 0) return key
    const shown = places.slice(0, limit).join(', ')
    const more = places.length > limit ? ` and ${places.length - limit} more` : ''
    return `${key} (${shown}${more})`
  })
}

function unclassifiedReason(record: ClassifiedSalesRecord) {
  if (record.category !== 'REVIEW_REQUIRED') {
    return `${record.category.replace(/_/g, ' ').toLowerCase()} supplies are not supported yet; file them separately`
  }
  if (record.customerGstin && !isValidGstin(record.customerGstin)) {
    return `Customer GSTIN "${record.customerGstin}" is not a valid GSTIN`
  }
  if (!stateCodeFromPlace(record.placeOfSupply)) {
    return `Unknown place of supply "${record.placeOfSupply || 'blank'}" — use a state name or 2-digit state code`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.invoiceDate)) {
    return `Invoice date missing or unreadable ("${record.invoiceDate || 'blank'}")`
  }
  return 'Could not classify the row — check its place of supply, date and invoice value'
}

export function buildGstr1(
  report: GstReport,
  sellerGstinInput: string,
  options: Gstr1BuildOptions = {},
): Gstr1Return {
  const sellerGstin = sellerGstinInput.trim().toUpperCase()
  const sellerState = isValidGstin(sellerGstin) ? sellerGstin.slice(0, 2) : ''
  const period = report.filingPeriod
  const lastDay = /^\d{4}-\d{2}$/.test(period) ? periodEnd(period) : ''
  const defaultUqc = normalizeUqc(options.defaultUqc ?? '') || DEFAULT_UQC_LABEL
  const ecoGstin = report.ecommerceOperator?.gstin?.trim().toUpperCase() ?? ''
  const b2csType = report.b2csSupplyType ?? 'E'

  const rowProblems: string[] = []
  const blockers: string[] = []
  const warnings: string[] = []

  // ---------------- report-level checks ----------------
  if (!sellerState) blockers.push('Enter a valid seller GSTIN.')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) blockers.push('Select a valid return month.')
  if (report.records.length === 0) blockers.push('There are no sales rows to export.')
  for (const issue of report.issues) {
    if (issue.severity === 'error') {
      rowProblems.push(issue.row ? `${issue.message}@@row ${issue.row}` : issue.message)
    }
    if (/possible duplicate invoice line/i.test(issue.message)) {
      rowProblems.push(`Possible duplicate line — check you did not upload the same file twice@@row ${issue.row}`)
    }
  }

  const unsupported = report.records.filter((record) => ![
    'B2B', 'B2B_REVERSE_CHARGE', 'B2CL', 'B2CS', 'CDN',
  ].includes(record.category))
  for (const record of unsupported) {
    rowProblems.push(`${unclassifiedReason(record)}@@${label(record)}`)
  }
  if (report.records.length > 0 && report.records.every((record) => !record.taxableValue)) {
    blockers.push('No taxable values were read from your file. Check that "Taxable value" is mapped to the right column in "Review column mapping".')
  }

  // Table 14 applies only to sales made through an e-commerce operator.
  const usesEco = report.records.length > 0
    && (Boolean(ecoGstin) || Boolean(report.ecommerceNatureOfSupply) || b2csType === 'E')
  if (usesEco && period >= TABLE_14_START) {
    if (!isValidGstin(ecoGstin)) blockers.push('Enter the e-commerce operator GSTIN (needed for Table 14 and B2CS type E).')
    if (!report.ecommerceOperator?.name?.trim()) blockers.push('Enter the e-commerce operator name (Table 14).')
    if (!report.ecommerceNatureOfSupply) blockers.push('Select the Table 14 nature of supply.')
  }
  if (b2csType === 'E' && !isValidGstin(ecoGstin)) {
    blockers.push('B2CS type E needs a valid e-commerce operator GSTIN.')
  }

  const turnover = report.annualAggregateTurnover
  if (period >= HSN_PHASE_3_START && (turnover === undefined || !Number.isFinite(turnover))) {
    blockers.push('Select your annual aggregate turnover band (decides 4- or 6-digit HSN).')
  }
  if (period >= TABLE_13_START && report.table13.length === 0) {
    blockers.push('Table 13 (documents issued) is mandatory from May 2025 — fill it or use "Auto-fill from file".')
  }

  // ---------------- per-row checks ----------------
  const records = report.records.filter((record) => ['B2B', 'B2B_REVERSE_CHARGE', 'B2CL', 'B2CS', 'CDN'].includes(record.category))
  for (const record of records) {
    const where = label(record)
    if (!OFFICIAL_RATES.includes(record.taxRate)) {
      rowProblems.push(`GST rate ${record.taxRate}% is not a GSTN rate — check the rate column mapping@@${where}`)
    }
    if (!stateCodeFromPlace(record.placeOfSupply)) {
      rowProblems.push(`Unknown place of supply "${record.placeOfSupply || 'blank'}"@@${where}`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.invoiceDate)) {
      rowProblems.push(`Invoice/note date missing or unreadable ("${record.invoiceDate || 'blank'}")@@${where}`)
    } else if (lastDay && record.invoiceDate > lastDay) {
      rowProblems.push(`Date ${record.invoiceDate} is after the selected return month — wrong month selected?@@${where}`)
    }
    if (record.interstate === null) {
      rowProblems.push(`Cannot tell intra-state from inter-state (needs seller GSTIN and place of supply)@@${where}`)
    }

    // Reported tax is a data check: a big mismatch means the wrong rate or tax column was mapped.
    const reported = [record.reportedIgst, record.reportedCgst, record.reportedSgst]
      .some((value) => value !== undefined)
      ? Math.abs(record.reportedIgst ?? 0) + Math.abs(record.reportedCgst ?? 0) + Math.abs(record.reportedSgst ?? 0)
      : record.reportedTaxAmount !== undefined ? Math.abs(record.reportedTaxAmount) : undefined
    if (reported !== undefined) {
      const expected = Math.abs(record.taxableValue) * record.taxRate / 100
      if (Math.abs(reported - expected) > Math.max(1, expected * 0.02)) {
        rowProblems.push(`Reported tax ₹${reported.toFixed(2)} does not match ${record.taxRate}% of taxable value ₹${Math.abs(record.taxableValue).toFixed(2)}@@${where}`)
      }
    }
    if (record.interstate !== null && record.reportedIgst !== undefined
      && record.reportedCgst !== undefined) {
      const chargedIgst = Math.abs(record.reportedIgst) > 0.01
      const chargedCgst = Math.abs(record.reportedCgst) > 0.01
      if ((record.interstate && chargedCgst && !chargedIgst) || (!record.interstate && chargedIgst && !chargedCgst)) {
        rowProblems.push(`Tax type on the row (${chargedIgst ? 'IGST' : 'CGST/SGST'}) contradicts seller GSTIN vs place of supply@@${where}`)
      }
    }
    if (record.customerGstin && record.customerGstin.toUpperCase() === sellerGstin) {
      rowProblems.push(`Buyer GSTIN is your own GSTIN — the customer GSTIN column is probably mapped to the seller GSTIN@@${where}`)
    }
    if (record.taxableValue === 0) {
      warnings.push(`Zero taxable value at ${where}; included with value 0.`)
    }
  }

  // ---------------- B2B (Table 4) ----------------
  const b2bMap = new Map<string, {
    invoice: Omit<Gstr1Invoice, 'items' | 'value'>
    items: Map<number, ItemAccumulator>
    value: number
    valueKnown: boolean
    interstate: boolean
  }>()
  for (const record of records.filter((item) => item.category === 'B2B' || item.category === 'B2B_REVERSE_CHARGE')) {
    const where = label(record)
    if (!DOCUMENT_NUMBER.test(record.invoiceNumber)) {
      rowProblems.push(`Invoice number "${record.invoiceNumber}" must be 1–16 characters of letters, digits, "/" or "-"@@${where}`)
    }
    const ctin = (record.customerGstin ?? '').toUpperCase()
    const key = `${ctin}|${record.invoiceNumber.toUpperCase()}`
    const pos = stateCodeFromPlace(record.placeOfSupply)
    const existing = b2bMap.get(key)
    if (existing && existing.invoice.date !== record.invoiceDate) {
      rowProblems.push(`Invoice ${record.invoiceNumber} appears with two different dates@@${where}`)
    }
    if (existing && existing.invoice.pos !== pos) {
      rowProblems.push(`Invoice ${record.invoiceNumber} has two different places of supply@@${where}`)
    }
    const entry = existing ?? {
      invoice: {
        ctin,
        receiverName: record.customerName || undefined,
        number: record.invoiceNumber,
        date: record.invoiceDate,
        pos,
        reverseCharge: record.reverseCharge,
        ecoGstin: ecoGstin || undefined,
      },
      items: new Map<number, ItemAccumulator>(),
      value: 0,
      valueKnown: true,
      interstate: record.interstate === true,
    }
    entry.invoice.reverseCharge ||= record.reverseCharge
    addItem(entry.items, record.taxRate, toPaise(record.taxableValue), toPaise(record.cess ?? 0))
    if (record.invoiceValue === undefined) entry.valueKnown = false
    else entry.value += toPaise(record.invoiceValue)
    b2bMap.set(key, entry)
  }
  const b2b = [...b2bMap.values()].map((entry) => {
    const items = itemsFrom(entry.items, entry.interstate)
    return { ...entry.invoice, items, value: entry.valueKnown ? toRupees(entry.value) : itemTotal(items) }
  })

  // ---------------- B2CL (Table 5) ----------------
  const b2clMap = new Map<string, { invoice: Omit<Gstr1Invoice, 'items' | 'value'>; items: Map<number, ItemAccumulator>; value: number; valueKnown: boolean }>()
  for (const record of records.filter((item) => item.category === 'B2CL')) {
    if (!DOCUMENT_NUMBER.test(record.invoiceNumber)) {
      rowProblems.push(`B2CL invoice number "${record.invoiceNumber}" must be 1–16 characters of letters, digits, "/" or "-"@@${label(record)}`)
    }
    const key = record.invoiceNumber.toUpperCase()
    const entry = b2clMap.get(key) ?? {
      invoice: {
        number: record.invoiceNumber,
        date: record.invoiceDate,
        pos: stateCodeFromPlace(record.placeOfSupply),
        reverseCharge: false,
        ecoGstin: b2csType === 'E' && ecoGstin ? ecoGstin : undefined,
      },
      items: new Map<number, ItemAccumulator>(),
      value: 0,
      valueKnown: true,
    }
    addItem(entry.items, record.taxRate, toPaise(record.taxableValue), toPaise(record.cess ?? 0))
    if (record.invoiceValue === undefined) entry.valueKnown = false
    else entry.value += toPaise(record.invoiceValue)
    b2clMap.set(key, entry)
  }
  const b2cl = [...b2clMap.values()].map((entry) => {
    const items = itemsFrom(entry.items, true)
    return { ...entry.invoice, items, value: entry.valueKnown ? toRupees(entry.value) : itemTotal(items) }
  })

  // ---------------- Credit / debit notes (Table 9B) ----------------
  // Registered buyer → CDNR. Unregistered buyer → CDNUR only when the original was B2CL
  // (or an export); otherwise B2C notes are netted into B2CS, as GSTN instructs.
  const cdnrMap = new Map<string, { note: Omit<Gstr1Note, 'items' | 'value'>; items: Map<number, ItemAccumulator>; value: number; valueKnown: boolean; interstate: boolean }>()
  const cdnurMap = new Map<string, { note: Omit<Gstr1Note, 'items' | 'value'>; items: Map<number, ItemAccumulator>; value: number; valueKnown: boolean }>()
  const b2csNetted: ClassifiedSalesRecord[] = []
  const unregisteredNoteTotals = new Map<string, number>()
  for (const record of records.filter((item) => item.category === 'CDN' && !item.customerGstin)) {
    const key = record.invoiceNumber.toUpperCase()
    const value = Math.abs(record.invoiceValue ?? record.taxableValue * (1 + record.taxRate / 100))
    unregisteredNoteTotals.set(key, (unregisteredNoteTotals.get(key) ?? 0) + value)
  }

  for (const record of records.filter((item) => item.category === 'CDN')) {
    const where = label(record)
    const noteType: 'C' | 'D' = isCredit(record) ? 'C' : 'D'
    const pos = stateCodeFromPlace(record.placeOfSupply)
    if (record.customerGstin) {
      if (!DOCUMENT_NUMBER.test(record.invoiceNumber)) {
        rowProblems.push(`Note number "${record.invoiceNumber}" must be 1–16 characters of letters, digits, "/" or "-"@@${where}`)
      }
      const key = `${record.customerGstin}|${record.invoiceNumber.toUpperCase()}`
      const entry = cdnrMap.get(key) ?? {
        note: {
          ctin: record.customerGstin,
          receiverName: record.customerName || undefined,
          number: record.invoiceNumber,
          date: record.invoiceDate,
          noteType,
          pos,
          reverseCharge: record.reverseCharge,
        },
        items: new Map<number, ItemAccumulator>(),
        value: 0,
        valueKnown: true,
        interstate: record.interstate === true,
      }
      addItem(entry.items, record.taxRate, Math.abs(toPaise(record.taxableValue)), Math.abs(toPaise(record.cess ?? 0)))
      if (record.invoiceValue === undefined) entry.valueKnown = false
      else entry.value += Math.abs(toPaise(record.invoiceValue))
      cdnrMap.set(key, entry)
      continue
    }

    const noteTotal = unregisteredNoteTotals.get(record.invoiceNumber.toUpperCase()) ?? 0
    const urType = record.urType
      ?? (record.interstate && record.invoiceNumber && noteTotal > b2clThreshold(record.invoiceDate) ? 'B2CL' : undefined)
    if (!urType) {
      b2csNetted.push(record)
      continue
    }
    if (urType !== 'B2CL') {
      rowProblems.push(`Export credit/debit notes (${urType}) are not supported yet@@${where}`)
      continue
    }
    if (!record.urType) {
      warnings.push(`Credit note ${record.invoiceNumber} is over the B2CL limit, so it is reported in CDNUR as B2CL — confirm the original invoice was B2CL.`)
    }
    if (!DOCUMENT_NUMBER.test(record.invoiceNumber)) {
      rowProblems.push(`Note number "${record.invoiceNumber}" must be 1–16 characters of letters, digits, "/" or "-"@@${where}`)
    }
    const key = record.invoiceNumber.toUpperCase()
    const entry = cdnurMap.get(key) ?? {
      note: { urType, number: record.invoiceNumber, date: record.invoiceDate, noteType, pos, reverseCharge: false },
      items: new Map<number, ItemAccumulator>(),
      value: 0,
      valueKnown: true,
    }
    addItem(entry.items, record.taxRate, Math.abs(toPaise(record.taxableValue)), Math.abs(toPaise(record.cess ?? 0)))
    if (record.invoiceValue === undefined) entry.valueKnown = false
    else entry.value += Math.abs(toPaise(record.invoiceValue))
    cdnurMap.set(key, entry)
  }
  const cdnr = [...cdnrMap.values()].map((entry) => {
    const items = itemsFrom(entry.items, entry.interstate)
    return { ...entry.note, items, value: entry.valueKnown ? toRupees(entry.value) : itemTotal(items) }
  })
  const cdnur = [...cdnurMap.values()].map((entry) => {
    const items = itemsFrom(entry.items, true)
    return { ...entry.note, items, value: entry.valueKnown ? toRupees(entry.value) : itemTotal(items) }
  })

  // ---------------- B2CS (Table 7), net of B2C notes ----------------
  const b2csMap = new Map<string, { pos: string; rt: number; txval: number; cess: number }>()
  const b2csRecords = [...records.filter((item) => item.category === 'B2CS'), ...b2csNetted]
  for (const record of b2csRecords) {
    const pos = stateCodeFromPlace(record.placeOfSupply)
    const sign = isNote(record) ? (isCredit(record) ? -1 : 1) : 1
    const txval = sign === 1 && !isNote(record) ? toPaise(record.taxableValue) : sign * Math.abs(toPaise(record.taxableValue))
    const cess = sign === 1 && !isNote(record) ? toPaise(record.cess ?? 0) : sign * Math.abs(toPaise(record.cess ?? 0))
    const key = `${pos}|${record.taxRate}`
    const entry = b2csMap.get(key) ?? { pos, rt: record.taxRate, txval: 0, cess: 0 }
    entry.txval += txval
    entry.cess += cess
    b2csMap.set(key, entry)
  }
  const b2cs: Gstr1B2csRow[] = [...b2csMap.values()]
    .filter((entry) => entry.txval !== 0 || entry.cess !== 0)
    .sort((left, right) => left.pos.localeCompare(right.pos) || left.rt - right.rt)
    .map((entry) => {
      const interstate = entry.pos !== sellerState
      const tax = taxFor(entry.txval, entry.rt, interstate)
      return {
        type: b2csType,
        pos: entry.pos,
        supplyType: interstate ? 'INTER' : 'INTRA',
        ecoGstin: b2csType === 'E' && ecoGstin ? ecoGstin : undefined,
        rt: entry.rt,
        txval: toRupees(entry.txval),
        iamt: toRupees(tax.iamt),
        camt: toRupees(tax.camt),
        samt: toRupees(tax.samt),
        csamt: toRupees(entry.cess),
      }
    })
  const negativeB2cs = b2cs.filter((row) => row.txval < 0)
  if (negativeB2cs.length > 0) {
    warnings.push(`Returns exceed sales for ${negativeB2cs.length} B2CS state/rate combination(s) (${negativeB2cs.map((row) => `${row.pos} @ ${row.rt}%`).slice(0, 5).join(', ')}). They are exported as negative Table 7 values; if the portal rejects them, adjust against the original month's B2CS (B2CSA).`)
  }

  // ---------------- HSN summary (Table 12), split B2B / B2C ----------------
  const hsnDigitsRequired = turnover !== undefined && turnover > SIX_DIGIT_HSN_TURNOVER ? 6 : 4
  const buildHsn = (source: ClassifiedSalesRecord[], bucket: 'B2B' | 'B2C') => {
    const map = new Map<string, { hsn: string; description: string; uqc: string; rt: number; qty: number; txval: number; cess: number; interstateTx: number; intraTx: number }>()
    for (const record of source) {
      const hsn = record.hsn.replace(/\s/g, '')
      const where = label(record)
      if (!/^\d{4,8}$/.test(hsn)) {
        rowProblems.push(`HSN/SAC "${record.hsn || 'blank'}" must be 4–8 digits@@${where}`)
        continue
      }
      if (period >= HSN_PHASE_3_START && turnover !== undefined && hsn.length < hsnDigitsRequired
        && (bucket === 'B2B' || hsnDigitsRequired === 4)) {
        rowProblems.push(`HSN ${hsn} needs at least ${hsnDigitsRequired} digits for your turnover@@${where}`)
      }
      const service = isServiceCode(hsn)
      const uqc = service ? 'NA' : (normalizeUqc(record.uqc) || defaultUqc)
      if (!service && record.uqc && !normalizeUqc(record.uqc)) {
        rowProblems.push(`Unit "${record.uqc}" is not a GSTN UQC@@${where}`)
      }
      const sign = isNote(record) ? (isCredit(record) ? -1 : 1) : 1
      const key = `${hsn}|${record.taxRate}|${uqc}`
      const entry = map.get(key) ?? { hsn, description: '', uqc, rt: record.taxRate, qty: 0, txval: 0, cess: 0, interstateTx: 0, intraTx: 0 }
      if (!entry.description && record.description) entry.description = record.description.slice(0, 30)
      const txval = isNote(record) ? sign * Math.abs(toPaise(record.taxableValue)) : toPaise(record.taxableValue)
      entry.qty += service ? 0 : sign * Math.abs(record.quantity || 0)
      entry.txval += txval
      entry.cess += isNote(record) ? sign * Math.abs(toPaise(record.cess ?? 0)) : toPaise(record.cess ?? 0)
      if (record.interstate) entry.interstateTx += txval
      else entry.intraTx += txval
      map.set(key, entry)
    }
    return [...map.values()]
      .filter((entry) => entry.txval !== 0 || entry.qty !== 0)
      .sort((left, right) => left.hsn.localeCompare(right.hsn) || left.rt - right.rt)
      .map((entry): Gstr1HsnRow => {
        const inter = taxFor(entry.interstateTx, entry.rt, true)
        const intra = taxFor(entry.intraTx, entry.rt, false)
        let qty = Math.round(entry.qty * 1000) / 1000
        if (qty < 0) {
          warnings.push(`HSN ${entry.hsn} @ ${entry.rt}% (${bucket}) has more units returned than sold; quantity reported as 0.`)
          qty = 0
        }
        const row = {
          hsn: entry.hsn,
          description: entry.description,
          uqc: entry.uqc,
          qty,
          rt: entry.rt,
          txval: toRupees(entry.txval),
          iamt: toRupees(inter.iamt),
          camt: toRupees(intra.camt),
          samt: toRupees(intra.samt),
          csamt: toRupees(entry.cess),
        }
        return { ...row, totalValue: itemTotal([row]) }
      })
  }
  const registered = (record: ClassifiedSalesRecord) => Boolean(record.customerGstin)
  const hsnB2b = buildHsn(records.filter(registered), 'B2B')
  const hsnB2c = buildHsn(records.filter((record) => !registered(record)), 'B2C')
  if ([...hsnB2b, ...hsnB2c].some((row) => row.uqc === 'NA')) {
    warnings.push('Service (SAC 99…) rows are reported with UQC "NA" and quantity 0.')
  }
  if (records.some((record) => !record.uqc && !isServiceCode(record.hsn))) {
    warnings.push(`Your file has no unit column, so HSN quantities use "${defaultUqc}". Change the default unit if that is wrong.`)
  }

  // ---------------- Table 13 documents ----------------
  const docs: Gstr1DocRow[] = report.table13.map((document) => {
    const docNum = TABLE13_DOCUMENT_NATURES.indexOf(document.natureOfDocument) + 1
    if (!document.fromNumber || !document.toNumber || document.totalIssued < 0
      || document.totalCancelled < 0 || document.totalCancelled > document.totalIssued || docNum === 0) {
      blockers.push(`Table 13 row "${document.natureOfDocument}" has an invalid range or counts.`)
    }
    if (document.fromNumber.length > 16 || document.toNumber.length > 16) {
      blockers.push(`Table 13 serial numbers must be at most 16 characters (${document.fromNumber} – ${document.toNumber}).`)
    }
    return {
      docNum,
      nature: document.natureOfDocument,
      from: document.fromNumber,
      to: document.toNumber,
      total: document.totalIssued,
      cancelled: document.totalCancelled,
      net: document.totalIssued - document.totalCancelled,
    }
  })

  // ---------------- Totals and Table 14 (ECO) ----------------
  const sumItems = (items: Gstr1Item[], sign = 1) => items.reduce((total, item) => ({
    txval: total.txval + sign * toPaise(item.txval),
    iamt: total.iamt + sign * toPaise(item.iamt),
    camt: total.camt + sign * toPaise(item.camt),
    samt: total.samt + sign * toPaise(item.samt),
    csamt: total.csamt + sign * toPaise(item.csamt),
  }), { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 })
  const add = (left: ReturnType<typeof sumItems>, right: ReturnType<typeof sumItems>) => ({
    txval: left.txval + right.txval,
    iamt: left.iamt + right.iamt,
    camt: left.camt + right.camt,
    samt: left.samt + right.samt,
    csamt: left.csamt + right.csamt,
  })
  let net = sumItems([])
  for (const invoice of [...b2b, ...b2cl]) net = add(net, sumItems(invoice.items))
  net = add(net, sumItems(b2cs))
  for (const note of [...cdnr, ...cdnur]) net = add(net, sumItems(note.items, note.noteType === 'C' ? -1 : 1))

  const eco: Gstr1EcoRow[] = usesEco && isValidGstin(ecoGstin) && report.ecommerceNatureOfSupply
    ? [{
      nature: report.ecommerceNatureOfSupply,
      ecoGstin,
      ecoName: report.ecommerceOperator?.name?.trim() ?? '',
      netValue: toRupees(net.txval),
      igst: toRupees(net.iamt),
      cgst: toRupees(net.camt),
      sgst: toRupees(net.samt),
      cess: toRupees(net.csamt),
    }]
    : []

  if (report.excluded.length > 0) {
    const reasons = new Map<string, number>()
    for (const record of report.excluded) {
      const reason = record.excludeReason ?? 'Excluded'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    warnings.push(`Left out ${report.excluded.length} row(s): ${[...reasons.entries()].map(([reason, count]) => `${reason} × ${count}`).join('; ')}.`)
  }
  const earlier = records.filter((record) => period && record.invoiceDate && record.invoiceDate < `${period}-01`)
  if (earlier.length > 0) {
    warnings.push(`${earlier.length} row(s) are dated before the selected month. They will be reported in this return — check that is intended.`)
  }

  return {
    gstin: sellerGstin,
    period,
    fp: /^\d{4}-\d{2}$/.test(period) ? `${period.slice(5, 7)}${period.slice(0, 4)}` : '',
    b2b,
    b2cl,
    b2cs,
    cdnr,
    cdnur,
    hsnB2b,
    hsnB2c,
    docs,
    eco,
    blockers: unique([...blockers, ...collapse(rowProblems)]),
    warnings: unique(warnings),
    totals: {
      taxableValue: toRupees(net.txval),
      igst: toRupees(net.iamt),
      cgst: toRupees(net.camt),
      sgst: toRupees(net.samt),
      cess: toRupees(net.csamt),
      invoices: b2b.length + b2cl.length,
      notes: cdnr.length + cdnur.length,
    },
  }
}
