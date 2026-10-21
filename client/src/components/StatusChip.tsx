import type { FormStatus } from '../api/types'
import { STATUS_LABELS, formatNumber } from '../lib/format'

const TONE: Record<FormStatus, string> = {
  received: 'chip-info',
  processing: 'chip-info',
  pending_review: 'chip-pending',
  approved: 'chip-ok',
  failed: 'chip-error',
  rejected: 'chip-muted',
}

export function StatusChip({ status }: { status: FormStatus }) {
  return <span className={`chip ${TONE[status]}`}>{STATUS_LABELS[status]}</span>
}

/** How many fields still need a look: just the number, in amber. */
export function YellowChip({ count }: { count: number }) {
  if (count <= 0) return null
  const label = count === 1 ? 'שדה אחד לבדיקה' : `${count} שדות לבדיקה`
  return (
    <span className="chip chip-flag chip-count" title={label} aria-label={label}>
      {formatNumber(count)}
    </span>
  )
}
