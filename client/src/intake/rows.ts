// Turns local queue items and server uploads into the rows of the intake screen.
import type { FormSummary, Upload } from '../api/types'
import { formatDateTime } from '../lib/format'
import type { LocalItem } from './uploadQueue'

export interface Row {
  key: string
  name: string
  size: number
  previewUrl: string | null
  local: LocalItem | null
  upload: Upload | null
  forms: FormSummary[]
  sortTime: number
  sortOrder: number
}

export type Tone = 'busy' | 'waiting' | 'ok' | 'attention' | 'error'

export interface RowView {
  tone: Tone
  status: string
  /** 0–100, 'indeterminate', or null for no bar. */
  progress: number | 'indeterminate' | null
  etaAt: string | null
  finished: boolean
  needsAction: boolean
}

const FORM_DONE = new Set(['pending_review', 'approved', 'rejected', 'failed'])
const ACTIVE = new Set(['queued', 'splitting', 'processing'])

export const formPercent = (f: FormSummary) => (FORM_DONE.has(f.status) ? 100 : (f.progress?.percent ?? 0))

export function buildRows(local: LocalItem[], uploads: Upload[], forms: FormSummary[]): Row[] {
  const formsById = new Map(forms.map((f) => [f.id, f]))
  const uploadIds = new Set(uploads.map((u) => u.id))
  const localByUpload = new Map(local.filter((i) => i.uploadId).map((i) => [i.uploadId!, i]))

  const rows: Row[] = []
  for (const item of local) {
    // Once the server list has the upload, the server row takes over (keeping the preview).
    if (item.uploadId && uploadIds.has(item.uploadId)) continue
    rows.push({
      key: item.key,
      name: item.file.name,
      size: item.file.size,
      previewUrl: item.previewUrl,
      local: item,
      upload: null,
      forms: [],
      sortTime: item.batch,
      sortOrder: item.order,
    })
  }
  for (const upload of uploads) {
    const item = localByUpload.get(upload.id) ?? null
    rows.push({
      key: upload.id,
      name: upload.file_name,
      size: upload.file_size,
      previewUrl: item?.previewUrl ?? null,
      local: item,
      upload,
      forms: upload.form_ids.map((id) => formsById.get(id)).filter((f): f is FormSummary => !!f),
      sortTime: item?.batch ?? Date.parse(upload.received_at),
      sortOrder: item?.order ?? 0,
    })
  }
  // Newest batch first; files of one batch keep the order they were added in.
  return rows.sort((a, b) => b.sortTime - a.sortTime || a.sortOrder - b.sortOrder)
}

export function describe(row: Row): RowView {
  const { local, upload, forms } = row

  if (!upload) {
    const base = { etaAt: null, finished: false }
    switch (local?.phase) {
      case 'checking':
        return { ...base, tone: 'busy', status: 'מכין לשליחה…', progress: 'indeterminate', needsAction: false }
      case 'waiting':
        return { ...base, tone: 'waiting', status: 'ממתין לשליחה', progress: null, needsAction: false }
      case 'uploading': {
        const pct = Math.round((local.progress ?? 0) * 100)
        return { ...base, tone: 'busy', status: `שולח… ${pct}%`, progress: pct, needsAction: false }
      }
      case 'duplicate': {
        const d = local.duplicate
        let status = 'הקובץ הזה כבר נמצא ברשימה.'
        if (d?.kind === 'server') {
          const when = d.receivedAt ? ` ב-${formatDateTime(d.receivedAt)}` : ''
          const other = d.fileName !== local.file.name ? ` בשם "${d.fileName}"` : ''
          status = `הקובץ הזה כבר נקלט${when}${other}.`
        }
        return { ...base, tone: 'attention', status, progress: null, needsAction: true }
      }
      case 'invalid':
      case 'error':
        return { ...base, tone: 'error', status: local.message ?? 'השליחה נכשלה.', progress: null, needsAction: true }
      default:
        // Sent, but the upload list has not caught up yet.
        return { ...base, tone: 'busy', status: 'נשלח לעיבוד', progress: 'indeterminate', needsAction: false }
    }
  }

  const etaAt = upload.eta_at
  if (upload.paused && ACTIVE.has(upload.status)) {
    const count = upload.form_count ?? forms.length
    const ready = forms.filter((f) => FORM_DONE.has(f.status)).length
    const status = count ? `נעצר · ${ready} מתוך ${count} טפסים מוכנים` : 'נעצר'
    const progress = forms.length ? forms.reduce((s, f) => s + formPercent(f), 0) / forms.length : null
    return { tone: 'waiting', status, progress, etaAt: null, finished: false, needsAction: false }
  }
  switch (upload.status) {
    case 'queued': {
      const pos = upload.queue_position
      const where = !pos ? '' : pos === 1 ? ' · הבא בתור' : ` · מקום ${pos} בתור`
      return { tone: 'busy', status: `נשלח לעיבוד${where}`, progress: 'indeterminate', etaAt, finished: false, needsAction: false }
    }
    case 'splitting':
      return { tone: 'busy', status: 'מפצל לטפסים…', progress: 'indeterminate', etaAt, finished: false, needsAction: false }
    case 'processing': {
      const count = upload.form_count ?? forms.length
      const ready = forms.filter((f) => FORM_DONE.has(f.status)).length
      const status =
        count === 1
          ? `בעיבוד · ${forms[0]?.progress?.step ?? 'מחלץ שדות'}`
          : `בעיבוד · ${ready} מתוך ${count} טפסים מוכנים`
      const progress = forms.length ? forms.reduce((s, f) => s + formPercent(f), 0) / forms.length : 'indeterminate'
      return { tone: 'busy', status, progress, etaAt, finished: false, needsAction: false }
    }
    case 'done': {
      const count = upload.form_count ?? forms.length
      const failed = forms.filter((f) => f.status === 'failed').length
      const found = count === 1 ? 'נמצא טופס אחד' : `נמצאו ${count} טפסים`
      if (failed) {
        const failedText = failed === 1 ? 'אחד נכשל' : `${failed} נכשלו`
        return { tone: 'attention', status: `הסתיים · ${found}, ${failedText}`, progress: null, etaAt: null, finished: false, needsAction: true }
      }
      return { tone: 'ok', status: `הסתיים · ${found}`, progress: null, etaAt: null, finished: true, needsAction: false }
    }
    case 'failed':
      return { tone: 'error', status: upload.error ?? 'העיבוד נכשל.', progress: null, etaAt: null, finished: false, needsAction: true }
  }
}
