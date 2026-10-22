// Mirrors docs/api-contract.md. Change both together.

export type FormStatus =
  | 'received'
  | 'processing'
  | 'pending_review'
  | 'approved'
  | 'failed'
  | 'rejected'

export type FormSource = 'upload' | 'phone' | 'demo'

export type UploadStatus = 'queued' | 'splitting' | 'processing' | 'done' | 'failed'

export type FieldType =
  | 'text'
  | 'id_number'
  | 'date'
  | 'phone'
  | 'number'
  | 'checkbox'
  | 'signature'

export type ReasonCode =
  | 'models_disagree'
  | 'checksum_failed'
  | 'illegible'
  | 'missing'
  | 'low_confidence'
  | 'other'

export type FieldValueSource = 'manual' | 'gemini' | 'qwen' | 'confirmed'

export interface Progress {
  percent: number
  step: string
}

/** A file as sent by the client; the server splits it into one or more forms. */
export interface Upload {
  id: string
  file_name: string
  file_type: string
  file_size: number
  file_sha256: string
  source: FormSource
  status: UploadStatus
  /** The user stopped processing ("עצור"); status keeps its value until "המשך". */
  paused: boolean
  received_at: string
  updated_at: string
  page_count: number | null
  form_count: number | null
  form_ids: string[]
  /** Only while queued; 1 = next in line. */
  queue_position: number | null
  /** Estimated completion of the whole file. */
  eta_at: string | null
  /** Small image of the first page; null until the server has made it. */
  thumbnail_url: string | null
  error: string | null
}

export interface UploadList {
  items: Upload[]
}

export interface FormSummary {
  id: string
  upload_id: string
  /** Pages of the original file that belong to this form, starting at 1. */
  upload_pages: number[]
  file_name: string
  source: FormSource
  status: FormStatus
  received_at: string
  updated_at: string
  reviewed_at: string | null
  /** The form's own identifier, shown first everywhere. */
  commitment_number: string | null
  person_name: string | null
  /** Every field is shown in the table, also on a closed row. Optional: older servers don't send them. */
  first_name?: string | null
  last_name?: string | null
  id_number: string | null
  central_number?: string | null
  sender?: string | null
  form_date: string | null
  page_count: number
  uncertain_count: number
  /** Keys of the fields still open for review, to mark their cells in the table. */
  uncertain_keys: string[]
  corrected_count: number
  progress: Progress | null
  error: string | null
  merged_into: string | null
  /** In the trash since then; null when not deleted. Deleted for good 30 days later. */
  deleted_at?: string | null
}

/** Fractions (0–1) of the page size; x/y is the top-left corner. Pages start at 1. */
export interface Box {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface Field {
  key: string
  label: string
  type: FieldType
  value: string
  confidence: number | null
  uncertain: boolean
  reason_code: ReasonCode | null
  reason: string | null
  readings: Record<string, string | null> | null
  box: Box | null
  corrected: boolean
  original_value: string | null
}

export interface Page {
  number: number
  width: number
  height: number
  image_url: string
}

export interface FormDetail extends FormSummary {
  pages: Page[]
  fields: Field[]
}

export interface FormList {
  items: FormSummary[]
}

export interface Session {
  authenticated: boolean
}

export interface CaptureSession {
  token: string
  expires_at: string
}

export interface CaptureUploadResult {
  id: string
  status: UploadStatus
}

/** Where the server sent the exported .xlsx (for now an email address; later the lab's API). */
export interface ExportResult {
  sent_to: string
  form_count: number
}

/** "These forms are fine as they are": a duplicate group the user chose to keep. */
export interface DuplicateDismissal {
  form_ids: string[]
  dismissed_at: string
}

/** Messages pushed by the server on the /api/live WebSocket. */
export type LiveEvent =
  | { type: 'upload.updated'; upload: Upload }
  | { type: 'form.updated'; form: FormSummary }
  | { type: 'duplicate_dismissal.created'; dismissal: DuplicateDismissal }
  /** The upload left the intake queue; form_ids are the forms that were deleted with it. */
  | { type: 'upload.removed'; upload_id: string; form_ids: string[] }
  /** The forms moved to the trash. */
  | { type: 'form.deleted'; form_ids: string[] }

export interface ExistingUpload {
  id: string
  file_name: string
  received_at: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message?: string
    existing_upload?: ExistingUpload
  }
}
