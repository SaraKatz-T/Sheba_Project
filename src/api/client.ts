import type { ApiErrorBody, ExistingUpload } from './types'

export const API_BASE = '/api'

const FALLBACK_MESSAGES: Record<number, string> = {
  0: 'אין חיבור לשרת. כדאי לבדוק את החיבור לרשת ולנסות שוב.',
  400: 'הבקשה לא תקינה.',
  401: 'צריך להיכנס מחדש.',
  403: 'אין הרשאה לפעולה הזו.',
  404: 'הפריט לא נמצא. ייתכן שהוא נמחק.',
  409: 'הפעולה לא מתאימה למצב הנוכחי של הטופס.',
  410: 'התוקף פג.',
  413: 'הקובץ גדול מדי.',
  415: 'סוג הקובץ לא נתמך.',
  429: 'יותר מדי ניסיונות. כדאי לחכות דקה ולנסות שוב.',
}

const SERVER_ERROR_MESSAGE = 'תקלה בשרת. כדאי לנסות שוב בעוד רגע.'

// A 404 without the contract's JSON error body means the request never reached the API.
const NOT_THE_API_MESSAGE = 'השרת לא מכיר את הבקשה הזו. כדאי לבדוק את כתובת השרת בהגדרות.'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly existingUpload?: ExistingUpload

  constructor(status: number, code: string, message: string, existingUpload?: ExistingUpload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.existingUpload = existingUpload
  }
}

export function messageForStatus(status: number): string {
  return FALLBACK_MESSAGES[status] ?? SERVER_ERROR_MESSAGE
}

export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null
  try {
    body = (await res.json()) as Partial<ApiErrorBody>
  } catch {
    // Non-JSON error body; fall back to the status message.
  }
  const err = body?.error
  const fallback = !err && res.status === 404 ? NOT_THE_API_MESSAGE : messageForStatus(res.status)
  return new ApiError(
    res.status,
    err?.code ?? `http_${res.status}`,
    err?.message || fallback,
    err?.existing_upload,
  )
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')

  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'network', messageForStatus(0))
  }

  if (!res.ok) throw await errorFromResponse(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) }
}
