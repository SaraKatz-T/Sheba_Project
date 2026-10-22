import { CircleAlert, LoaderCircle, Send, X } from 'lucide-react'
import { type InputHTMLAttributes, useEffect, useId, useMemo, useRef, useState } from 'react'
import { getForm, sendExport } from '../api/endpoints'
import { keys, queryClient } from '../api/queries'
import type { FormDetail, FormSummary } from '../api/types'
import { StatusChip } from '../components/StatusChip'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { israelDateKey } from '../lib/hebrewSearch'
import { presetRange } from '../records/filters'
import type { SentInfo } from './SentNotice'
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

interface FileGroup {
  uploadId: string
  fileName: string
  receivedAt: string
  forms: FormSummary[]
}

/** A checkbox that can also show "some selected". */
function TriCheckbox({ checked, mixed, ...rest }: { checked: boolean; mixed: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  return <input ref={ref} type="checkbox" checked={checked} {...rest} />
}

/** Toolbar button that opens the send-to-lab dialog. */
export function ExportMenu({ forms, onDone }: { forms: FormSummary[]; onDone: (sent: SentInfo) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        <Send size={18} aria-hidden="true" />
        שליחה למעבדה
      </button>
      {open && <SendDialog all={forms} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  )
}

/**
 * Picks forms by intake date and status (independent of the table's filters), shows them
 * grouped by file so single forms or whole files can be left out, then builds the .xlsx and
 * sends it to the lab through the server (for now by email). Rejected forms are never sent.
 */
function SendDialog({ all, onClose, onDone }: { all: FormSummary[]; onClose: () => void; onDone: (sent: SentInfo) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const today = israelDateKey(new Date().toISOString())
  const [range, setRange] = useState<Range>('today')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [which, setWhich] = useState<Which>('approved')
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<{ sending: boolean; done: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const forms = useMemo(() => {
    const r = range === 'custom' ? custom : range === 'all' ? null : presetRange(range)
    return all
      .filter((f) => !f.deleted_at)
      .filter((f) => (which === 'approved' ? f.status === 'approved' : f.status !== 'rejected'))
      .filter((f) => {
        if (!r) return true
        const day = israelDateKey(f.received_at)
        return (!r.from || day >= r.from) && (!r.to || day <= r.to)
      })
      .sort((a, b) => a.received_at.localeCompare(b.received_at))
  }, [all, range, custom, which])

  const groups = useMemo(() => {
    const byFile = new Map<string, FileGroup>()
    for (const f of forms) {
      let g = byFile.get(f.upload_id)
      if (!g) {
        g = { uploadId: f.upload_id, fileName: f.file_name, receivedAt: f.received_at, forms: [] }
        byFile.set(f.upload_id, g)
      }
      g.forms.push(f)
    }
    return [...byFile.values()]
  }, [forms])

  const selected = forms.filter((f) => !excluded.has(f.id))
  const allOn = forms.length > 0 && selected.length === forms.length

  const toggle = (ids: string[], on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.delete(id)
        else next.add(id)
      }
      return next
    })

  const send = async () => {
    setError(null)
    setBusy({ sending: false, done: 0 })
    try {
      const details = await loadDetails(selected, (done) => setBusy({ sending: false, done }))
      const file = toXlsx(buildExportTable(details))
      setBusy({ sending: true, done: selected.length })
      const fileName = `טפסי התחייבות ${fileStamp()}.xlsx`
      const result = await sendExport(file, fileName, selected.length)
      onDone({ sentTo: result.sent_to, count: result.form_count, fileName })
      ref.current?.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'השליחה נכשלה. כדאי לנסות שוב.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog send-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
    >
      <header className="dialog-head">
        <h2 id={titleId}>שליחה למעבדה</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} disabled={!!busy} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="dialog-body">
        <div className="send-filters">
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
        </div>

        {forms.length === 0 ? (
          <p className="send-empty muted">אין טפסים בבחירה הזו.</p>
        ) : (
          <div className="send-table-wrap">
            <table className="send-table">
              <thead>
                <tr>
                  <th className="send-check">
                    <TriCheckbox
                      checked={allOn}
                      mixed={!allOn && selected.length > 0}
                      onChange={(e) => toggle(forms.map((f) => f.id), e.target.checked)}
                      aria-label="בחירת כל הטפסים"
                    />
                  </th>
                  <th>מספר התחייבות</th>
                  <th>שם</th>
                  <th>ת"ז</th>
                  <th>תאריך הטופס</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              {groups.map((g) => {
                const ids = g.forms.map((f) => f.id)
                const on = ids.filter((id) => !excluded.has(id)).length
                return (
                  <tbody key={g.uploadId}>
                    <tr className="send-file">
                      <td className="send-check">
                        <TriCheckbox
                          checked={on === ids.length}
                          mixed={on > 0 && on < ids.length}
                          onChange={(e) => toggle(ids, e.target.checked)}
                          aria-label={`בחירת כל הטפסים בקובץ ${g.fileName}`}
                        />
                      </td>
                      <td colSpan={5}>
                        <strong>
                          <bdi>{g.fileName}</bdi>
                        </strong>
                        <span className="muted num">
                          {' '}
                          · התקבל {formatDateTime(g.receivedAt)} ·{' '}
                          {ids.length === 1 ? 'טופס אחד' : `${formatNumber(ids.length)} טפסים`}
                        </span>
                      </td>
                    </tr>
                    {g.forms.map((f) => (
                      <tr key={f.id} className={excluded.has(f.id) ? 'is-off' : undefined}>
                        <td className="send-check">
                          <input
                            type="checkbox"
                            checked={!excluded.has(f.id)}
                            onChange={(e) => toggle([f.id], e.target.checked)}
                            aria-label={`בחירת הטופס ${f.commitment_number ?? f.id}`}
                          />
                        </td>
                        <td className="ltr num">{f.commitment_number ?? '—'}</td>
                        <td>{f.person_name ?? '—'}</td>
                        <td className="ltr num">{f.id_number ?? '—'}</td>
                        <td className="num">{f.form_date ? formatDate(f.form_date) : '—'}</td>
                        <td>
                          <StatusChip status={f.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}

        {error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>

      <footer className="dialog-foot send-foot">
        <p className="send-count" aria-live="polite">
          {busy ? (
            <>
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              {busy.sending
                ? 'שולח…'
                : `מכין את הקובץ… ${formatNumber(busy.done)} מתוך ${formatNumber(selected.length)}`}
            </>
          ) : (
            <>
              נבחרו <strong>{formatNumber(selected.length)}</strong> מתוך {formatNumber(forms.length)} טפסים
            </>
          )}
        </p>
        <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()} disabled={!!busy}>
          ביטול
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={!!busy || selected.length === 0}>
          <Send size={18} aria-hidden="true" />
          שליחת {formatNumber(selected.length)} טפסים
        </button>
      </footer>
    </dialog>
  )
}
