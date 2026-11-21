const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function iso(year: number, month: number, day: number): string {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fullYear(year: string) {
  const value = Number(year)
  return year.length <= 2 ? 2000 + value : value
}

/**
 * Normalises a spreadsheet date to YYYY-MM-DD. Indian reports are day-first,
 * so "01-10-2026" is 1 October 2026. Trailing times are ignored.
 * Returns the original text when the value cannot be parsed safely.
 */
export function formatDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS date cells: use local calendar parts (IST is ahead of UTC, so no day shift).
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  if (typeof value === 'number' && value > 20_000 && value < 80_000) {
    // Excel serial date that arrived without a date format.
    const date = new Date(Math.round((value - 25_569) * 86_400_000))
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  const text = value === null || value === undefined ? '' : String(value).trim()
  if (!text) return ''

  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) || text

  const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|[T\s,])/)
  if (dayFirst) {
    return iso(fullYear(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1])) || text
  }

  const named = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2}|\d{4})(?:$|[T\s,])/)
  if (named) {
    const month = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()]
    if (month) return iso(fullYear(named[3]), month, Number(named[1])) || text
  }

  const monthFirstNamed = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/)
  if (monthFirstNamed) {
    const month = MONTHS[monthFirstNamed[1].slice(0, 3).toLowerCase()]
    if (month) return iso(Number(monthFirstNamed[3]), month, Number(monthFirstNamed[2])) || text
  }

  return text
}

/** YYYY-MM-DD → DD-MM-YYYY (GSTN JSON date format). */
export function toGstnDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-')
  return `${day}-${month}-${year}`
}
