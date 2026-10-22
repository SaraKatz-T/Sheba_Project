// The trash: forms deleted in the last 30 days, grouped by the file they came from. Single forms
// or a whole file can be restored until then; after that the server deletes them for good.
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CircleAlert, CircleCheck, FileText, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { restoreForms } from '../api/endpoints'
import { keys, queryClient, upsertForm, useTrash } from '../api/queries'
import type { FormSummary } from '../api/types'
import { RingsLoader } from '../components/BrandRings'
import { EmptyState } from '../components/EmptyState'
import { StatusChip } from '../components/StatusChip'
import { formatDateTime, formatNumber } from '../lib/format'

const KEEP_DAYS = 30
const DAY_MS = 86_400_000

/** Whole days left before the server deletes the form for good. */
function daysLeft(f: FormSummary) {
  const end = Date.parse(f.deleted_at ?? '') + KEEP_DAYS * DAY_MS
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS))
}

const fullName = (f: FormSummary) => [f.first_name, f.last_name].filter(Boolean).join(' ') || f.person_name || ''

const formsCount = (n: number) => (n === 1 ? 'טופס אחד' : `${formatNumber(n)} טפסים`)

interface FileGroup {
  uploadId: string
  fileName: string
  forms: FormSummary[]
}

/** The deleted forms grouped by the file they came from, most recently deleted file first. */
function byFile(items: FormSummary[]): FileGroup[] {
  const groups = new Map<string, FileGroup>()
  for (const f of items) {
    let g = groups.get(f.upload_id)
    if (!g) {
      g = { uploadId: f.upload_id, fileName: f.file_name, forms: [] }
      groups.set(f.upload_id, g)
    }
    g.forms.push(f)
  }
  return [...groups.values()]
}

export function TrashPage() {
  const trash = useTrash()
  const items = useMemo(() => trash.data?.items ?? [], [trash.data])
  const groups = useMemo(() => byFile(items), [items])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const ticked = items.filter((f) => selected.has(f.id)).map((f) => f.id)

  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const restore = useMutation({
    // fileName is set when a whole file is restored, so the message can name it
    mutationFn: ({ ids }: { ids: string[]; fileName?: string }) => restoreForms(ids),
    onSuccess: (data, { ids, fileName }) => {
      data.items.forEach(upsertForm)
      void queryClient.invalidateQueries({ queryKey: keys.trash, exact: true })
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
      const text = fileName
        ? `הקובץ ${fileName} שוחזר (${formsCount(ids.length)})`
        : ids.length === 1
          ? 'הטופס שוחזר'
          : `${formatNumber(ids.length)} טפסים שוחזרו`
      setToast({ text, n: Date.now() })
    },
  })

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>סל מחזור</h1>
          <p>טפסים שנמחקו נשמרים כאן {KEEP_DAYS} יום, ואחר כך נמחקים לתמיד. אפשר לשחזר טופס בודד או קובץ שלם.</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-outline" to="/records">
            <ArrowRight size={18} aria-hidden="true" />
            חזרה לטפסים
          </Link>
        </div>
      </div>

      {ticked.length > 0 && (
        <div className="selection-bar" role="region" aria-label="פעולות על הטפסים שנבחרו">
          <span className="selection-count">
            {ticked.length === 1 ? 'נבחר טופס אחד' : `נבחרו ${formatNumber(ticked.length)} טפסים`}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => restore.mutate({ ids: ticked })}
            disabled={restore.isPending}
          >
            <RotateCcw size={15} aria-hidden="true" />
            שחזור
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>
            <X size={15} aria-hidden="true" />
            ביטול הבחירה
          </button>
        </div>
      )}

      {restore.error && (
        <p className="alert alert-danger" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          {restore.error.message}
        </p>
      )}

      {trash.isPending ? (
        <div className="records-loading" role="status">
          <RingsLoader />
          טוען את סל המחזור…
        </div>
      ) : trash.isError ? (
        <EmptyState
          icon={<CircleAlert size={26} />}
          title="לא הצלחנו לטעון את סל המחזור"
          action={
            <button type="button" className="btn btn-primary" onClick={() => trash.refetch()}>
              <RefreshCw size={18} aria-hidden="true" />
              לנסות שוב
            </button>
          }
        >
          {trash.error.message}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={26} />} title="סל המחזור ריק" />
      ) : (
        <section className="table-card">
          <div className="table-scroll">
            <table className="records trash-table">
              <caption className="visually-hidden">טפסים בסל המחזור לפי קובץ, מה שנמחק לאחרונה ראשון</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-select">
                    <input
                      type="checkbox"
                      aria-label="בחירת כל הטפסים בסל"
                      checked={ticked.length === items.length}
                      ref={(el) => {
                        if (el) el.indeterminate = ticked.length > 0 && ticked.length < items.length
                      }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map((f) => f.id)) : new Set())}
                    />
                  </th>
                  <th scope="col">מספר התחייבות</th>
                  <th scope="col">שם</th>
                  <th scope="col">ת"ז</th>
                  <th scope="col">סטטוס</th>
                  <th scope="col">נמחק</th>
                  <th scope="col">נמחק לתמיד בעוד</th>
                  <th scope="col" className="col-action">
                    <span className="visually-hidden">שחזור</span>
                  </th>
                </tr>
              </thead>
              {groups.map((g) => {
                const ids = g.forms.map((f) => f.id)
                const on = ids.filter((id) => selected.has(id)).length
                return (
                  <tbody key={g.uploadId} className="trash-group">
                    <tr className="trash-file">
                      <td className="col-select">
                        <input
                          type="checkbox"
                          aria-label={`בחירת כל הטפסים בקובץ ${g.fileName}`}
                          checked={on === ids.length}
                          ref={(el) => {
                            if (el) el.indeterminate = on > 0 && on < ids.length
                          }}
                          onChange={(e) => toggle(ids, e.target.checked)}
                        />
                      </td>
                      <th scope="rowgroup" colSpan={6} className="trash-file-name">
                        <FileText size={16} aria-hidden="true" />
                        <bdi title={g.fileName}>{g.fileName}</bdi>
                        <span className="muted">{formsCount(ids.length)}</span>
                      </th>
                      <td className="col-action">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => restore.mutate({ ids, fileName: g.fileName })}
                          disabled={restore.isPending}
                        >
                          <RotateCcw size={15} aria-hidden="true" />
                          שחזור הקובץ
                        </button>
                      </td>
                    </tr>
                    {g.forms.map((f) => {
                      const days = daysLeft(f)
                      return (
                        <tr key={f.id}>
                          <td className="col-select">
                            <input
                              type="checkbox"
                              aria-label={`בחירת הטופס ${f.commitment_number ?? ''}`}
                              checked={selected.has(f.id)}
                              onChange={(e) => toggle([f.id], e.target.checked)}
                            />
                          </td>
                          <td>
                            {f.commitment_number ? <span className="ltr num">{f.commitment_number}</span> : <span className="muted">—</span>}
                          </td>
                          <td>{fullName(f) || <span className="muted">—</span>}</td>
                          <td>{f.id_number ? <span className="ltr num">{f.id_number}</span> : <span className="muted">—</span>}</td>
                          <td>
                            <StatusChip status={f.status} />
                          </td>
                          <td className="num">{f.deleted_at ? formatDateTime(f.deleted_at) : ''}</td>
                          <td>{days <= 1 ? 'פחות מיום' : `${formatNumber(days)} ימים`}</td>
                          <td className="col-action">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => restore.mutate({ ids: [f.id] })}
                              disabled={restore.isPending}
                            >
                              <RotateCcw size={15} aria-hidden="true" />
                              שחזור
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          </div>
        </section>
      )}

      <p className="toast" role="status" aria-live="polite" key={toast?.n}>
        {toast && (
          <>
            <CircleCheck size={18} aria-hidden="true" />
            {toast.text}
          </>
        )}
      </p>
    </>
  )
}
