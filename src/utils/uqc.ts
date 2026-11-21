// Unit Quantity Codes exactly as listed in the official GSTR-1 workbook (master sheet).
export const OFFICIAL_UQC_LABELS = [
  'BAG-BAGS', 'BAL-BALE', 'BDL-BUNDLES', 'BKL-BUCKLES', 'BOU-BILLION OF UNITS', 'BOX-BOX',
  'BTL-BOTTLES', 'BUN-BUNCHES', 'CAN-CANS', 'CBM-CUBIC METERS', 'CCM-CUBIC CENTIMETERS',
  'CMS-CENTIMETERS', 'CTN-CARTONS', 'DOZ-DOZENS', 'DRM-DRUMS', 'GGK-GREAT GROSS', 'GMS-GRAMMES',
  'GRS-GROSS', 'GYD-GROSS YARDS', 'KGS-KILOGRAMS', 'KLR-KILOLITRE', 'KME-KILOMETRE', 'LTR-LITRES',
  'MLT-MILILITRE', 'MTR-METERS', 'MTS-METRIC TON', 'NOS-NUMBERS', 'PAC-PACKS', 'PCS-PIECES',
  'PRS-PAIRS', 'QTL-QUINTAL', 'ROL-ROLLS', 'SET-SETS', 'SQF-SQUARE FEET', 'SQM-SQUARE METERS',
  'SQY-SQUARE YARDS', 'TBS-TABLETS', 'TGM-TEN GROSS', 'THD-THOUSANDS', 'TON-TONNES', 'TUB-TUBES',
  'UGS-US GALLONS', 'UNT-UNITS', 'YDS-YARDS', 'OTH-OTHERS',
] as const

export const DEFAULT_UQC_LABEL = 'NOS-NUMBERS'

const WORD_ALIASES: Record<string, string> = {
  NUMBER: 'NOS', NUMBERS: 'NOS', NO: 'NOS', NOS: 'NOS', NUM: 'NOS', EA: 'NOS', EACH: 'NOS',
  PIECE: 'PCS', PIECES: 'PCS', PC: 'PCS', PCS: 'PCS',
  UNIT: 'UNT', UNITS: 'UNT', U: 'UNT',
  PAIR: 'PRS', PAIRS: 'PRS', PR: 'PRS',
  SET: 'SET', SETS: 'SET',
  PACK: 'PAC', PACKS: 'PAC', PKT: 'PAC', PACKET: 'PAC', PACKETS: 'PAC',
  BOX: 'BOX', BOXES: 'BOX',
  BOTTLE: 'BTL', BOTTLES: 'BTL',
  KG: 'KGS', KGS: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS',
  G: 'GMS', GM: 'GMS', GMS: 'GMS', GRAM: 'GMS', GRAMS: 'GMS',
  L: 'LTR', LTR: 'LTR', LITRE: 'LTR', LITRES: 'LTR', LITER: 'LTR', LITERS: 'LTR',
  ML: 'MLT', MILLILITRE: 'MLT', MILLILITER: 'MLT',
  M: 'MTR', METER: 'MTR', METERS: 'MTR', METRE: 'MTR', METRES: 'MTR',
  DOZEN: 'DOZ', DOZENS: 'DOZ',
  ROLL: 'ROL', ROLLS: 'ROL',
}

/** Resolves free-text units ("Nos", "pieces", "PCS-PIECES", "kg") to the official label, or ''. */
export function normalizeUqc(value: string): string {
  const text = value.trim().toUpperCase()
  if (!text) return ''
  const exact = OFFICIAL_UQC_LABELS.find((label) => label === text)
  if (exact) return exact
  const code = text.split(/[-\s]/)[0].replace(/[^A-Z]/g, '')
  const resolved = WORD_ALIASES[code] ?? WORD_ALIASES[text.replace(/[^A-Z]/g, '')] ?? code
  return OFFICIAL_UQC_LABELS.find((label) => label.startsWith(`${resolved}-`)) ?? ''
}

export function uqcCode(label: string) {
  return label.split('-')[0]
}

export function isServiceCode(hsn: string) {
  return /^99/.test(hsn.replace(/\D/g, ''))
}
