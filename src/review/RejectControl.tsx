import { useMutation } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { useId, useState } from 'react'
import { rejectForm } from '../api/endpoints'
import { upsertForm } from '../api/queries'

const REASONS = ['כפילות', 'הטופס לא רלוונטי למעבדה', 'הטופס לא קריא', 'אחר']

/** "Reject" asks for a reason first, so the decision is recorded and not a slip. */
export function RejectControl({ formId, onRejected }: { formId: string; onRejected: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REASONS[0])
  const [other, setOther] = useState('')
  const otherId = useId()
  const reject = useMutation({
    mutationFn: () => rejectForm(formId, reason === 'אחר' ? other.trim() || 'אחר' : reason),
    onSuccess: (form) => {
      upsertForm(form)
      onRejected()
    },
  })

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>
        <Ban size={18} aria-hidden="true" />
        דחייה
      </button>
    )
  }

  return (
    <div className="reject" role="group" aria-label="דחיית הטופס">
      <fieldset className="reject-reasons">
        <legend>למה לדחות?</legend>
        {REASONS.map((r) => (
          <label key={r} className="reject-reason">
            <input type="radio" name="reject-reason" checked={reason === r} onChange={() => setReason(r)} />
            {r}
          </label>
        ))}
      </fieldset>
      {reason === 'אחר' && (
        <>
          <label htmlFor={otherId} className="visually-hidden">
            סיבה
          </label>
          <input
            id={otherId}
            className="input"
            placeholder="סיבה קצרה"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            autoFocus
          />
        </>
      )}
      <div className="reject-actions">
        <button type="button" className="btn btn-sm btn-danger" onClick={() => reject.mutate()} disabled={reject.isPending}>
          דחיית הטופס
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
      {reject.error && (
        <p className="alert alert-danger" role="alert">
          {reject.error.message}
        </p>
      )}
    </div>
  )
}
