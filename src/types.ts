export type Marketplace = 'amazon' | 'flipkart' | 'meesho' | 'generic'

export type SupplyType =
  | 'domestic'
  | 'export'
  | 'sez'
  | 'deemed_export'
  | 'nil'
  | 'exempt'
  | 'non_gst'
  | 'unknown'

export type DocumentType = 'invoice' | 'credit_note' | 'debit_note' | 'unknown'
export type CdnurType = 'B2CL' | 'EXPWP' | 'EXPWOP'
export type B2CSSupplyType = 'OE' | 'E'
export type EcommerceNatureOfSupply =
  | 'Liable to collect tax u/s 52(TCS)'
  | 'Liable to pay tax u/s 9(5)'
export type Table13DocumentNature =
  | 'Invoices for outward supply'
  | 'Invoices for inward supply from unregistered person'
  | 'Revised Invoice'
  | 'Debit Note'
  | 'Credit Note'
  | 'Receipt Voucher'
  | 'Payment Voucher'
  | 'Refund Voucher'
  | 'Delivery Challan for job work'
  | 'Delivery Challan for supply on approval'
  | 'Delivery Challan in case of liquid gas'
  | 'Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)'

export type GstCategory =
  | 'B2B'
  | 'B2B_REVERSE_CHARGE'
  | 'B2CL'
  | 'B2CS'
  | 'CDN'
  | 'REVERSE_CHARGE'
  | 'EXPORT'
  | 'SEZ'
  | 'DEEMED_EXPORT'
  | 'NIL_EXEMPT_NON_GST'
  | 'REVIEW_REQUIRED'

export type TaxStatus = 'reported' | 'partially_reported' | 'estimated' | 'unresolved'

export type Gstr1Table = '4A' | '4B' | '5' | '6A' | '6B' | '6C' | '7' | '8' | '9B'

export interface SalesRecord {
  orderId: string
  invoiceNumber: string
  invoiceDate: string
  customerName: string
  customerGstin: string | null
  placeOfSupply: string
  hsn: string
  description: string
  quantity: number
  taxableValue: number
  taxRate: number
  invoiceValue?: number
  uqc: string
  supplyType: SupplyType
  documentType: DocumentType
  reverseCharge: boolean
  urType?: CdnurType
  reportedIgst?: number
  reportedCgst?: number
  reportedSgst?: number
  reportedTaxAmount?: number
  reportedCess?: number
  reportedTcs?: number
  isCreditNote: boolean
  isDebitNote: boolean
  marketplace: Marketplace
  sourceRow: number
  /** Seller GSTIN printed on the source row (Amazon/Flipkart reports carry it). */
  sellerGstin?: string
  /** When set, the row is ignored for the return (cancelled order, zero value, other GSTIN). */
  excludeReason?: string
  /** File the row came from, when several files are combined. */
  sourceFile?: string
}

export interface ClassifiedSalesRecord extends SalesRecord {
  category: GstCategory
  returnTable: Gstr1Table | null
  interstate: boolean | null
  taxStatus: TaxStatus
  cgst: number
  sgst: number
  igst: number
  cess: number | null
}

export interface ValidationIssue {
  row: number
  severity: 'error' | 'warning'
  message: string
}

export interface HsnSummary {
  hsn: string
  description: string
  uqc: string
  taxRate: number
  quantity: number
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
  cessUnreportedRows: number
  unallocatedTax: number
}

export interface Table13DocumentSummary {
  natureOfDocument: Table13DocumentNature
  fromNumber: string
  toNumber: string
  totalIssued: number
  totalCancelled: number
}

export interface EcommerceOperatorDetails {
  gstin: string
  name: string
}

export interface GstReportOptions {
  filingPeriod?: string
  annualAggregateTurnover?: number
  table13Documents?: Table13DocumentSummary[]
  portalTcsTotal?: number
  b2csSupplyType?: B2CSSupplyType
  ecommerceOperator?: EcommerceOperatorDetails
  ecommerceNatureOfSupply?: EcommerceNatureOfSupply
}

export interface GstReport {
  filingPeriod: string
  annualAggregateTurnover?: number
  records: ClassifiedSalesRecord[]
  /** Rows left out of the return, each with excludeReason set. */
  excluded: SalesRecord[]
  b2b: ClassifiedSalesRecord[]
  reverseCharge: ClassifiedSalesRecord[]
  b2cl: ClassifiedSalesRecord[]
  b2cs: ClassifiedSalesRecord[]
  cdn: ClassifiedSalesRecord[]
  exports: ClassifiedSalesRecord[]
  sez: ClassifiedSalesRecord[]
  deemedExports: ClassifiedSalesRecord[]
  nilExemptNonGst: ClassifiedSalesRecord[]
  reviewRequired: ClassifiedSalesRecord[]
  hsn: HsnSummary[]
  table13: Table13DocumentSummary[]
  table14: ClassifiedSalesRecord[]
  portalTcsTotal?: number
  b2csSupplyType?: B2CSSupplyType
  ecommerceOperator?: EcommerceOperatorDetails
  ecommerceNatureOfSupply?: EcommerceNatureOfSupply
  issues: ValidationIssue[]
}
