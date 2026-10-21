import { CircleAlert, Download, FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getForm } from '../api/endpoints'
import { keys, queryClient } from '../api/queries'
import type { FormDetail, FormSummary } from '../api/types'
import { Popover } from '../components/Popover'
import { formatNumber } from '../lib/format'
import { israelDateKey } from '../lib/hebrewSearch'
import { presetRange } from '../records/filters'
import { toCsv } from './csv'
import { buildExportTable, fileStamp } from './table'
import { toXlsx } from './xlsx'

const PARALLEL = 6

/** Full details for every form, a few requests at a time, reusing anything already loaded. */
async function loadDetails(forms: FormSummary[], onProgress: (done: number) => void): Promise<FormDetail[]> {
  const out: FormDetail[] = new Array(forms.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < forms.length) {
      const i = next++
      out[i] = await queryClient.fetchQuery({
        queryKey: keys.form(forms[i].id),
        queryFn: () => getForm(forms[i].id),
        staleTime: 30_000,
      })
      onProgress(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, forms.length) }, worker))
  return out
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

type Format = 'xlsx' | 'csv'
type Range = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
type Which = 'approved' | 'all'

const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: 'week', label: '7 ימים' },
  { key: 'month', label: '30 ימים' },
  { key: 'all', label: 'הכול' },
  { key: 'custom', label: 'טווח' },
]

/**
 * Exports by intake date and status, chosen here, independent of the table's filters.
 * Rejected forms are never exported.
 */
export function ExportMenu({ forms: all, onDone }: { forms: FormSummary[]; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState<{ format: Format; done: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = israelDateKey(new Date().toISOString())
  const [range, setRange] = useState<Range>('today')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [which, setWhich] = useState<Which>('approved')

  const forms = useMemo(() => {
    const r = range === 'custom' ? custom : range === 'all' ? null : presetRange(range)
    return all
      .filter((f) => (which === 'approved' ? f.status === 'approved' : f.status !== 'rejected'))
      .filter((f) => {
        if (!r) return true
        const day = israelDateKey(f.received_at)
        return (!r.from || day >= r.from) && (!r.to || day <= r.to)
      })
      .sort((a, b) => a.received_at.localeCompare(b.received_at))
  }, [all, range, custom, which])

  const run = async (format: Format, close: () => void) => {
    setError(null)
    setBusy({ format, done: 0 })
    try {
      const details = await loadDetails(forms, (done) => setBusy({ format, done }))
      const table = buildExportTable(details)
      const name = `טפסי התחייבות ${fileStamp()}.${format}`
      download(format === 'xlsx' ? toXlsx(table) : toCsv(table), name)
      close()
      onDone(`הקובץ ירד: ${formatNumber(forms.length)} טפסים`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייצוא נכשל. כדאי לנסות שוב.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover
      title="ייצוא"
      align="end"
      className="export-button"
      label={
        <>
          <Download size={17} aria-hidden="true" />
          ייצוא
        </>
      }
    >
      {(close) => (
        <div className="export-panel">
          <fieldset className="export-choice">
            <legend>תאריך קליטה</legend>
            <div className="export-chips">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="export-chip"
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="export-dates">
                <label>
                  מ-
                  <input
                    className="input date-input"
                    type="date"
                    value={custom.from}
                    max={custom.to || today}
                    onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                  />
                </label>
                <label>
                  עד
                  <input
                    className="input date-input"
                    type="date"
                    value={custom.to}
                    min={custom.from}
                    max={today}
                    onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                  />
                </label>
              </div>
            )}
          </fieldset>
          <fieldset className="export-choice">
            <legend>אילו טפסים</legend>
            <div className="export-chips">
              <button
                type="button"
                className="export-chip"
                aria-pressed={which === 'approved'}
                onClick={() => setWhich('approved')}
              >
                רק מאושרים
              </button>
              <button type="button" className="export-chip" aria-pressed={which === 'all'} onClick={() => setWhich('all')}>
                הכול חוץ מנדחים
              </button>
            </div>
          </fieldset>
          <p className="export-scope" aria-live="polite">
            {forms.length === 0 ? (
              'אין טפסים בבחירה הזו.'
            ) : (
              <>
                ייצאו <strong>{formatNumber(forms.length)}</strong> טפסים.
              </>
            )}
          </p>
          <button
            type="button"
            className="export-option"
            onClick={() => void run('xlsx', close)}
            disabled={!!busy || forms.length === 0}
          >
            <FileSpreadsheet size={22} aria-hidden="true" />
            <span>
              <strong>
                אקסל <bdi dir="ltr">(.xlsx)</bdi>
              </strong>
              <span className="muted">גיליון מימין לשמאל, עם כותרות וסינון</span>
            </span>
          </button>
          <button
            type="button"
            className="export-option"
            onClick={() => void run('csv', close)}
            disabled={!!busy || forms.length === 0}
          >
            <FileText size={22} aria-hidden="true" />
            <span>
              <strong>CSV</strong>
              <span className="muted">קובץ טקסט שכל מערכת יודעת לקרוא</span>
            </span>
          </button>
          {busy && (
            <p className="export-progress" role="status">
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              מכין את הקובץ… {formatNumber(busy.done)} מתוך {formatNumber(forms.length)}
            </p>
          )}
          {error && (
            <p className="alert alert-danger" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      )}
    </Popover>
  )
}
