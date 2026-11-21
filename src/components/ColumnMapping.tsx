import type { SalesColumnMapping, SalesField } from '../processors'

interface ColumnMappingProps {
  headers: string[]
  mapping: SalesColumnMapping
  onChange: (mapping: SalesColumnMapping) => void
}

const fields: Array<{ key: SalesField; label: string }> = [
  { key: 'orderId', label: 'Order ID' },
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'invoiceDate', label: 'Invoice date' },
  { key: 'customerName', label: 'Customer name' },
  { key: 'customerGstin', label: 'Customer GSTIN' },
  { key: 'placeOfSupply', label: 'Place of supply' },
  { key: 'hsn', label: 'HSN / SAC' },
  { key: 'description', label: 'Item description' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'taxableValue', label: 'Taxable value' },
  { key: 'taxRate', label: 'GST rate' },
  { key: 'invoiceValue', label: 'Invoice value' },
  { key: 'uqc', label: 'Unit of quantity (UQC)' },
  { key: 'reportedIgst', label: 'Reported IGST' },
  { key: 'reportedCgst', label: 'Reported CGST' },
  { key: 'reportedSgst', label: 'Reported SGST / UTGST' },
  { key: 'reportedTaxAmount', label: 'Reported total tax' },
  { key: 'reportedCess', label: 'Reported cess' },
  { key: 'reportedTcs', label: 'Reported TCS' },
  { key: 'supplyType', label: 'Supply type' },
  { key: 'documentType', label: 'Document type' },
  { key: 'reverseCharge', label: 'Reverse charge' },
  { key: 'urType', label: 'Unregistered note type (CDNUR)' },
  { key: 'sellerGstin', label: 'Seller GSTIN on row' },
  { key: 'excludeReason', label: 'Exclude reason' },
]

function ColumnMapping({ headers, mapping, onChange }: ColumnMappingProps) {
  return (
    <div className="form-section mapping-section">
      <div className="field-heading">
        <span className="field-number">5</span>
        <div>
          <strong>Review column mapping</strong>
          <small>Check the detected fields or choose the matching report columns.</small>
        </div>
      </div>
      <p className="mapping-note">
        Mapping applies to this file only. Unmapped values stay blank and are flagged for review.
      </p>
      <div className="mapping-grid">
        {fields.map(({ key, label }) => (
          <label className="form-control" key={key}>
            <span>{label}</span>
            <select
              aria-label={`Map ${label}`}
              className="market-select"
              value={mapping[key]}
              onChange={(event) => onChange({ ...mapping, [key]: event.currentTarget.value })}
            >
              <option value="">Not mapped</option>
              {headers.map((header, index) => (
                <option key={`${index}-${header}`} value={header}>{header}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}

export default ColumnMapping
