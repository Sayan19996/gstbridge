import type { ClassifiedSalesRecord } from '../types'

export function generateB2B(records: ClassifiedSalesRecord[]) {
  return records.filter((record) =>
    record.category === 'B2B' || record.category === 'B2B_REVERSE_CHARGE')
}
