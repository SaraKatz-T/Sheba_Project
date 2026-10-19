import type { ApiErrorBody } from './types'

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

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly existingId?: string

  constructor(status: number, code: string, message: string, existingId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.existingId = existingId
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
  return new ApiError(
    res.status,
    err?.code ?? `http_${res.status}`,
    err?.message || messageForStatus(res.status),
    err?.existing_id,
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
