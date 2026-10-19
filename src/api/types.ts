// Mirrors docs/api-contract.md. Change both together.

export type FormStatus =
  | 'received'
  | 'processing'
  | 'pending_review'
  | 'approved'
  | 'failed'
  | 'rejected'

export type FormSource = 'upload' | 'phone' | 'demo'

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

export interface FormSummary {
  id: string
  file_name: string
  file_type: string
  file_sha256: string
  source: FormSource
  status: FormStatus
  received_at: string
  updated_at: string
  reviewed_at: string | null
  person_name: string | null
  id_number: string | null
  form_date: string | null
  page_count: number
  uncertain_count: number
  corrected_count: number
  progress: Progress | null
  error: string | null
  merged_into: string | null
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
  status: FormStatus
}

export interface ApiErrorBody {
  error: {
    code: string
    message?: string
    existing_id?: string
  }
}
