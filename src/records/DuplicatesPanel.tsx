import { useMutation } from '@tanstack/react-query'
import { ChevronDown, Copy, Merge } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { rejectForm } from '../api/endpoints'
import { keys, queryClient } from '../api/queries'
import type { FormSummary } from '../api/types'
import { StatusChip } from '../components/StatusChip'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { dismissGroup, type DuplicateGroup } from './duplicates'
import { formLink } from './RecordsTable'

interface Props {
  groups: DuplicateGroup[]
  open: boolean
  onToggle: () => void
  onMerge: (group: DuplicateGroup) => void
  onAnnounce: (message: string) => void
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

function bannerTitle(groups: DuplicateGroup[]) {
  const forms = groups.filter((g) => g.kind === 'form').length
  const people = groups.length - forms
  const parts = [
    forms && (forms === 1 ? 'טופס אחד נקלט יותר מפעם אחת' : `${formatNumber(forms)} טפסים נקלטו יותר מפעם אחת`),
    people && (people === 1 ? 'ת"ז אחת מופיעה בכמה טפסים' : `${formatNumber(people)} מספרי ת"ז מופיעים בכמה טפסים`),
  ].filter(Boolean)
  return parts.join(' · ')
}

export function DuplicatesPanel({ groups, open, onToggle, onMerge, onAnnounce }: Props) {
  if (groups.length === 0) return null

  return (
    <section className={`dups${open ? ' is-open' : ''}`} aria-labelledby="dups-title">
      <button type="button" className="dups-banner" onClick={onToggle} aria-expanded={open} aria-controls="dups-list">
        <span className="dups-icon" aria-hidden="true">
          <Copy size={18} />
        </span>
        <span id="dups-title" className="dups-title">
          {bannerTitle(groups)}
        </span>
        <span className="dups-sub">אפשר למזג לטופס אחד, לבטל את הכפול, או להשאיר את כולם</span>
        <ChevronDown size={20} className="dups-chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul id="dups-list" className="dups-list">
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
                      <span className="chip chip-pending">אותו טופס נקלט {g.forms.length === 2 ? 'פעמיים' : `${g.forms.length} פעמים`}</span>
                    </>
                  ) : (
                    <>
                      <strong>{name}</strong>
                      <span className="muted">
                        ת"ז <span className="ltr num">{g.value}</span>
                      </span>
                      <span className="chip chip-muted">מספרי התחייבות שונים: ייתכן שאלה טפסים שונים של אותו מטופל</span>
                    </>
                  )}
                  <span className="dup-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => onMerge(g)}>
                      <Merge size={15} aria-hidden="true" />
                      מיזוג…
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        dismissGroup(g.key)
                        onAnnounce('הטפסים נשארו כמו שהם.')
                      }}
                    >
                      להשאיר את כולם
                    </button>
                  </span>
                </header>
                <ul className="dup-forms">
                  {g.forms.map((f) => (
                    <li key={f.id} className="dup-form">
                      <Link to={formLink(f)} className="num">
                        התקבל {formatDateTime(f.received_at)}
                      </Link>
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
