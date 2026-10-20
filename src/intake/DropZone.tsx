import { FolderOpen, UploadCloud } from 'lucide-react'
import { useId, useRef } from 'react'
import { ACCEPT_ATTR } from '../lib/files'

interface Props {
  dragging: boolean
  onFiles: (files: File[]) => void
}

export function DropZone({ dragging, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const open = () => inputRef.current?.click()

  return (
    <section
      className={`dropzone${dragging ? ' is-dragging' : ''}`}
      aria-label="הוספת טפסים"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) open()
      }}
    >
      <span className="dz-icon" aria-hidden="true">
        <UploadCloud size={30} />
      </span>
      <p className="dz-title">{dragging ? 'שחררו כדי להוסיף לתור' : 'גררו לכאן טפסים'}</p>
      <p className="dz-sub" id={hintId}>
        כמה שרוצים, מכל הסוגים, גם תיקייה שלמה. אפשר גם להדביק צילום מסך עם{' '}
        <kbd>Ctrl</kbd>+<kbd>V</kbd>
      </p>
      <button type="button" className="btn btn-primary" onClick={open} aria-describedby={hintId}>
        <FolderOpen size={18} aria-hidden="true" />
        בחירת קבצים מהמחשב
      </button>
      <p className="dz-formats">PDF · JPG · PNG · TIFF · HEIC · WEBP · עד 25MB לקובץ</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </section>
  )
}
