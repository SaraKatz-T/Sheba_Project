import { useMutation } from '@tanstack/react-query'
import { Copy, Merge, X } from 'lucide-react'
import { useState } from 'react'
import { createDismissal, rejectForm } from '../api/endpoints'
import { addDismissal, keys, queryClient } from '../api/queries'
import type { FormSummary } from '../api/types'
import { StatusChip } from '../components/StatusChip'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import type { DuplicateGroup } from './duplicates'

/** The page-head button: duplicates are flagged, but the list opens only on request. */
export function DuplicatesButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  if (count === 0) return null
  return (
    <button
      type="button"
      className={`btn btn-outline btn-dups${open ? ' is-open' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="dups-panel"
    >
      <Copy size={17} aria-hidden="true" />
      כפילויות
      <span className="badge">{formatNumber(count)}</span>
    </button>
  )
}

function CancelButton({ form, onAnnounce }: { form: FormSummary; onAnnounce: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const reject = useMutation({
    mutationFn: () => rejectForm(form.id, 'כפילות'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.forms })
      onAnnounce('הטופס סומן כפילות ונדחה.')
    },
  })

  if (form.status === 'approved') return <span className="muted dup-note">אושר, נשאר</span>
  if (!confirming) {
    return (
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirming(true)}>
        לבטל את הטופס הזה
      </button>
    )
  }
  return (
    <span className="dup-confirm" role="group" aria-label="אישור ביטול">
      <span>לסמן כפילות ולדחות?</span>
      <button type="button" className="btn btn-sm btn-danger" onClick={() => reject.mutate()} disabled={reject.isPending}>
        כן, לבטל
      </button>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirming(false)}>
        לא
      </button>
      {reject.error && <span className="dup-error">{reject.error.message}</span>}
    </span>
  )
}

function KeepAllButton({ group, onAnnounce }: { group: DuplicateGroup; onAnnounce: (m: string) => void }) {
  const keep = useMutation({
    mutationFn: () => createDismissal(group.forms.map((f) => f.id)),
    onSuccess: (dismissal) => {
      addDismissal(dismissal)
      onAnnounce('הטפסים נשארו כמו שהם.')
    },
  })
  return (
    <button type="button" className="btn btn-sm btn-outline" onClick={() => keep.mutate()} disabled={keep.isPending}>
      להשאיר את כולם
    </button>
  )
}

interface Props {
  groups: DuplicateGroup[]
  onClose: () => void
  onMerge: (group: DuplicateGroup) => void
  onAnnounce: (message: string) => void
  onOpen: (id: string) => void
}

export function DuplicatesPanel({ groups, onClose, onMerge, onAnnounce, onOpen }: Props) {
  return (
    <section id="dups-panel" className="dups fade-up" aria-labelledby="dups-title">
      <header className="dups-head">
        <span className="dups-icon" aria-hidden="true">
          <Copy size={18} />
        </span>
        <div>
          <h2 id="dups-title">כפילויות</h2>
          <p>
            {groups.length === 0
              ? 'אין כפילויות פתוחות.'
              : 'אפשר למזג לטופס אחד, לבטל את הכפול, או להשאיר את כולם. ההחלטה נשמרת לכולם.'}
          </p>
        </div>
        <button type="button" className="icon-btn dups-close" onClick={onClose} aria-label="סגירת רשימת הכפילויות">
          <X size={18} />
        </button>
      </header>

      {groups.length > 0 && (
        <ul className="dups-list">
          {groups.map((g) => {
            const name = g.forms.find((f) => f.person_name)?.person_name
            return (
              <li key={g.key} className="dup-group">
                <header className="dup-head">
                  {g.kind === 'form' ? (
                    <>
                      <strong>
                        התחייבות <span className="ltr num">{g.value}</span>
                      </strong>
                      <span className="muted">{name}</span>
                      <span className="chip chip-pending">
                        אותו טופס נקלט {g.forms.length === 2 ? 'פעמיים' : `${g.forms.length} פעמים`}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>{name}</strong>
                      <span className="muted">
                        ת"ז <span className="ltr num">{g.value}</span>
                      </span>
                      <span className="chip chip-muted">אותו מטופל, מספרי התחייבות שונים</span>
                    </>
                  )}
                  <span className="dup-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => onMerge(g)}>
                      <Merge size={15} aria-hidden="true" />
                      מיזוג…
                    </button>
                    <KeepAllButton group={g} onAnnounce={onAnnounce} />
                  </span>
                </header>
                <ul className="dup-forms">
                  {g.forms.map((f) => (
                    <li key={f.id} className="dup-form">
                      <button type="button" className="link-btn num" onClick={() => onOpen(f.id)}>
                        התקבל {formatDateTime(f.received_at)}
                      </button>
                      <span className="muted num">
                        {g.kind === 'person' && f.commitment_number ? (
                          <>
                            התחייבות <span className="ltr">{f.commitment_number}</span>
                          </>
                        ) : (
                          <>טופס מ-{f.form_date ? formatDate(f.form_date) : '—'}</>
                        )}
                      </span>
                      <span className="muted dup-file" title={f.file_name}>
                        {f.file_name}
                      </span>
                      <StatusChip status={f.status} />
                      <CancelButton form={f} onAnnounce={onAnnounce} />
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
