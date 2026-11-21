import { useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'

interface FileUploadProps {
  fileName: string
  isLoading: boolean
  onFiles: (files: File[]) => void
  onClear: () => void
}

function FileUpload({ fileName, isLoading, onFiles, onClear }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    if (files.length > 0) onFiles(files)
    event.currentTarget.value = ''
  }

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length > 0) onFiles(files)
  }

  return (
    <div className="upload-field">
      <label
        className={`upload-zone${isDragging ? ' dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false) }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          aria-label="Choose an Excel or CSV sales report"
          disabled={isLoading}
          onChange={handleChange}
        />
        <span className="upload-icon">
          {isLoading ? <LoaderCircle size={21} className="spin" /> : <FileSpreadsheet size={21} />}
        </span>
        <span className="upload-copy">
          <strong>{isLoading ? 'Reading your report…' : 'Drop your report here or browse'}</strong>
          <span>Excel or CSV · add several files for one month (e.g. Amazon MTR B2C + B2B, or Meesho sales + returns)</span>
        </span>
      </label>
      <div className="upload-row upload-file-info">
        <span>{fileName || 'Your data is processed locally'}</span>
        {fileName && <button className="text-button" type="button" onClick={onClear}>Remove all files</button>}
      </div>
    </div>
  )
}

export default FileUpload
