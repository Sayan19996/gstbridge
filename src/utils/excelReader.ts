import * as XLSX from 'xlsx'

export type ExcelWorkbook = Record<string, Record<string, unknown>[]>

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false
  let closedQuote = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (inQuotes) {
        inQuotes = false
        closedQuote = true
      } else if (value === '' && !closedQuote) {
        inQuotes = true
      } else {
        throw new Error('The CSV file contains a quote outside a quoted field.')
      }
    } else if (character === ',' && !inQuotes) {
      row.push(value)
      value = ''
      closedQuote = false
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      value = ''
      closedQuote = false
    } else {
      if (closedQuote && !/\s/.test(character)) {
        throw new Error('The CSV file contains data after a closing quote.')
      }
      if (closedQuote) continue
      value += character
    }
  }

  if (inQuotes) throw new Error('The CSV file contains an unterminated quoted field.')
  if (value !== '' || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell !== '')) rows.push(row)
  }
  return rows
}

/**
 * Some marketplace exports put a title or notes above the real header row.
 * Pick the first row (within the first 15) that is at least 60% as wide as the
 * widest row, and use it as the header.
 */
function rowsToObjects(matrix: unknown[][]): Record<string, unknown>[] {
  const isFilled = (cell: unknown) => cell !== null && cell !== undefined && String(cell).trim() !== ''
  const widths = matrix.slice(0, 15).map((row) => row.filter(isFilled).length)
  const maxWidth = Math.max(0, ...widths)
  if (maxWidth === 0) return []
  const headerIndex = widths.findIndex((width) => width >= Math.max(2, Math.ceil(maxWidth * 0.6)))
  const seen = new Map<string, number>()
  const headers = (matrix[headerIndex] ?? []).map((cell, index) => {
    const base = isFilled(cell) ? String(cell).trim() : `__EMPTY${index}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count > 1 ? `${base} (${count})` : base
  })

  return matrix.slice(headerIndex + 1)
    .filter((cells) => cells.some(isFilled))
    .map((cells) => {
      const record: Record<string, unknown> = {}
      headers.forEach((header, index) => {
        const cell = cells[index]
        record[header] = isFilled(cell) ? cell : null
      })
      return record
    })
}

function readCsv(text: string): ExcelWorkbook {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  const objects = rowsToObjects(rows)
  return objects.length > 0 ? { Sheet1: objects } : {}
}

export async function readExcel(file: File): Promise<ExcelWorkbook> {
  const name = file.name.toLowerCase()
  if (!/\.(xlsx|xls|csv)$/.test(name)) {
    throw new Error(`"${file.name}" is not an Excel or CSV file. Upload the .xlsx, .xls or .csv report downloaded from the marketplace.`)
  }
  const buffer = await file.arrayBuffer()
  if (name.endsWith('.csv')) {
    return readCsv(new TextDecoder().decode(buffer))
  }

  const bytes = new Uint8Array(buffer.slice(0, 4))
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (name.endsWith('.xlsx') && !isZip) {
    throw new Error(`"${file.name}" is not a valid Excel file (it may be damaged or renamed). Download the report again, or save it as .xlsx or .csv.`)
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
    })
  } catch {
    throw new Error(`"${file.name}" could not be read as a spreadsheet. Download the report again, or save it as .xlsx or .csv.`)
  }

  const result: ExcelWorkbook = {}

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) {
      throw new Error(`Worksheet "${sheetName}" could not be read.`)
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
      // raw values keep dates as Date objects and numbers as numbers, avoiding
      // locale-dependent text such as "10/1/26" (m/d/yy) being misread.
      raw: true,
    })
    result[sheetName] = rowsToObjects(matrix)
  })

  return result
}
