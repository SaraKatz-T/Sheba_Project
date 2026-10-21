import { useMutation } from '@tanstack/react-query'
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FileImage,
  FileText,
  LoaderCircle,
  RotateCcw,
  Smartphone,
  TriangleAlert,
  X,
} from 'lucide-react'
import { retryForm, retryUpload } from '../api/endpoints'
import { upsertForm, upsertUpload } from '../api/queries'
import type { FormSummary } from '../api/types'
import { formatBytes } from '../lib/files'
import { formatEta } from '../lib/format'
import { useAuthedImage } from '../lib/useAuthedImage'
import { formPercent, type Row, type RowView, type Tone } from './rows'
import { removeItem, retryItem, sendAnyway } from './uploadQueue'

const IN_FLIGHT = new Set(['received', 'processing'])

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
 * While reading, each form shows only its number and a progress bar. Its details
 * (numbers, names, fields to check) are shown in the records page once it's done.
 */
function FormLine({ form, index }: { form: FormSummary; index: number }) {
  const retry = useMutation({ mutationFn: () => retryForm(form.id), onSuccess: upsertForm })
  const done = !IN_FLIGHT.has(form.status) && form.status !== 'failed'
  return (
    <li className="up-form">
      <span className="up-form-title">טופס {index + 1}</span>
      {form.status === 'failed' ? (
        <span className="form-failed">
          <span className="chip chip-error">נכשל</span>
        </span>
      ) : (
        <Bar value={done ? 100 : formPercent(form)} tone={done ? 'ok' : 'busy'} label={`התקדמות טופס ${index + 1}`} />
      )}
      <span className="up-form-action">
        {form.status === 'failed' && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RotateCcw size={15} aria-hidden="true" />
            לנסות שוב
          </button>
        )}
      </span>
    </li>
  )
}

export function UploadRow({ row, view, now }: { row: Row; view: RowView; now: number }) {
  const { local, upload, forms } = row
  const Icon = TONE_ICON[view.tone]
  const retry = useMutation({ mutationFn: () => retryUpload(upload!.id), onSuccess: upsertUpload })

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
          {view.etaAt && <span className="up-eta">{formatEta(view.etaAt, now)}</span>}
        </div>

        <div className="up-status">
          <Icon size={16} className={view.tone === 'busy' ? 'spin' : undefined} aria-hidden="true" />
          <span>{view.status}</span>
          <span className="up-meta ltr-safe">· {meta.join(' · ')}</span>
        </div>

        {view.progress !== null && (
          <Bar value={view.progress} tone={view.tone} label={`התקדמות ${row.name}`} />
        )}

        {/* A single form is already described by the row's own status, unless it failed. */}
        {(forms.length > 1 || (forms.length === 1 && forms[0].status === 'failed')) && (
          <ul className={forms.length > 1 ? 'up-forms' : 'up-forms up-forms-single'}>
            {forms.map((f, i) => (
              <FormLine key={f.id} form={f} index={i} />
            ))}
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
      </div>
    </li>
  )
}
