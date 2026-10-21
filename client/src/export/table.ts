// Turns forms into one export table: commitment number first, then every field in the
// order the form has them, then the record's own details.
import type { FormDetail, FormSource } from '../api/types'
import { STATUS_LABELS } from '../lib/format'

export type Cell =
  | { kind: 'text'; value: string; flagged?: boolean }
  | { kind: 'datetime'; iso: string }
  | { kind: 'number'; value: number }
  | { kind: 'empty' }

export interface ExportTable {
  columns: string[]
  rows: Cell[][]
}

/**
 * Spreadsheet formula injection: a value starting with = + - @ (or a tab / carriage
 * return) could run as a formula. Such values are kept as plain text.
 */
export const looksLikeFormula = (value: string) => /^[=+\-@\t\r]/.test(value)

const SOURCE_LABEL: Record<FormSource, string> = { upload: 'מחשב', phone: 'טלפון', demo: 'הדגמה' }

const text = (value: string | null | undefined, flagged = false): Cell =>
  value ? { kind: 'text', value, flagged } : { kind: 'empty' }

export function buildExportTable(forms: FormDetail[]): ExportTable {
  // Union of field keys, in the order they first appear; the commitment number leads.
  const fieldOrder: Array<{ key: string; label: string }> = []
  const seen = new Set<string>(['commitment_number'])
  for (const form of forms) {
    for (const f of form.fields) {
      if (seen.has(f.key)) continue
      seen.add(f.key)
      fieldOrder.push({ key: f.key, label: f.label })
    }
  }

  const columns = [
    'מספר התחייבות',
    ...fieldOrder.map((f) => f.label),
    'סטטוס',
    'התקבל',
    'נבדק',
    'שדות שתוקנו',
    'שדות פתוחים לבדיקה',
    'קובץ',
    'מקור',
    'הערה',
  ]

  const rows = forms.map((form): Cell[] => {
    const byKey = new Map(form.fields.map((f) => [f.key, f]))
    const note = form.error ?? (form.merged_into ? 'מוזג לטופס אחר' : null)
    return [
      text(form.commitment_number),
      ...fieldOrder.map(({ key }) => {
        const f = byKey.get(key)
        return text(f?.value, !!f?.uncertain)
      }),
      text(STATUS_LABELS[form.status]),
      { kind: 'datetime', iso: form.received_at },
      form.reviewed_at ? { kind: 'datetime', iso: form.reviewed_at } : { kind: 'empty' },
      { kind: 'number', value: form.corrected_count },
      { kind: 'number', value: form.uncertain_count },
      text(form.file_name),
      text(SOURCE_LABEL[form.source]),
      text(note),
    ]
  })

  return { columns, rows }
}

/** Date and time parts in Israel time. */
export function israelParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') }
}

export function fileStamp(now = new Date()) {
  const p = israelParts(now.toISOString())
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(p.d)}.${two(p.m)}.${p.y} ${two(p.h)}${two(p.min)}`
}
