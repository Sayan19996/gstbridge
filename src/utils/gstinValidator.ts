const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const GSTIN_CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman and Diu (legacy)',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '28': 'Andhra Pradesh (legacy)',
  '97': 'Other Territory',
}

function hasValidChecksum(gstin: string) {
  let sum = 0
  let factor = 2

  for (let index = 13; index >= 0; index -= 1) {
    const product = GSTIN_CHARACTERS.indexOf(gstin[index]) * factor
    sum += Math.floor(product / 36) + product % 36
    factor = factor === 2 ? 1 : 2
  }

  const checkDigit = GSTIN_CHARACTERS[(36 - (sum % 36)) % 36]
  return gstin[14] === checkDigit
}

export function validateGSTIN(gstin: string): boolean {
  const normalized = gstin.trim().toUpperCase()
  if (!GSTIN_PATTERN.test(normalized) || !STATE_CODES[normalized.slice(0, 2)]) {
    return false
  }

  return hasValidChecksum(normalized)
}

export function isValidGstin(value: string): boolean {
  return validateGSTIN(value)
}

// Common spellings found in marketplace reports, mapped to GST state codes.
const STATE_ALIASES: Record<string, string> = {
  jammuandkashmir: '01', jk: '01', jandk: '01',
  himachalpradesh: '02', hp: '02',
  punjab: '03', pb: '03',
  chandigarh: '04', ch: '04',
  uttarakhand: '05', uttaranchal: '05', uk: '05', ut: '05',
  haryana: '06', hr: '06',
  delhi: '07', newdelhi: '07', nctofdelhi: '07', dl: '07',
  rajasthan: '08', rj: '08',
  uttarpradesh: '09', up: '09',
  bihar: '10', br: '10',
  sikkim: '11', sk: '11',
  arunachalpradesh: '12', ar: '12',
  nagaland: '13', nl: '13',
  manipur: '14', mn: '14',
  mizoram: '15', mz: '15',
  tripura: '16', tr: '16',
  meghalaya: '17', ml: '17',
  assam: '18', as: '18',
  westbengal: '19', wb: '19',
  jharkhand: '20', jh: '20',
  odisha: '21', orissa: '21', od: '21', or: '21',
  chhattisgarh: '22', chattisgarh: '22', chhatisgarh: '22', cg: '22', ct: '22',
  madhyapradesh: '23', mp: '23',
  gujarat: '24', gj: '24',
  damananddiu: '26', dd: '26',
  dadraandnagarhaveli: '26', dadranagarhaveli: '26', dn: '26',
  dadraandnagarhavelianddamananddiu: '26', dnhdd: '26',
  maharashtra: '27', mh: '27',
  karnataka: '29', ka: '29',
  goa: '30', ga: '30',
  lakshadweep: '31', lakshdweep: '31', ld: '31',
  kerala: '32', kl: '32',
  tamilnadu: '33', tn: '33',
  puducherry: '34', pondicherry: '34', py: '34',
  andamanandnicobarislands: '35', andamanandnicobar: '35', an: '35',
  telangana: '36', tg: '36', ts: '36',
  andhrapradesh: '37', ap: '37',
  ladakh: '38', la: '38',
  othernorthernterritory: '97', otherterritory: '97',
}

function compactStateName(value: string) {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')
}

/**
 * Returns the 2-digit GST state code for a place-of-supply value such as
 * "27", "27-Maharashtra", "MAHARASHTRA", "Jammu & Kashmir" or "MH".
 * Returns '' when the value cannot be resolved.
 */
export function stateCodeFromPlace(place: string) {
  const normalized = place.trim().toLowerCase()
  if (!normalized) return ''

  const leadingCode = normalized.match(/^(\d{1,2})(?:\s*[-–:]|$)/)
  if (leadingCode) {
    const code = leadingCode[1].padStart(2, '0')
    return STATE_CODES[code] ? code : ''
  }

  const compact = compactStateName(normalized)
  const byName = Object.entries(STATE_CODES)
    .find(([, name]) => compactStateName(name) === compact)?.[0]
  if (byName && byName !== '25' && byName !== '28') return byName
  return STATE_ALIASES[compact] ?? ''
}

export function stateNameForCode(code: string) {
  return STATE_CODES[code] ?? ''
}
