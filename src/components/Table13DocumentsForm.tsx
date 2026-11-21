import { useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { TABLE13_DOCUMENT_NATURES } from '../gst-engine/table13Generator'
import type { Table13DocumentNature, Table13DocumentSummary } from '../types'

interface Table13DocumentsFormProps {
  documents: Table13DocumentSummary[]
  onChange: (documents: Table13DocumentSummary[]) => void
  /** Builds suggested rows from the uploaded file; null when the report has no document numbers. */
  suggest: (() => Table13DocumentSummary[]) | null
}

function Table13DocumentsForm({ documents, onChange, suggest }: Table13DocumentsFormProps) {
  const [note, setNote] = useState('')
  const updateDocument = (
    index: number,
    field: keyof Table13DocumentSummary,
    value: string | number,
  ) => {
    onChange(documents.map((document, documentIndex) => documentIndex === index
      ? { ...document, [field]: value }
      : document))
  }

  const addDocument = () => {
    onChange([...documents, {
      natureOfDocument: TABLE13_DOCUMENT_NATURES[0],
      fromNumber: '',
      toNumber: '',
      totalIssued: 0,
      totalCancelled: 0,
    }])
  }

  return (
    <div className="form-section table13-section">
      <div className="field-heading">
        <span className="field-number">6</span>
        <div>
          <strong>Table 13 document series</strong>
          <small>Enter the actual document-number ranges and counts for this period.</small>
        </div>
      </div>
      <p className="mapping-note">
        Auto-fill reads the invoice and credit-note numbers in your file (one row per numbering series).
        Add cancelled counts and any series issued outside this marketplace yourself.
      </p>
      <div className="table13-actions">
        <button
          className="text-button table13-add"
          disabled={!suggest}
          type="button"
          onClick={() => {
            const rows = suggest?.() ?? []
            setNote(rows.length > 0 ? '' : 'No invoice or credit-note numbers were found in the uploaded file.')
            if (rows.length > 0) onChange(rows)
          }}
        >
          <Wand2 size={14} /> Auto-fill from file
        </button>
        {!suggest && (
          <small>Upload a report first. Meesho's GST report has no invoice numbers — copy the series from Meesho's invoice download.</small>
        )}
        {note && <small>{note}</small>}
      </div>
      {documents.map((document, index) => (
        <div className="table13-row" key={`${index}-${document.natureOfDocument}`}>
          <label className="form-control">
            <span>Nature of document</span>
            <select
              className="market-select"
              value={document.natureOfDocument}
              onChange={(event) => updateDocument(
                index,
                'natureOfDocument',
                event.currentTarget.value as Table13DocumentNature,
              )}
            >
              {TABLE13_DOCUMENT_NATURES.map((nature) => (
                <option key={nature} value={nature}>{nature}</option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span>Serial number from</span>
            <input
              className="market-select"
              value={document.fromNumber}
              onChange={(event) => updateDocument(index, 'fromNumber', event.currentTarget.value)}
            />
          </label>
          <label className="form-control">
            <span>Serial number to</span>
            <input
              className="market-select"
              value={document.toNumber}
              onChange={(event) => updateDocument(index, 'toNumber', event.currentTarget.value)}
            />
          </label>
          <label className="form-control">
            <span>Total issued</span>
            <input
              className="market-select"
              min="0"
              type="number"
              value={document.totalIssued}
              onChange={(event) => updateDocument(index, 'totalIssued', Number(event.currentTarget.value))}
            />
          </label>
          <label className="form-control">
            <span>Cancelled</span>
            <input
              className="market-select"
              min="0"
              type="number"
              value={document.totalCancelled}
              onChange={(event) => updateDocument(index, 'totalCancelled', Number(event.currentTarget.value))}
            />
          </label>
          <button
            aria-label={`Remove document series ${index + 1}`}
            className="text-button table13-remove"
            type="button"
            onClick={() => onChange(documents.filter((_, documentIndex) => documentIndex !== index))}
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
      ))}
      <button className="text-button table13-add" type="button" onClick={addDocument}>
        <Plus size={14} /> Add document series
      </button>
    </div>
  )
}

export default Table13DocumentsForm
