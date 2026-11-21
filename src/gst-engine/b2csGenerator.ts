import type { ClassifiedSalesRecord } from '../types'

export function generateB2CS(records: ClassifiedSalesRecord[]) {
  return records.filter((record) => record.category === 'B2CS')
}
