import type { ClassifiedSalesRecord } from '../types'

export function generateB2CL(records: ClassifiedSalesRecord[]) {
  return records.filter((record) => record.category === 'B2CL')
}
