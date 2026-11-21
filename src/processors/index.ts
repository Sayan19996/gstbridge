import processAmazonRows, { amazonAliases } from './amazonProcessor'
import processFlipkartRows, { flipkartAliases } from './flipkartProcessor'
import processGenericRows, { createDefaultColumnMapping } from './genericProcessor'
import processMeeshoRows, { meeshoAliases } from './meeshoProcessor'
import { normalizeRows } from './genericProcessor'
import type { Marketplace, SalesRecord } from '../types'
import type { SalesAliases, SalesColumnMapping } from './genericProcessor'

export type { SalesColumnMapping, SalesField } from './genericProcessor'

const marketplaceAliases: Record<Marketplace, SalesAliases> = {
  amazon: amazonAliases,
  flipkart: flipkartAliases,
  meesho: meeshoAliases,
  generic: {},
}

export function createMarketplaceColumnMapping(
  marketplace: Marketplace,
  headers: string[],
): SalesColumnMapping {
  return createDefaultColumnMapping(headers, marketplaceAliases[marketplace])
}

export function processMarketplaceRows(
  marketplace: Marketplace,
  rows: Record<string, unknown>[],
  columnMapping?: SalesColumnMapping,
): SalesRecord[] {
  switch (marketplace) {
    case 'amazon':
      return processAmazonRows(rows, columnMapping)
    case 'flipkart':
      return processFlipkartRows(rows, columnMapping)
    case 'meesho':
      return processMeeshoRows(rows, columnMapping)
    case 'generic':
      return columnMapping
        ? normalizeRows(rows, 'generic', {}, columnMapping)
        : processGenericRows(rows)
  }
}
