// In-memory stand-in for the Python server's database. Resets on page reload.
import type { Field, FieldValueSource, FormDetail, FormSource, FormStatus, FormSummary } from '../api/types'
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
import { renderFormSvg } from './formImage'

interface StoredForm extends FormDetail {
  /** Uploaded browser-displayable image, served back as page 1. */
  imageBlob: Blob | null
  seed: number
}

const forms = new Map<string, StoredForm>()
let nextId = 1

const newId = () => `f_${(nextId++).toString(36).padStart(4, '0')}`
const nowIso = () => new Date().toISOString()

function recount(form: StoredForm) {
  form.uncertain_count = form.fields.filter((f) => f.uncertain).length
  form.corrected_count = form.fields.filter((f) => f.corrected).length
  const get = (key: string) => form.fields.find((f) => f.key === key)?.value || null
  form.person_name = get('full_name')
  form.id_number = get('id_number')
  const date = get('form_date')
  form.form_date = date ? isoFromIsraeliDate(date) : null
}

function pages(form: StoredForm, width = PAGE_W, height = PAGE_H) {
  form.pages = [{ number: 1, width, height, image_url: `/api/forms/${form.id}/pages/1/image` }]
  form.page_count = 1
}

export function summary(form: StoredForm): FormSummary {
  const { pages: _p, fields: _f, imageBlob: _b, seed: _s, ...rest } = form
  return rest
}

export function detail(form: StoredForm): FormDetail {
  const { imageBlob: _b, seed: _s, ...rest } = form
  return structuredClone(rest)
}

export const listForms = () =>
  [...forms.values()].sort((a, b) => b.received_at.localeCompare(a.received_at))

export const getForm = (id: string) => forms.get(id)

export const findBySha = (sha: string) =>
  [...forms.values()].find((f) => f.file_sha256 === sha && f.status !== 'rejected')

export function pageImage(form: StoredForm): Blob {
  if (form.imageBlob) return form.imageBlob
  return new Blob([renderFormSvg(form.fields, form.seed)], { type: 'image/svg+xml' })
}

// Extraction simulation

const STEPS: Array<[delayMs: number, status: FormStatus, percent: number, step: string]> = [
  [700, 'processing', 20, 'שיפור תמונה'],
  [1600, 'processing', 45, 'קריאה ראשונה (Gemini)'],
  [2800, 'processing', 75, 'אימות שני (Qwen)'],
  [3600, 'processing', 90, 'בדיקת ספרת ביקורת'],
]
const DONE_MS = 4300

function simulateExtraction(form: StoredForm) {
  form.status = 'received'
  form.progress = { percent: 5, step: 'הקובץ התקבל' }
  form.error = null

  for (const [ms, status, percent, step] of STEPS) {
    setTimeout(() => {
      form.status = status
      form.progress = { percent, step }
      form.updated_at = nowIso()
    }, ms)
  }

  setTimeout(() => {
    form.progress = null
    form.updated_at = nowIso()
    // Lets the failure path be tested on purpose: name a file "fail…" or "נכשל…".
    if (/fail|נכשל/i.test(form.file_name)) {
      form.status = 'failed'
      form.error = 'לא הצלחנו לקרוא את הקובץ. כדאי לסרוק אותו שוב באיכות גבוהה יותר.'
      return
    }
    const rng = mulberry32(form.seed)
    const person = fakePerson(rng)
    const flags = randomFlags(rng, Math.floor(rng() * 4))
    form.fields = buildFields(rng, person, israeliDate(new Date()), flags, !form.imageBlob)
    recount(form)
    form.status = 'pending_review'
  }, DONE_MS)
}

const DISPLAYABLE = /^image\/(jpeg|png|webp|gif)$/

export async function createForm(file: File, sha256: string, source: FormSource): Promise<StoredForm> {
  const ts = nowIso()
  const form: StoredForm = {
    id: newId(),
    file_name: file.name,
    file_type: file.type || 'application/octet-stream',
    file_sha256: sha256,
    source,
    status: 'received',
    received_at: ts,
    updated_at: ts,
    reviewed_at: null,
    person_name: null,
    id_number: null,
    form_date: null,
    page_count: 1,
    uncertain_count: 0,
    corrected_count: 0,
    progress: null,
    error: null,
    merged_into: null,
    pages: [],
    fields: [],
    imageBlob: DISPLAYABLE.test(file.type) ? file : null,
    seed: Math.floor(Math.random() * 2 ** 31),
  }

  if (form.imageBlob) {
    try {
      const bmp = await createImageBitmap(form.imageBlob)
      pages(form, bmp.width, bmp.height)
      bmp.close()
    } catch {
      form.imageBlob = null
      pages(form)
    }
  } else {
    pages(form)
  }

  forms.set(form.id, form)
  simulateExtraction(form)
  return form
}

export function retry(form: StoredForm) {
  form.updated_at = nowIso()
  form.file_name = form.file_name.replace(/fail|נכשל/gi, '')
  simulateExtraction(form)
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
  form.updated_at = nowIso()
  recount(form)
  return structuredClone(field)
}

export function setReviewed(form: StoredForm, status: 'approved' | 'rejected') {
  if (status === 'approved') {
    for (const f of form.fields) f.uncertain = false
    recount(form)
  }
  form.status = status
  form.reviewed_at = nowIso()
  form.updated_at = form.reviewed_at
}

export function merge(source: StoredForm, target: StoredForm, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) updateField(target, key, value, 'manual')
  source.merged_into = target.id
  setReviewed(source, 'rejected')
}

// Seed

interface SeedSpec {
  daysAgo: number
  hour: number
  status: FormStatus
  uncertain?: number
  corrected?: number
  reviewMinutes?: number
  source?: FormSource
  sameIdAs?: number
  file?: string
}

const SEEDS: SeedSpec[] = [
  { daysAgo: 0, hour: 9, status: 'pending_review', uncertain: 3 },
  { daysAgo: 0, hour: 9, status: 'pending_review', uncertain: 0, source: 'phone' },
  { daysAgo: 0, hour: 8, status: 'pending_review', uncertain: 1, sameIdAs: 6 },
  { daysAgo: 0, hour: 8, status: 'approved', reviewMinutes: 6 },
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

  SEEDS.forEach((spec, i) => {
    const received = new Date(now - spec.daysAgo * 86_400_000)
    received.setHours(spec.hour, Math.floor(rng() * 60), 0, 0)
    if (received.getTime() > now) received.setTime(now - (i + 1) * 7 * 60_000)

    const person = spec.sameIdAs !== undefined ? { ...people[i], id: people[spec.sameIdAs].id } : people[i]
    const flags = spec.uncertain
      ? randomFlags(rng, spec.uncertain)
      : Object.fromEntries(
          ['full_name', 'phone', 'commitment_number']
            .slice(0, spec.corrected ?? 0)
            .map((key) => [key, 'models_disagree' as const]),
        )
    const failed = spec.status === 'failed'

    const form: StoredForm = {
      id: newId(),
      file_name: spec.file ?? `טופס_${String(1040 + i)}.${spec.source === 'phone' ? 'jpg' : 'pdf'}`,
      file_type: spec.source === 'phone' ? 'image/jpeg' : 'application/pdf',
      file_sha256: fakeSha(rng),
      source: spec.source ?? 'upload',
      status: spec.status,
      received_at: received.toISOString(),
      updated_at: received.toISOString(),
      reviewed_at: spec.reviewMinutes
        ? new Date(received.getTime() + spec.reviewMinutes * 60_000).toISOString()
        : null,
      person_name: null,
      id_number: null,
      form_date: null,
      page_count: 1,
      uncertain_count: 0,
      corrected_count: 0,
      progress: null,
      error: failed ? 'לא הצלחנו לקרוא את הקובץ. כדאי לסרוק אותו שוב באיכות גבוהה יותר.' : null,
      merged_into: null,
      pages: [],
      fields: failed ? [] : buildFields(rng, person, israeliDate(received), flags, true),
      imageBlob: null,
      seed: Math.floor(rng() * 2 ** 31),
    }
    pages(form)

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
    forms.set(form.id, form)
  })
}

seed()
