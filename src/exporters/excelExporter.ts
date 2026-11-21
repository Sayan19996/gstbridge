import * as XLSX from 'xlsx'
import { OFFICIAL_RATES } from '../gst-engine/gstr1Builder'
import type { Gstr1Return } from '../gst-engine/gstr1Builder'
import { OFFICIAL_UQC_LABELS } from '../utils/uqc'
import { downloadBlob } from './download'

const TEMPLATE_PATH = `${import.meta.env.BASE_URL}templates/GSTR1_Excel_Workbook_Template_V2.2.xlsx`

const OFFICIAL_SHEET_NAMES = [
  'Help Instruction', 'b2b,sez,de', 'b2ba', 'b2cl', 'b2cla', 'b2cs', 'b2csa',
  'cdnr', 'cdnra', 'cdnur', 'cdnura', 'exp', 'expa', 'at', 'ata', 'atadj',
  'atadja', 'exemp', 'hsn(b2b)', 'hsn(b2c)', 'docs', 'eco', 'ecoa', 'ecob2b',
  'ecourp2b', 'ecob2c', 'ecourp2c', 'ecoab2b', 'ecoab2c', 'ecoaurp2b',
  'ecoaurp2c', 'master',
]

const OFFICIAL_HEADERS: Record<string, Array<string | null>> = {
  'b2b,sez,de': [
    'GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date',
    'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate',
    'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount',
    null,
  ],
  b2cl: [
    'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply',
    'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount',
    'E-Commerce GSTIN',
  ],
  b2cs: [
    'Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate',
    'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN', null,
  ],
  cdnr: [
    'GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date',
    'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type',
    'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount',
  ],
  cdnur: [
    'UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply',
    'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount',
  ],
  'hsn(b2b)': [
    'HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate',
    'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount',
    'State/UT Tax Amount', 'Cess Amount',
  ],
  'hsn(b2c)': [
    'HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate',
    'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount',
    'State/UT Tax Amount', 'Cess Amount',
  ],
  docs: [
    'Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled',
  ],
  eco: [
    'Nature of Supply', 'GSTIN of E-Commerce Operator', 'E-Commerce Operator Name',
    'Net value of supplies', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess',
  ],
}

async function loadOfficialTemplate() {
  const response = await fetch(TEMPLATE_PATH)
  if (!response.ok) {
    throw new Error(`Unable to load the official GSTR-1 workbook template (${response.status}).`)
  }

  const workbook = XLSX.read(await response.arrayBuffer(), {
    type: 'array',
    cellDates: true,
    cellNF: true,
  })

  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(OFFICIAL_SHEET_NAMES)) {
    throw new Error('The bundled GSTN workbook template does not match the verified v3.2.4 sheet list.')
  }

  for (const [sheetName, expected] of Object.entries(OFFICIAL_HEADERS)) {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) throw new Error(`The official workbook is missing the "${sheetName}" worksheet.`)

    const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1')
    const actual = Array.from({ length: range.e.c + 1 }, (_, column) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: 3, c: column })]
      return typeof cell?.v === 'string' ? cell.v : null
    })
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`The "${sheetName}" headers do not match the verified GSTN workbook template.`)
    }
  }

  return workbook
}

function copyTemplateSheet(source: XLSX.WorkSheet, name: string) {
  const sourceRange = XLSX.utils.decode_range(source['!ref'] ?? 'A1')
  const keepAllRows = name === 'Help Instruction' || name === 'master'
  const lastRow = keepAllRows ? sourceRange.e.r : 3
  const worksheet: XLSX.WorkSheet = {}

  for (let row = 0; row <= lastRow; row += 1) {
    for (let column = 0; column <= sourceRange.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const sourceCell = source[address]
      if (!sourceCell) continue

      const copiedCell = { ...sourceCell }
      delete copiedCell.s
      worksheet[address] = copiedCell
    }
  }

  if (source['!merges']) worksheet['!merges'] = [...source['!merges']]
  if (source['!cols']) worksheet['!cols'] = [...source['!cols']]
  if (source['!margins']) worksheet['!margins'] = { ...source['!margins'] }

  const lastColumn = sourceRange.e.c
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastColumn },
  })
  return worksheet
}

type ExportCell = string | number | null
const DATE_FORMAT = 'dd-mmm-yyyy'
const DATE_COLUMNS: Record<string, number[]> = {
  'b2b,sez,de': [3],
  b2cl: [1],
  cdnr: [3],
  cdnur: [2],
}

function toExcelDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25_569
}

function appendRows(output: XLSX.WorkSheet, sheetName: string, rows: ExportCell[][]) {
  const firstDataRow = 4
  const range = XLSX.utils.decode_range(output['!ref'] ?? 'A1')
  const dateColumns = new Set(DATE_COLUMNS[sheetName] ?? [])

  rows.forEach((row, rowOffset) => {
    row.forEach((value, column) => {
      if (value === null || value === '') return
      const address = XLSX.utils.encode_cell({ r: firstDataRow + rowOffset, c: column })
      const cell: XLSX.CellObject = { t: typeof value === 'number' ? 'n' : 's', v: value }
      if (dateColumns.has(column)) cell.z = DATE_FORMAT
      output[address] = cell
    })
  })

  if (rows.length > 0) {
    output['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: firstDataRow + rows.length - 1, c: range.e.c },
    })
  }
}

function masterColumn(workbook: XLSX.WorkBook, column: number) {
  const master = workbook.Sheets.master
  const range = XLSX.utils.decode_range(master['!ref'] ?? 'A1')
  const values: Array<string | number> = []
  for (let row = 1; row <= range.e.r; row += 1) {
    const cell = master[XLSX.utils.encode_cell({ r: row, c: column })]
    if (typeof cell?.v === 'string' || typeof cell?.v === 'number') values.push(cell.v)
  }
  return values
}

/** Makes sure the bundled template still has the lists our mapper relies on. */
function checkTemplateLists(workbook: XLSX.WorkBook) {
  const units = masterColumn(workbook, 0)
  if (OFFICIAL_UQC_LABELS.some((label) => !units.includes(label))) {
    throw new Error('The bundled GSTN template UQC list differs from the one GSTBridge was built for.')
  }
  const rates = masterColumn(workbook, 5)
  if (OFFICIAL_RATES.some((rate) => !rates.includes(rate))) {
    throw new Error('The bundled GSTN template rate list differs from the one GSTBridge was built for.')
  }
}

function posLabels(workbook: XLSX.WorkBook) {
  // Column 6 = domestic POS list, column 14 = list including 96-Foreign Country.
  const labels = [...masterColumn(workbook, 6), ...masterColumn(workbook, 14)].map((value) => String(value).trim())
  return (code: string) => {
    const label = labels.find((value) => value.startsWith(`${code}-`))
    if (!label) throw new Error(`Place of supply code ${code} is not in the official template list.`)
    return label.trim()
  }
}

function buildRows(workbook: XLSX.WorkBook, data: Gstr1Return): Record<string, ExportCell[][]> {
  const pos = posLabels(workbook)
  const hsnRow = (row: Gstr1Return['hsnB2b'][number]): ExportCell[] => [
    row.hsn, row.description || null, row.uqc, row.qty, row.totalValue, row.rt,
    row.txval, row.iamt, row.camt, row.samt, row.csamt,
  ]

  return {
    'b2b,sez,de': data.b2b.flatMap((invoice) => invoice.items.map((item) => [
      invoice.ctin ?? null,
      invoice.receiverName ?? null,
      invoice.number,
      toExcelDate(invoice.date),
      invoice.value,
      pos(invoice.pos),
      invoice.reverseCharge ? 'Y' : 'N',
      null,
      'Regular B2B',
      invoice.ecoGstin ?? null,
      item.rt,
      item.txval,
      item.csamt,
    ])),
    b2cl: data.b2cl.flatMap((invoice) => invoice.items.map((item) => [
      invoice.number,
      toExcelDate(invoice.date),
      invoice.value,
      pos(invoice.pos),
      null,
      item.rt,
      item.txval,
      item.csamt,
      invoice.ecoGstin ?? null,
    ])),
    b2cs: data.b2cs.map((row) => [
      row.type, pos(row.pos), null, row.rt, row.txval, row.csamt, row.ecoGstin ?? null,
    ]),
    cdnr: data.cdnr.flatMap((note) => note.items.map((item) => [
      note.ctin ?? null,
      note.receiverName ?? null,
      note.number,
      toExcelDate(note.date),
      note.noteType,
      pos(note.pos),
      note.reverseCharge ? 'Y' : 'N',
      'Regular',
      note.value,
      null,
      item.rt,
      item.txval,
      item.csamt,
    ])),
    cdnur: data.cdnur.flatMap((note) => note.items.map((item) => [
      note.urType ?? null,
      note.number,
      toExcelDate(note.date),
      note.noteType,
      note.urType === 'B2CL' ? pos(note.pos) : null,
      note.value,
      null,
      item.rt,
      item.txval,
      item.csamt,
    ])),
    'hsn(b2b)': data.hsnB2b.map(hsnRow),
    'hsn(b2c)': data.hsnB2c.map(hsnRow),
    docs: data.docs.map((doc) => [doc.nature, doc.from, doc.to, doc.total, doc.cancelled]),
    eco: data.eco.map((row) => [
      row.nature, row.ecoGstin, row.ecoName, row.netValue, row.igst, row.cgst, row.sgst, row.cess,
    ]),
  }
}

export async function buildGstnWorkbookFile(data: Gstr1Return) {
  if (data.blockers.length > 0) {
    throw new Error(`Fix these before exporting:\n• ${data.blockers.join('\n• ')}`)
  }
  const template = await loadOfficialTemplate()
  checkTemplateLists(template)
  const rows = buildRows(template, data)
  const output = XLSX.utils.book_new()
  for (const name of OFFICIAL_SHEET_NAMES) {
    const worksheet = copyTemplateSheet(template.Sheets[name], name)
    if (rows[name]) appendRows(worksheet, name, rows[name])
    XLSX.utils.book_append_sheet(output, worksheet, name)
  }
  return XLSX.write(output, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function gstr1ExcelFileName(data: Gstr1Return) {
  return `GSTR1_${data.gstin}_${data.fp}.xlsx`
}

export async function downloadExcel(data: Gstr1Return) {
  downloadBlob(await buildGstnWorkbookFile(data), gstr1ExcelFileName(data), XLSX_TYPE)
}

export async function downloadOfficialGstnTemplate() {
  const response = await fetch(TEMPLATE_PATH)
  if (!response.ok) {
    throw new Error(`Unable to download the official GSTR-1 workbook template (${response.status}).`)
  }
  downloadBlob(await response.arrayBuffer(), 'GSTR1_Excel_Workbook_Template_V2.2.xlsx', XLSX_TYPE)
}
