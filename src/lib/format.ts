import type { FormStatus } from '../api/types'

export const STATUS_LABELS: Record<FormStatus, string> = {
  received: 'התקבל',
  processing: 'בעיבוד',
  pending_review: 'ממתין לבדיקה',
  approved: 'אושר',
  failed: 'נכשל',
  rejected: 'נדחה',
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
