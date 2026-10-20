// Records filters live in the URL, so a filtered view can be reloaded, shared, and
// exported exactly as shown.
import type { FormStatus, FormSummary } from '../api/types'
import { buildMatcher, israelDateKey } from '../lib/hebrewSearch'

export const ALL_STATUSES: FormStatus[] = [
  'received',
  'processing',
  'pending_review',
  'approved',
  'failed',
  'rejected',
]

export type SortKey = 'name' | 'id' | 'form_date' | 'received' | 'status' | 'uncertain'
export type View = 'table' | 'board'

export interface Filters {
  q: string
  statuses: FormStatus[] // empty = all
  from: string | null // yyyy-mm-dd, by intake date
  to: string | null
  yellow: boolean
  view: View
  sort: SortKey
  dir: 'asc' | 'desc'
}

const SORT_KEYS: SortKey[] = ['name', 'id', 'form_date', 'received', 'status', 'uncertain']
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function readFilters(params: URLSearchParams): Filters {
  const statuses = (params.get('status') ?? '')
    .split(',')
    .filter((s): s is FormStatus => (ALL_STATUSES as string[]).includes(s))
  const sort = params.get('sort') as SortKey | null
  const from = params.get('from')
  const to = params.get('to')
  return {
    q: params.get('q') ?? '',
    statuses,
    from: from && DATE_KEY.test(from) ? from : null,
    to: to && DATE_KEY.test(to) ? to : null,
    yellow: params.get('yellow') === '1',
    view: params.get('view') === 'board' ? 'board' : 'table',
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'received',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
  }
}

export function writeFilters(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.statuses.length) p.set('status', f.statuses.join(','))
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.yellow) p.set('yellow', '1')
  if (f.view === 'board') p.set('view', 'board')
  if (f.sort !== 'received') p.set('sort', f.sort)
  if (f.dir !== 'desc') p.set('dir', f.dir)
  return p
}

export const hasActiveFilters = (f: Filters) =>
  !!f.q.trim() || f.statuses.length > 0 || !!f.from || !!f.to || f.yellow

/** Search, status, intake-date range and "has yellow fields", in that order. */
export function applyFilters(forms: FormSummary[], f: Filters, opts: { ignoreStatus?: boolean } = {}) {
  const matcher = buildMatcher(f.q)
  return forms.filter((form) => {
    if (!opts.ignoreStatus && f.statuses.length && !f.statuses.includes(form.status)) return false
    if (f.from || f.to) {
      const day = israelDateKey(form.received_at)
      if (f.from && day < f.from) return false
      if (f.to && day > f.to) return false
    }
    if (f.yellow && form.uncertain_count === 0) return false
    return !matcher || matcher.test(form)
  })
}

const STATUS_ORDER: Record<FormStatus, number> = {
  received: 0,
  processing: 1,
  pending_review: 2,
  failed: 3,
  approved: 4,
  rejected: 5,
}

const hebrew = new Intl.Collator('he')

function compare(a: FormSummary, b: FormSummary, key: SortKey): number {
  switch (key) {
    case 'name':
      return hebrew.compare(a.person_name ?? '￿', b.person_name ?? '￿')
    case 'id':
      return (a.id_number ?? '￿').localeCompare(b.id_number ?? '￿')
    case 'form_date':
      return (a.form_date ?? '').localeCompare(b.form_date ?? '')
    case 'received':
      return a.received_at.localeCompare(b.received_at)
    case 'status':
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    case 'uncertain':
      return a.uncertain_count - b.uncertain_count
  }
}

export function sortForms(forms: FormSummary[], key: SortKey, dir: 'asc' | 'desc'): FormSummary[] {
  const sign = dir === 'asc' ? 1 : -1
  // Ties fall back to newest first, so the order never jumps around.
  return [...forms].sort((a, b) => sign * compare(a, b, key) || b.received_at.localeCompare(a.received_at))
}

/** Date-range presets, as yyyy-mm-dd in Israel time. */
export function presetRange(days: number): { from: string; to: string } {
  const to = israelDateKey(new Date().toISOString())
  const fromDate = new Date(Date.now() - (days - 1) * 86_400_000)
  return { from: israelDateKey(fromDate.toISOString()), to }
}
