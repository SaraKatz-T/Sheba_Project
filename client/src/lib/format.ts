import type { FormStatus, UploadStatus } from '../api/types'

export const STATUS_LABELS: Record<FormStatus, string> = {
  received: 'התקבל',
  processing: 'בעיבוד',
  pending_review: 'ממתין לבדיקה',
  approved: 'אושר',
  failed: 'נכשל',
  rejected: 'נדחה',
}

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  queued: 'נשלח לעיבוד',
  splitting: 'מפצל לטפסים',
  processing: 'בעיבוד',
  done: 'הסתיים',
  failed: 'נכשל',
}

/** "עוד כ-40 שניות", rounded so the countdown reads calmly. */
export function formatEta(etaIso: string, now: number): string {
  const seconds = Math.max(0, (Date.parse(etaIso) - now) / 1000)
  if (seconds <= 5) return 'עוד רגע'
  if (seconds < 55) return `עוד כ-${Math.ceil(seconds / 5) * 5} שניות`
  const minutes = Math.round(seconds / 60)
  return minutes <= 1 ? 'עוד כדקה' : `עוד כ-${minutes} דקות`
}

/** "עמוד 4" / "עמודים 4–6" */
export function formatPages(pages: number[]): string {
  if (pages.length === 0) return ''
  if (pages.length === 1) return `עמוד ${pages[0]}`
  return `עמודים ${pages[0]}–${pages[pages.length - 1]}`
}

const dateFmt = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

const timeFmt = new Intl.DateTimeFormat('he-IL', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jerusalem',
})

const numberFmt = new Intl.NumberFormat('he-IL')

/** 20.10.2026 */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

/** 20.10.2026 · 08:14 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`
}

export function formatNumber(n: number): string {
  return numberFmt.format(n)
}
