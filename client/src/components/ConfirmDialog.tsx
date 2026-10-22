import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  confirmLabel: string
  confirmIcon?: ReactNode
  /** A red button, for actions that remove something. */
  danger?: boolean
  pending?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

/** A short yes/no question in a modal dialog. The caller closes it (onClose) when the action is done. */
export function ConfirmDialog({ title, children, confirmLabel, confirmIcon, danger, pending, error, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dialog dialog-sm" aria-labelledby={titleId} onClose={onClose}>
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="סגירה">
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">
        <div>{children}</div>
        {error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-foot">
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          ביטול
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={pending}>
          {pending ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : confirmIcon}
          {confirmLabel}
        </button>
      </footer>
    </dialog>
  )
}
