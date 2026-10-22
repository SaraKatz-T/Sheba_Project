// The trash: records deleted in the last 30 days. They can be restored until then; after that
// the server deletes them for good.
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CircleAlert, CircleCheck, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
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

/** Whole days left before the server deletes the record for good. */
function daysLeft(f: FormSummary) {
  const end = Date.parse(f.deleted_at ?? '') + KEEP_DAYS * DAY_MS
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS))
}

const fullName = (f: FormSummary) => [f.first_name, f.last_name].filter(Boolean).join(' ') || f.person_name || ''

export function TrashPage() {
  const trash = useTrash()
  const items = useMemo(() => trash.data?.items ?? [], [trash.data])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const ticked = items.filter((f) => selected.has(f.id)).map((f) => f.id)

  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const restore = useMutation({
    mutationFn: (ids: string[]) => restoreForms(ids),
    onSuccess: (data, ids) => {
      data.items.forEach(upsertForm)
      void queryClient.invalidateQueries({ queryKey: keys.trash, exact: true })
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
      setToast({ text: ids.length === 1 ? 'הטופס שוחזר' : `${ids.length} טפסים שוחזרו`, n: Date.now() })
    },
  })

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>סל מחזור</h1>
          <p>טפסים שנמחקו נשמרים כאן {KEEP_DAYS} יום, ואחר כך נמחקים לתמיד.</p>
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
          <button type="button" className="btn btn-sm btn-primary" onClick={() => restore.mutate(ticked)} disabled={restore.isPending}>
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
              <caption className="visually-hidden">טפסים בסל המחזור, מה שנמחק לאחרונה ראשון</caption>
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
                  <th scope="col">קובץ</th>
                  <th scope="col">סטטוס</th>
                  <th scope="col">נמחק</th>
                  <th scope="col">נמחק לתמיד בעוד</th>
                  <th scope="col" className="col-action">
                    <span className="visually-hidden">שחזור</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => {
                  const days = daysLeft(f)
                  return (
                    <tr key={f.id}>
                      <td className="col-select">
                        <input
                          type="checkbox"
                          aria-label={`בחירת הטופס ${f.commitment_number ?? ''}`}
                          checked={selected.has(f.id)}
                          onChange={(e) => toggle(f.id, e.target.checked)}
                        />
                      </td>
                      <td>{f.commitment_number ? <span className="ltr num">{f.commitment_number}</span> : <span className="muted">—</span>}</td>
                      <td>{fullName(f) || <span className="muted">—</span>}</td>
                      <td>{f.id_number ? <span className="ltr num">{f.id_number}</span> : <span className="muted">—</span>}</td>
                      <td className="cell-file" title={f.file_name}>
                        <bdi>{f.file_name}</bdi>
                      </td>
                      <td>
                        <StatusChip status={f.status} />
                      </td>
                      <td className="num">{f.deleted_at ? formatDateTime(f.deleted_at) : ''}</td>
                      <td>{days <= 1 ? 'פחות מיום' : `${formatNumber(days)} ימים`}</td>
                      <td className="col-action">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => restore.mutate([f.id])}
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
