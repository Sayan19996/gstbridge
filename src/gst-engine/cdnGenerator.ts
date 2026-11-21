import type { ClassifiedSalesRecord } from '../types'

export function generateCDN(records: ClassifiedSalesRecord[]) {
  return records.filter((record) => record.category === 'CDN')
}
