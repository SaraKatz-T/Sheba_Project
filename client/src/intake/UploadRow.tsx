import { useMutation } from '@tanstack/react-query'
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FileImage,
  FileText,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { pauseUpload, removeUpload, resumeUpload, retryForm, retryUpload } from '../api/endpoints'
import { dropUpload, upsertForm, upsertUpload } from '../api/queries'
import type { FormSummary, Upload } from '../api/types'
import { formatBytes } from '../lib/files'
import { useAuthedImage } from '../lib/useAuthedImage'
import type { Row, RowView, Tone } from './rows'
import { removeItem, retryItem, sendAnyway } from './uploadQueue'


const TONE_ICON: Record<Tone, typeof LoaderCircle> = {
  busy: LoaderCircle,
  waiting: Clock,
  ok: CircleCheck,
  attention: TriangleAlert,
  error: CircleAlert,
}

function Bar({ value, tone, label }: { value: number | 'indeterminate'; tone: Tone; label: string }) {
  const indeterminate = value === 'indeterminate'
  return (
    <div
      className={`bar bar-${tone}${indeterminate ? ' bar-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
    >
      <span style={indeterminate ? undefined : { width: `${value}%` }} />
    </div>
  )
}

function Thumb({ row }: { row: Row }) {
  // A file picked on this computer previews from memory; anything else (a phone photo,
  // a PDF, or after a reload) asks the server for its thumbnail.
  const remote = useAuthedImage(row.previewUrl ? null : (row.upload?.thumbnail_url ?? null))
  const src = row.previewUrl ?? remote
  if (src) return <img className="up-thumb" src={src} alt="" />
  const isPdf = /\.pdf$/i.test(row.name) || row.upload?.file_type === 'application/pdf'
  const Icon = isPdf ? FileText : FileImage
  return (
    <span className="up-thumb up-thumb-icon" aria-hidden="true">
      <Icon size={22} />
    </span>
  )
}

/**
 * The file's own bar shows the progress of all its forms together. Only a form that
 * failed gets a line of its own, so it can be retried.
 */
function FailedFormLine({ form, index }: { form: FormSummary; index: number }) {
  const retry = useMutation({ mutationFn: () => retryForm(form.id), onSuccess: upsertForm })
  return (
    <li className="up-form">
      <span className="up-form-title">טופס {index + 1}</span>
      <span className="form-failed">
        <span className="chip chip-error">נכשל</span>
      </span>
      <span className="up-form-action">
        <button type="button" className="btn btn-sm btn-outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
          <RotateCcw size={15} aria-hidden="true" />
          לנסות שוב
        </button>
      </span>
    </li>
  )
}

const ACTIVE = new Set(['queued', 'splitting', 'processing'])
/** Forms that already have a result: these are the ones the user may want to keep. */
const READ = new Set(['pending_review', 'approved', 'rejected'])

/**
 * Asks before removing a file. Forms not read yet are simply dropped. Forms already read
 * go to the trash (restorable for 30 days); while the file is still being processed the
 * user may keep them instead.
 */
function RemoveDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const upload = row.upload!
  const readCount = row.forms.filter((f) => READ.has(f.status)).length
  const finished = upload.status === 'done'

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const remove = useMutation({
    mutationFn: (keepRead: boolean) => removeUpload(upload.id, keepRead),
    onSuccess: (_data, keepRead) => {
      const deleted = keepRead ? row.forms.filter((f) => !READ.has(f.status)) : row.forms
      dropUpload(upload.id, deleted.map((f) => f.id))
      if (row.local) removeItem(row.local.key)
      ref.current?.close()
    },
  })

  const readText =
    readCount === 1
      ? 'טופס אחד כבר נקרא. לשמור אותו לבדיקה, או להעביר הכול לסל המחזור?'
      : `${readCount} טפסים כבר נקראו. לשמור אותם לבדיקה, או להעביר הכול לסל המחזור?`
  const finishedText =
    readCount === 1
      ? 'הטופס שלו יעבור לסל המחזור. אפשר לשחזר אותו עד 30 יום.'
      : `${readCount} הטפסים שלו יעברו לסל המחזור. אפשר לשחזר אותם עד 30 יום.`

  return (
    <dialog ref={ref} className="dialog dialog-sm" aria-labelledby={titleId} onClose={onClose}>
      <header className="dialog-head">
        <h2 id={titleId}>להסיר את הקובץ?</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="סגירה">
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">
        {finished ? (
          <p>
            הקובץ <bdi>{row.name}</bdi> יוסר מהרשימה. {readCount > 0 && finishedText}
          </p>
        ) : (
          <p>
            העיבוד של <bdi>{row.name}</bdi> ייפסק והקובץ יוסר מהרשימה.
            {readCount > 0 && <> {readText}</>}
          </p>
        )}
        {remove.error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {remove.error.message}
          </p>
        )}
      </div>
      <footer className="dialog-foot">
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          ביטול
        </button>
        {readCount > 0 && !finished && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => remove.mutate(true)}
            disabled={remove.isPending}
          >
            להסיר ולשמור את מה שנקרא
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={() => remove.mutate(false)} disabled={remove.isPending}>
          {remove.isPending ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
          {finished ? 'מחיקה' : readCount > 0 ? 'למחוק הכול' : 'להסיר'}
        </button>
      </footer>
    </dialog>
  )
}

function PauseButton({ upload }: { upload: Upload }) {
  const toggle = useMutation({
    mutationFn: () => (upload.paused ? resumeUpload(upload.id) : pauseUpload(upload.id)),
    onSuccess: upsertUpload,
  })
  return (
    <button type="button" className="btn btn-sm btn-outline" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
      {upload.paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
      {upload.paused ? 'המשך' : 'עצור'}
    </button>
  )
}

export function UploadRow({ row, view }: { row: Row; view: RowView }) {
  const { local, upload, forms } = row
  const Icon = TONE_ICON[view.tone]
  const retry = useMutation({ mutationFn: () => retryUpload(upload!.id), onSuccess: upsertUpload })
  const [removing, setRemoving] = useState(false)
  const active = !!upload && ACTIVE.has(upload.status)

  const meta = [formatBytes(row.size)]
  if (upload?.page_count) meta.push(upload.page_count === 1 ? 'עמוד אחד' : `${upload.page_count} עמודים`)

  return (
    <li className={`up-row tone-${view.tone}`}>
      <Thumb row={row} />

      <div className="up-body">
        <div className="up-head">
          <span className="up-name" title={row.name}>
            {row.name}
          </span>
          {upload?.source === 'phone' && (
            <span className="chip chip-muted">
              <Smartphone size={13} aria-hidden="true" />
              מהטלפון
            </span>
          )}
        </div>

        <div className="up-status">
          <Icon size={16} className={view.tone === 'busy' ? 'spin' : undefined} aria-hidden="true" />
          <span>{view.status}</span>
          <span className="up-meta ltr-safe">· {meta.join(' · ')}</span>
        </div>

        {view.progress !== null && (
          <Bar value={view.progress} tone={view.tone} label={`התקדמות ${row.name}`} />
        )}

        {forms.some((f) => f.status === 'failed') && (
          <ul className="up-forms">
            {forms.map((f, i) => f.status === 'failed' && <FailedFormLine key={f.id} form={f} index={i} />)}
          </ul>
        )}
      </div>

      <div className="up-actions">
        {local && (local.phase === 'checking' || local.phase === 'waiting' || local.phase === 'uploading') && !upload && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => removeItem(local.key)}
            aria-label={`ביטול השליחה של ${row.name}`}
            title="ביטול"
          >
            <X size={18} />
          </button>
        )}
        {local?.phase === 'duplicate' && (
          <>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => sendAnyway(local.key)}>
              לשלוח בכל זאת
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => removeItem(local.key)}>
              להסיר
            </button>
          </>
        )}
        {local?.phase === 'error' && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => retryItem(local.key)}>
            <RotateCcw size={15} aria-hidden="true" />
            לנסות שוב
          </button>
        )}
        {(local?.phase === 'invalid' || local?.phase === 'error') && (
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => removeItem(local.key)}>
            להסיר
          </button>
        )}
        {upload?.status === 'failed' && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RotateCcw size={15} aria-hidden="true" />
            לנסות שוב
          </button>
        )}
        {active && upload && <PauseButton upload={upload} />}
        {upload && (active || upload.status === 'failed' || upload.status === 'done') && (
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setRemoving(true)}>
            <Trash2 size={15} aria-hidden="true" />
            הסר
          </button>
        )}
      </div>
      {removing && <RemoveDialog row={row} onClose={() => setRemoving(false)} />}
    </li>
  )
}
