// Headline numbers and per-day counts for the records overview, computed from the list
// the server sends.
import type { FormSummary } from '../api/types'
import { israelDateKey } from '../lib/hebrewSearch'

const DAY_MS = 86_400_000

export interface Metrics {
  today: number
  yesterday: number
  pending: number
  /** Milliseconds the oldest waiting form has waited. */
  oldestWaitMs: number | null
  approved: number
  approvedToday: number
  /** Approved with no field corrected, as a share of all approved (0–1). */
  cleanShare: number | null
  cleanCount: number
  /** Mean time from intake to approval, in milliseconds. */
  avgHandlingMs: number | null
}

export function computeMetrics(forms: FormSummary[], now = Date.now()): Metrics {
  const todayKey = israelDateKey(new Date(now).toISOString())
  const yesterdayKey = israelDateKey(new Date(now - DAY_MS).toISOString())
  let today = 0
  let yesterday = 0
  let pending = 0
  let oldest: number | null = null
  let approved = 0
  let approvedToday = 0
  let clean = 0
  let handlingSum = 0

  for (const f of forms) {
    const day = israelDateKey(f.received_at)
    if (day === todayKey) today++
    else if (day === yesterdayKey) yesterday++
    if (f.status === 'pending_review') {
      pending++
      const received = Date.parse(f.received_at)
      if (oldest === null || received < oldest) oldest = received
    }
    if (f.status === 'approved') {
      approved++
      if (f.corrected_count === 0) clean++
      if (f.reviewed_at) {
        handlingSum += Date.parse(f.reviewed_at) - Date.parse(f.received_at)
        if (israelDateKey(f.reviewed_at) === todayKey) approvedToday++
      }
    }
  }

  return {
    today,
    yesterday,
    pending,
    oldestWaitMs: oldest === null ? null : now - oldest,
    approved,
    approvedToday,
    cleanShare: approved ? clean / approved : null,
    cleanCount: clean,
    avgHandlingMs: approved ? handlingSum / approved : null,
  }
}

export interface DayCount {
  key: string // yyyy-mm-dd, Israel time
  date: Date // noon UTC of that day, for formatting
  total: number
  pending: number
  approved: number
  other: number
}

/** One entry per day for the last `days` days, oldest first, including empty days. */
export function countByDay(forms: FormSummary[], days: number, now = Date.now()): DayCount[] {
  const byKey = new Map<string, DayCount>()
  const out: DayCount[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = israelDateKey(new Date(now - i * DAY_MS).toISOString())
    if (byKey.has(key)) continue
    const [y, m, d] = key.split('-').map(Number)
    const entry = { key, date: new Date(Date.UTC(y, m - 1, d, 12)), total: 0, pending: 0, approved: 0, other: 0 }
    byKey.set(key, entry)
    out.push(entry)
  }
  for (const f of forms) {
    const entry = byKey.get(israelDateKey(f.received_at))
    if (!entry) continue
    entry.total++
    if (f.status === 'pending_review') entry.pending++
    else if (f.status === 'approved') entry.approved++
    else entry.other++
  }
  return out
}

/** "12 דקות", "3.5 שעות", "2 ימים" */
export function formatDuration(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return 'פחות מדקה'
  if (minutes < 60) return Math.round(minutes) === 1 ? 'דקה' : `${Math.round(minutes)} דקות`
  const hours = minutes / 60
  if (hours < 24) {
    const h = hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : String(Math.round(hours))
    return h === '1' ? 'שעה' : `${h} שעות`
  }
  const daysCount = Math.round(hours / 24)
  return daysCount === 1 ? 'יום' : `${daysCount} ימים`
}

/** "לפני 3 שעות", "לפני יומיים" */
export function formatAgo(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 60) return minutes < 2 ? 'לפני רגע' : `לפני ${Math.round(minutes)} דקות`
  const hours = minutes / 60
  if (hours < 24) return Math.round(hours) === 1 ? 'לפני שעה' : Math.round(hours) === 2 ? 'לפני שעתיים' : `לפני ${Math.round(hours)} שעות`
  const daysCount = Math.round(hours / 24)
  return daysCount === 1 ? 'מאתמול' : daysCount === 2 ? 'לפני יומיים' : `לפני ${daysCount} ימים`
}
