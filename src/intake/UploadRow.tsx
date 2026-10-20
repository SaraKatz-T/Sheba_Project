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
import { Link } from 'react-router'
import { retryForm, retryUpload } from '../api/endpoints'
import { upsertForm, upsertUpload } from '../api/queries'
import type { FormSummary } from '../api/types'
import { formatBytes } from '../lib/files'
import { formatEta, formatPages } from '../lib/format'
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
  if (row.previewUrl) return <img className="up-thumb" src={row.previewUrl} alt="" />
  const isPdf = /\.pdf$/i.test(row.name) || row.upload?.file_type === 'application/pdf'
  const Icon = isPdf ? FileText : FileImage
  return (
    <span className="up-thumb up-thumb-icon" aria-hidden="true">
      <Icon size={22} />
    </span>
  )
}

function FormState({ form }: { form: FormSummary }) {
  switch (form.status) {
    case 'received':
    case 'processing':
      return (
        <span className="form-progress">
          <Bar value={formPercent(form)} tone="busy" label={`התקדמות הטופס`} />
          <span className="muted">{form.progress?.step ?? 'בעיבוד'}</span>
        </span>
      )
    case 'pending_review':
      return form.uncertain_count > 0 ? (
        <span className="chip chip-flag">
          {form.uncertain_count === 1 ? 'שדה אחד לבדיקה' : `${form.uncertain_count} שדות לבדיקה`}
        </span>
      ) : (
        <span className="chip chip-ok">בלי שדות צהובים</span>
      )
    case 'approved':
      return <span className="chip chip-ok">אושר</span>
    case 'rejected':
      return <span className="chip chip-muted">נדחה</span>
    case 'failed':
      return (
        <span className="form-failed">
          <span className="chip chip-error">נכשל</span>
          <span className="muted">{form.error}</span>
        </span>
      )
  }
}

function FormLine({ form, index, compact }: { form: FormSummary; index: number; compact: boolean }) {
  const retry = useMutation({ mutationFn: () => retryForm(form.id), onSuccess: upsertForm })
  return (
    <li className={compact ? 'up-form up-form-compact' : 'up-form'}>
      {!compact && (
        <span className="up-form-title">
          טופס {index + 1}
          <span className="muted"> · {formatPages(form.upload_pages)}</span>
        </span>
      )}
      <span className="up-form-person">
        {form.commitment_number || form.person_name ? (
          <>
            {form.commitment_number && <strong className="ltr num">{form.commitment_number}</strong>}
            {form.person_name && <span className="muted">{form.person_name}</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <FormState form={form} />
      <span className="up-form-action">
        {form.status === 'pending_review' && (
          <Link className="btn btn-sm btn-soft" to={`/review?form=${encodeURIComponent(form.id)}`}>
            לבדיקה
          </Link>
        )}
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

        {/* A single form still being read is already described by the row's own status. */}
        {(forms.length > 1 || (forms.length === 1 && !IN_FLIGHT.has(forms[0].status))) && (
          <ul className={forms.length > 1 ? 'up-forms' : 'up-forms up-forms-single'}>
            {forms.map((f, i) => (
              <FormLine key={f.id} form={f} index={i} compact={forms.length === 1} />
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
