// In-memory stand-in for the Python server: database, queue, workers and live events.
// Resets on page reload.
import type {
  DuplicateDismissal,
  Field,
  FieldValueSource,
  FormDetail,
  FormSource,
  FormStatus,
  FormSummary,
  LiveEvent,
  Upload,
} from '../api/types'
import {
  PAGE_H,
  PAGE_W,
  buildFields,
  fakePerson,
  isoFromIsraeliDate,
  israeliDate,
  mulberry32,
  randomFlags,
  type Rng,
} from './fakeData'
import { renderContinuationSvg, renderFormSvg, renderScanSvg } from './formImage'

interface StoredUpload extends Upload {
  /** Kept only for browser-displayable images, to serve back as the form page. */
  blob: Blob | null
  seed: number
}

interface StoredForm extends FormDetail {
  seed: number
}

const uploads = new Map<string, StoredUpload>()
const forms = new Map<string, StoredForm>()
let nextUploadId = 1
let nextFormId = 1

const newUploadId = () => `u_${(nextUploadId++).toString(36).padStart(4, '0')}`
const newFormId = () => `f_${(nextFormId++).toString(36).padStart(4, '0')}`
const nowIso = () => new Date().toISOString()

// Live events

const listeners = new Set<(event: LiveEvent) => void>()

export function subscribe(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitUpload(upload: StoredUpload) {
  upload.updated_at = nowIso()
  const event: LiveEvent = { type: 'upload.updated', upload: uploadView(upload) }
  listeners.forEach((l) => l(event))
}

function emitForm(form: StoredForm) {
  form.updated_at = nowIso()
  const event: LiveEvent = { type: 'form.updated', form: summary(form) }
  listeners.forEach((l) => l(event))
}

// Duplicate groups the user chose to keep.

const dismissals: DuplicateDismissal[] = []

export const listDismissals = () => dismissals.map((d) => ({ ...d, form_ids: [...d.form_ids] }))

/** Stores the group (ids sorted, no repeats) once; returns null if an id is unknown. */
export function addDismissal(formIds: string[]): DuplicateDismissal | null {
  const ids = [...new Set(formIds)].sort()
  if (ids.length < 2 || ids.some((id) => !forms.has(id))) return null
  const existing = dismissals.find((d) => d.form_ids.join('+') === ids.join('+'))
  if (existing) return existing
  const dismissal = { form_ids: ids, dismissed_at: nowIso() }
  dismissals.push(dismissal)
  const event: LiveEvent = { type: 'duplicate_dismissal.created', dismissal }
  listeners.forEach((l) => l(event))
  return dismissal
}

// Views

export function uploadView(upload: StoredUpload): Upload {
  const { blob: _b, seed: _s, ...rest } = upload
  return { ...rest, form_ids: [...rest.form_ids] }
}

export function summary(form: StoredForm): FormSummary {
  const { pages: _p, fields: _f, seed: _s, ...rest } = form
  return { ...rest, upload_pages: [...rest.upload_pages], progress: rest.progress && { ...rest.progress } }
}

export function detail(form: StoredForm): FormDetail {
  const { seed: _s, ...rest } = form
  return structuredClone(rest)
}

const DAY_MS = 86_400_000

export const listUploads = () =>
  [...uploads.values()]
    .filter((u) => Date.now() - Date.parse(u.received_at) < DAY_MS)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))

export const getUpload = (id: string) => uploads.get(id)

export const listForms = () =>
  [...forms.values()].sort((a, b) => b.received_at.localeCompare(a.received_at))

export const getForm = (id: string) => forms.get(id)

export const findUploadBySha = (sha: string) =>
  [...uploads.values()].find((u) => u.file_sha256 === sha)

const thumbnailUrl = (id: string) => `/api/uploads/${id}/thumbnail`

/** The first page as the user sent it: the photo itself, the first form, or a blank scan. */
export function thumbnail(upload: StoredUpload): Blob {
  if (upload.blob) return upload.blob
  const first = upload.form_ids.length ? forms.get(upload.form_ids[0]) : undefined
  const svg = first?.fields.length ? renderFormSvg(first.fields, first.seed) : renderScanSvg()
  return new Blob([svg], { type: 'image/svg+xml' })
}

export function pageImage(form: StoredForm, page: number): Blob | null {
  if (page < 1 || page > form.page_count) return null
  const upload = uploads.get(form.upload_id)
  if (upload?.blob) return upload.blob
  const svg = page === 1 ? renderFormSvg(form.fields, form.seed) : renderContinuationSvg(page)
  return new Blob([svg], { type: 'image/svg+xml' })
}

function recount(form: StoredForm) {
  form.uncertain_count = form.fields.filter((f) => f.uncertain).length
  form.uncertain_keys = form.fields.filter((f) => f.uncertain).map((f) => f.key)
  form.corrected_count = form.fields.filter((f) => f.corrected).length
  const get = (key: string) => form.fields.find((f) => f.key === key)?.value || null
  form.commitment_number = get('commitment_number')
  form.person_name = get('full_name')
  form.id_number = get('id_number')
  const date = get('form_date')
  form.form_date = date ? isoFromIsraeliDate(date) : null
}

function setPages(form: StoredForm, count: number, width = PAGE_W, height = PAGE_H) {
  form.page_count = count
  form.pages = Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    width,
    height,
    image_url: `/api/forms/${form.id}/pages/${i + 1}/image`,
  }))
}

// Queue and workers. Timings are compressed so a demo shows every stage.

const SPLIT_MS = 1200
const FORM_STEPS: Array<[delayMs: number, status: FormStatus, percent: number, step: string]> = [
  [0, 'received', 5, 'ממתין לעובד'],
  [500, 'processing', 20, 'שיפור תמונה'],
  [1400, 'processing', 45, 'קריאה ראשונה (Gemini)'],
  [2600, 'processing', 75, 'אימות שני (Qwen)'],
  [3400, 'processing', 90, 'בדיקת ספרת ביקורת'],
]
const FORM_MS = 4100
const FORM_WORKERS = 3

const uploadQueue: string[] = []
const formQueue: string[] = []
let splitting = false
let activeFormJobs = 0

const FAIL_NAME = /fail|נכשל/i
const PARTIAL_NAME = /partial|חלקי/i
/** Uploads and forms that were retried; their simulated failure does not repeat. */
const healed = new Set<string>()

function etaFor(upload: StoredUpload): string | null {
  const pendingForms = formQueue.length + activeFormJobs
  if (upload.status === 'queued') {
    const ahead = upload.queue_position ?? 1
    const estForms = Math.max(1, Math.ceil((upload.page_count ?? 2) / 2))
    const ms = ahead * SPLIT_MS + ((pendingForms + estForms) / FORM_WORKERS) * FORM_MS
    return new Date(Date.now() + ms).toISOString()
  }
  if (upload.status === 'splitting' || upload.status === 'processing') {
    const remaining = upload.form_ids.filter((id) => {
      const s = forms.get(id)?.status
      return s === 'received' || s === 'processing'
    }).length
    const before = upload.status === 'splitting' ? SPLIT_MS : 0
    const ms = before + Math.ceil((pendingForms || remaining || 1) / FORM_WORKERS) * FORM_MS
    return new Date(Date.now() + ms).toISOString()
  }
  return null
}

function refreshQueuePositions() {
  uploadQueue.forEach((id, i) => {
    const u = uploads.get(id)
    if (!u) return
    u.queue_position = i + 1
    u.eta_at = etaFor(u)
    emitUpload(u)
  })
}

function pumpUploads() {
  if (splitting) return
  const id = uploadQueue.shift()
  if (!id) return
  const upload = uploads.get(id)
  if (!upload) return pumpUploads()
  splitting = true
  upload.status = 'splitting'
  upload.queue_position = null
  upload.eta_at = etaFor(upload)
  emitUpload(upload)
  refreshQueuePositions()

  setTimeout(() => {
    splitting = false
    if (FAIL_NAME.test(upload.file_name) && !healed.has(upload.id)) {
      upload.status = 'failed'
      upload.eta_at = null
      upload.error = 'לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום או מוצפן. כדאי לסרוק אותו שוב.'
      emitUpload(upload)
    } else {
      splitIntoForms(upload)
    }
    pumpUploads()
  }, SPLIT_MS)
}

function splitIntoForms(upload: StoredUpload) {
  const rng = mulberry32(upload.seed)
  const isImage = upload.file_type.startsWith('image/') && upload.file_type !== 'image/tiff'
  const pages = upload.page_count ?? 1
  const formCount = isImage ? 1 : Math.min(pages, 1 + Math.floor(rng() * 4))

  // Contiguous page ranges, as a scanner batch would produce.
  const cuts = new Set<number>()
  while (cuts.size < formCount - 1) cuts.add(1 + Math.floor(rng() * (pages - 1)))
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), pages]

  upload.form_ids = []
  for (let i = 0; i < formCount; i++) {
    const pageNumbers = Array.from({ length: bounds[i + 1] - bounds[i] }, (_, k) => bounds[i] + k + 1)
    const form = newForm(upload, pageNumbers, Math.floor(rng() * 2 ** 31))
    upload.form_ids.push(form.id)
    emitForm(form)
    formQueue.push(form.id)
  }
  upload.form_count = formCount
  upload.status = 'processing'
  upload.eta_at = etaFor(upload)
  emitUpload(upload)
  pumpForms()
}

function newForm(upload: StoredUpload, pageNumbers: number[], seed: number): StoredForm {
  const form: StoredForm = {
    id: newFormId(),
    upload_id: upload.id,
    upload_pages: pageNumbers,
    file_name: upload.file_name,
    source: upload.source,
    status: 'received',
    received_at: upload.received_at,
    updated_at: nowIso(),
    reviewed_at: null,
    commitment_number: null,
    person_name: null,
    id_number: null,
    form_date: null,
    page_count: pageNumbers.length,
    uncertain_count: 0,
    uncertain_keys: [],
    corrected_count: 0,
    progress: { percent: 0, step: 'ממתין בתור' },
    error: null,
    merged_into: null,
    pages: [],
    fields: [],
    seed,
  }
  setPages(form, pageNumbers.length)
  forms.set(form.id, form)
  return form
}

function pumpForms() {
  while (activeFormJobs < FORM_WORKERS && formQueue.length > 0) {
    const form = forms.get(formQueue.shift()!)
    if (form) runForm(form)
  }
}

function runForm(form: StoredForm) {
  activeFormJobs++
  form.error = null
  for (const [ms, status, percent, step] of FORM_STEPS) {
    setTimeout(() => {
      form.status = status
      form.progress = { percent, step }
      emitForm(form)
    }, ms)
  }

  setTimeout(() => {
    activeFormJobs--
    form.progress = null
    const upload = uploads.get(form.upload_id)
    const rng = mulberry32(form.seed)
    // "partial" in the file name fails its last form, to show a per-form failure.
    const isLast = upload?.form_ids.at(-1) === form.id
    if (upload && PARTIAL_NAME.test(upload.file_name) && isLast && !healed.has(form.id)) {
      form.status = 'failed'
      form.error = 'העמוד חתוך או מטושטש מדי לקריאה.'
    } else {
      const person = fakePerson(rng)
      const flags = randomFlags(rng, Math.floor(rng() * 4))
      form.fields = buildFields(rng, person, israeliDate(new Date()), flags, !upload?.blob)
      recount(form)
      form.status = 'pending_review'
    }
    emitForm(form)
    if (upload) settleUpload(upload)
    pumpForms()
  }, FORM_MS)
}

function settleUpload(upload: StoredUpload) {
  const states = upload.form_ids.map((id) => forms.get(id)?.status)
  const busy = states.some((s) => s === 'received' || s === 'processing')
  upload.status = busy ? 'processing' : 'done'
  upload.eta_at = busy ? etaFor(upload) : null
  emitUpload(upload)
}

const DISPLAYABLE = /^image\/(jpeg|png|webp|gif)$/
const MULTI_PAGE = /^(application\/pdf|image\/tiff)$/

export async function createUpload(file: File, sha256: string, source: FormSource): Promise<StoredUpload> {
  const ts = nowIso()
  const seed = Math.floor(Math.random() * 2 ** 31)
  const id = newUploadId()
  const upload: StoredUpload = {
    id,
    file_name: file.name,
    file_type: file.type || 'application/octet-stream',
    file_size: file.size,
    file_sha256: sha256,
    source,
    status: 'queued',
    received_at: ts,
    updated_at: ts,
    page_count: MULTI_PAGE.test(file.type) ? 1 + (seed % 9) : 1,
    form_count: null,
    form_ids: [],
    queue_position: null,
    eta_at: null,
    thumbnail_url: thumbnailUrl(id),
    error: null,
    blob: DISPLAYABLE.test(file.type) ? file : null,
    seed,
  }
  if (upload.blob) {
    try {
      const bmp = await createImageBitmap(upload.blob)
      bmp.close()
    } catch {
      upload.blob = null
    }
  }
  uploads.set(upload.id, upload)
  uploadQueue.push(upload.id)
  refreshQueuePositions()
  pumpUploads()
  return upload
}

export function retryUpload(upload: StoredUpload) {
  healed.add(upload.id)
  upload.status = 'queued'
  upload.error = null
  uploadQueue.push(upload.id)
  refreshQueuePositions()
  pumpUploads()
}

export function retryForm(form: StoredForm) {
  healed.add(form.id)
  form.status = 'received'
  form.fields = []
  form.progress = { percent: 0, step: 'ממתין בתור' }
  emitForm(form)
  const upload = uploads.get(form.upload_id)
  if (upload) {
    upload.status = 'processing'
    emitUpload(upload)
  }
  formQueue.push(form.id)
  pumpForms()
}

// Review actions

export function updateField(form: StoredForm, key: string, value: string, source: FieldValueSource): Field | null {
  const field = form.fields.find((f) => f.key === key)
  if (!field) return null
  if (source !== 'confirmed' && value !== field.value && field.original_value === null) {
    field.original_value = field.value
  }
  if (source !== 'confirmed') field.value = value
  field.uncertain = false
  field.corrected = field.original_value !== null && field.value !== field.original_value
  recount(form)
  emitForm(form)
  return structuredClone(field)
}

export function setReviewed(form: StoredForm, status: 'approved' | 'rejected') {
  if (status === 'approved') {
    for (const f of form.fields) f.uncertain = false
    recount(form)
  }
  form.status = status
  form.reviewed_at = nowIso()
  emitForm(form)
}

export function merge(source: StoredForm, target: StoredForm, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) updateField(target, key, value, 'manual')
  source.merged_into = target.id
  setReviewed(source, 'rejected')
}

// Seed: finished history so the records, metrics and calendar screens have data.

interface SeedSpec {
  daysAgo: number
  hour: number
  status: FormStatus
  uncertain?: number
  corrected?: number
  reviewMinutes?: number
  source?: FormSource
  /** Different form, same patient ID: a likely misread ID. */
  sameIdAs?: number
  /** The same paper form captured again (same commitment number, same patient). */
  sameFormAs?: number
  /** Seeds with the same batch share one multi-form PDF upload. */
  batch?: string
  file?: string
}

const SEEDS: SeedSpec[] = [
  { daysAgo: 0, hour: 10, status: 'pending_review', uncertain: 1, source: 'phone', sameFormAs: 5 },
  { daysAgo: 0, hour: 9, status: 'pending_review', uncertain: 3 },
  { daysAgo: 0, hour: 9, status: 'pending_review', uncertain: 0, source: 'phone' },
  { daysAgo: 0, hour: 8, status: 'pending_review', uncertain: 1, sameIdAs: 7, batch: 'סריקת_בוקר.pdf' },
  { daysAgo: 0, hour: 8, status: 'approved', reviewMinutes: 6, batch: 'סריקת_בוקר.pdf' },
  { daysAgo: 1, hour: 14, status: 'pending_review', uncertain: 2 },
  { daysAgo: 1, hour: 12, status: 'failed', file: 'סריקה_מטושטשת.pdf' },
  { daysAgo: 1, hour: 11, status: 'approved', corrected: 1, reviewMinutes: 14 },
  { daysAgo: 2, hour: 10, status: 'approved', reviewMinutes: 4 },
  { daysAgo: 2, hour: 9, status: 'rejected', reviewMinutes: 9 },
  { daysAgo: 4, hour: 15, status: 'approved', corrected: 2, reviewMinutes: 22 },
  { daysAgo: 4, hour: 13, status: 'approved', reviewMinutes: 5 },
  { daysAgo: 5, hour: 10, status: 'pending_review', uncertain: 0 },
  { daysAgo: 7, hour: 11, status: 'approved', reviewMinutes: 7 },
  { daysAgo: 8, hour: 9, status: 'approved', corrected: 1, reviewMinutes: 18 },
]

function fakeSha(rng: Rng) {
  return Array.from({ length: 64 }, () => Math.floor(rng() * 16).toString(16)).join('')
}

function seed() {
  const rng = mulberry32(20261028)
  const now = Date.now()
  const people = SEEDS.map(() => fakePerson(rng))
  const batches = new Map<string, StoredUpload>()

  SEEDS.forEach((spec, i) => {
    let upload = spec.batch ? batches.get(spec.batch) : undefined
    if (!upload) {
      const received = new Date(now - spec.daysAgo * DAY_MS)
      received.setHours(spec.hour, Math.floor(rng() * 60), 0, 0)
      if (received.getTime() > now) received.setTime(now - (i + 1) * 7 * 60_000)
      const phone = spec.source === 'phone'
      const id = newUploadId()
      upload = {
        id,
        file_name: spec.batch ?? spec.file ?? `טופס_${1040 + i}.${phone ? 'jpg' : 'pdf'}`,
        file_type: phone ? 'image/jpeg' : 'application/pdf',
        file_size: 180_000 + Math.floor(rng() * 900_000),
        file_sha256: fakeSha(rng),
        source: spec.source ?? 'upload',
        status: 'done',
        received_at: received.toISOString(),
        updated_at: received.toISOString(),
        page_count: 0,
        form_count: 0,
        form_ids: [],
        queue_position: null,
        eta_at: null,
        thumbnail_url: thumbnailUrl(id),
        error: null,
        blob: null,
        seed: Math.floor(rng() * 2 ** 31),
      }
      uploads.set(upload.id, upload)
      if (spec.batch) batches.set(spec.batch, upload)
    }

    const firstPage = (upload.page_count ?? 0) + 1
    const form = newForm(upload, [firstPage], Math.floor(rng() * 2 ** 31))
    upload.page_count = firstPage
    upload.form_ids.push(form.id)
    upload.form_count = upload.form_ids.length

    const person =
      spec.sameFormAs !== undefined
        ? people[spec.sameFormAs]
        : spec.sameIdAs !== undefined
          ? { ...people[i], id: people[spec.sameIdAs].id }
          : people[i]
    const flags = spec.uncertain
      ? randomFlags(rng, spec.uncertain)
      : Object.fromEntries(
          ['full_name', 'phone', 'commitment_number']
            .slice(0, spec.corrected ?? 0)
            .map((key) => [key, 'models_disagree' as const]),
        )

    form.status = spec.status
    form.progress = null
    form.updated_at = upload.received_at
    form.reviewed_at = spec.reviewMinutes
      ? new Date(Date.parse(upload.received_at) + spec.reviewMinutes * 60_000).toISOString()
      : null
    if (spec.status === 'failed') {
      form.error = 'העמוד חתוך או מטושטש מדי לקריאה.'
    } else {
      // A form captured twice carries the date written on the original paper.
      const written =
        spec.sameFormAs !== undefined
          ? new Date(now - SEEDS[spec.sameFormAs].daysAgo * DAY_MS)
          : new Date(upload.received_at)
      form.fields = buildFields(rng, person, israeliDate(written), flags, true)
    }

    // Approved/rejected seeds: resolve their flags, keeping a correction where requested.
    if (spec.status === 'approved' || spec.status === 'rejected') {
      for (const f of form.fields) {
        if (!f.uncertain) continue
        if (spec.corrected && f.readings?.qwen) {
          f.original_value = f.value
          f.value = f.readings.qwen
          f.corrected = true
        }
        f.uncertain = false
      }
    }
    recount(form)
  })
}

seed()
