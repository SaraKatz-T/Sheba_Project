import { CircleCheck, X } from 'lucide-react'
import { useEffect } from 'react'
import { formatNumber } from '../lib/format'

/** What the send-to-lab dialog reports once the server has accepted the file. */
export interface SentInfo {
  sentTo: string
  count: number
  fileName: string
}

const SHOW_MS = 8000

/** The card that confirms a send to the lab: how many forms, which file, and where it went. */
export function SentNotice({ sent, onClose }: { sent: SentInfo; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, SHOW_MS)
    return () => clearTimeout(t)
  }, [sent, onClose])

  return (
    <aside className="sent-notice" role="status" aria-live="polite">
      <header className="sent-notice-head">
        <CircleCheck size={20} aria-hidden="true" />
        <strong>נשלח למעבדה</strong>
        <button type="button" className="sent-notice-close" onClick={onClose} aria-label="סגירה">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="sent-notice-body">
        <p className="sent-notice-title">
          {sent.count === 1 ? 'טופס אחד נשלח' : `${formatNumber(sent.count)} טפסים נשלחו`}
        </p>
        <div className="sent-notice-file">
          <span className="sent-notice-xls" aria-hidden="true">
            XLSX
          </span>
          <span className="sent-notice-file-text">
            <bdi className="sent-notice-file-name">{sent.fileName}</bdi>
            <span className="muted">קובץ Excel · {sent.count === 1 ? 'שורה אחת' : `${formatNumber(sent.count)} שורות`}</span>
          </span>
        </div>
        <p className="sent-notice-note">
          בשלב זה הקובץ נשלח במייל ל-<bdi className="ltr">{sent.sentTo}</bdi>
        </p>
      </div>
    </aside>
  )
}
