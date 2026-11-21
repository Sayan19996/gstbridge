export interface TaxBreakdown {
  cgst: number
  sgst: number
  igst: number
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateGST(taxableValue: number, rate: number, interstate: boolean): TaxBreakdown {
  const tax = roundCurrency(taxableValue * rate / 100)
  return interstate
    ? { cgst: 0, sgst: 0, igst: tax }
    : { cgst: roundCurrency(tax / 2), sgst: roundCurrency(tax - roundCurrency(tax / 2)), igst: 0 }
}

export function calculateTax(taxableValue: number, taxRate: number, interstate: boolean): TaxBreakdown {
  return calculateGST(taxableValue, taxRate, interstate)
}
