import { CircleAlert, Download, FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { getForm } from '../api/endpoints'
import { keys, queryClient } from '../api/queries'
import type { FormDetail, FormSummary } from '../api/types'
import { Popover } from '../components/Popover'
import { formatNumber } from '../lib/format'
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

/** Exports exactly the records the table shows (current search, filters and sort). */
export function ExportMenu({ forms, onDone }: { forms: FormSummary[]; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState<{ format: Format; done: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          <p className="export-scope">
            {forms.length === 0
              ? 'אין טפסים לייצוא בסינון הנוכחי.'
              : `${formatNumber(forms.length)} טפסים, לפי החיפוש והסינון שמוצגים עכשיו.`}
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
