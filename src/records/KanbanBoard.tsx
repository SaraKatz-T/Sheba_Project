import { Copy, Smartphone } from 'lucide-react'
import type { FormStatus, FormSummary } from '../api/types'
import { YellowChip } from '../components/StatusChip'
import { formatDateTime, formatNumber } from '../lib/format'
import type { DuplicateGroup } from './duplicates'

const CARDS_PER_COLUMN = 40

interface ColumnDef {
  key: string
  title: string
  statuses: FormStatus[]
  /** Work queues read oldest first; history reads newest first. */
  oldestFirst: boolean
  empty: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'working', title: 'בקליטה', statuses: ['received', 'processing'], oldestFirst: true, empty: 'אין טפסים בעיבוד' },
  { key: 'pending', title: 'ממתין לבדיקה', statuses: ['pending_review'], oldestFirst: true, empty: 'אין טפסים ממתינים 🎉' },
  { key: 'approved', title: 'אושר', statuses: ['approved'], oldestFirst: false, empty: 'עוד לא אושרו טפסים' },
  { key: 'failed', title: 'נכשל', statuses: ['failed'], oldestFirst: false, empty: 'אין כשלים' },
  { key: 'rejected', title: 'נדחה', statuses: ['rejected'], oldestFirst: false, empty: 'אין טפסים שנדחו' },
]

interface Props {
  forms: FormSummary[]
  visibleStatuses: FormStatus[]
  duplicates: Map<string, DuplicateGroup>
  onShowColumn: (statuses: FormStatus[]) => void
  /** Opens the record in place in the table. */
  onOpen: (id: string) => void
}

export function KanbanBoard({ forms, visibleStatuses, duplicates, onShowColumn, onOpen }: Props) {
  const columns = visibleStatuses.length
    ? COLUMNS.filter((c) => c.statuses.some((s) => visibleStatuses.includes(s)))
    : COLUMNS

  return (
    <div className="board" style={{ ['--cols' as string]: columns.length }}>
      {columns.map((col) => {
        const items = forms
          .filter((f) => col.statuses.includes(f.status))
          .sort((a, b) => (col.oldestFirst ? 1 : -1) * a.received_at.localeCompare(b.received_at))
        const headingId = `col-${col.key}`
        return (
          <section key={col.key} className={`board-col board-col-${col.key}`} aria-labelledby={headingId}>
            <header className="board-head">
              <h2 id={headingId}>{col.title}</h2>
              <span className="board-count">{formatNumber(items.length)}</span>
            </header>
            {items.length === 0 ? (
              <p className="board-empty">{col.empty}</p>
            ) : (
              <ul className="board-list">
                {items.slice(0, CARDS_PER_COLUMN).map((f) => (
                  <li key={f.id}>
                    <button type="button" className="board-card" onClick={() => onOpen(f.id)}>
                      <span className="board-card-key">
                        {f.commitment_number ? (
                          <span className="ltr num">{f.commitment_number}</span>
                        ) : (
                          <span className="muted">{f.status === 'failed' ? 'לא נקרא' : 'טרם חולץ'}</span>
                        )}
                      </span>
                      {f.person_name && (
                        <span className="board-card-name">
                          {f.person_name}
                          {f.id_number && <span className="ltr num muted board-card-id">{f.id_number}</span>}
                        </span>
                      )}
                      <span className="board-card-meta num">
                        {f.source === 'phone' && <Smartphone size={13} aria-label="צולם בטלפון" />}
                        {formatDateTime(f.received_at)}
                      </span>
                      {((f.status === 'pending_review' && f.uncertain_count > 0) || duplicates.has(f.id)) && (
                        <span className="board-card-chips">
                          {f.status === 'pending_review' && <YellowChip count={f.uncertain_count} />}
                          {duplicates.has(f.id) && (
                            <span className="chip chip-pending">
                              <Copy size={12} aria-hidden="true" />
                              כפילות
                            </span>
                          )}
                        </span>
                      )}
                      {f.status === 'failed' && f.error && <span className="board-card-error">{f.error}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {items.length > CARDS_PER_COLUMN && (
              <button type="button" className="btn btn-sm btn-quiet board-more" onClick={() => onShowColumn(col.statuses)}>
                עוד {formatNumber(items.length - CARDS_PER_COLUMN)} בטבלה
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
