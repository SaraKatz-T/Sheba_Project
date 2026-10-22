import { useMutation } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Columns3, Inbox, RefreshCw, SearchX, Table2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { deleteForms } from '../api/endpoints'
import { dropForms, useForms } from '../api/queries'
import type { FormStatus } from '../api/types'
import { RingsLoader } from '../components/BrandRings'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { ExportMenu } from '../export/ExportMenu'
import { formatNumber } from '../lib/format'
import {
  applyFilters,
  currentPreset,
  defaultFilters,
  hasActiveFilters,
  readFilters,
  showsAllDates,
  sortForms,
  writeFilters,
  type Filters,
  type SortKey,
} from '../records/filters'
import { KanbanBoard } from '../records/KanbanBoard'
import { RecordDetail } from '../records/RecordDetail'
import { canDelete, RecordsTable } from '../records/RecordsTable'
import { RecordsToolbar } from '../records/RecordsToolbar'

export function RecordsPage() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const forms = useForms()
  const all = useMemo(() => forms.data?.items ?? [], [forms.data])

  const update = useCallback(
    (patch: Partial<Filters>) => setParams((prev) => writeFilters({ ...readFilters(prev), ...patch }), { replace: true }),
    [setParams],
  )

  // Status counts reflect every other filter, so each chip says what clicking it would show.
  const beforeStatus = useMemo(() => applyFilters(all, filters, { ignoreStatus: true }), [all, filters])
  const counts = useMemo(() => {
    const c: Partial<Record<FormStatus, number>> = {}
    for (const f of beforeStatus) c[f.status] = (c[f.status] ?? 0) + 1
    return c
  }, [beforeStatus])
  const visible = useMemo(() => {
    const byStatus = filters.statuses.length
      ? beforeStatus.filter((f) => filters.statuses.includes(f.status))
      : beforeStatus
    return sortForms(byStatus, filters.sort, filters.dir)
  }, [beforeStatus, filters.statuses, filters.sort, filters.dir])

  // After approving or rejecting, the record closes; this only tells the toast whether others are still waiting.
  const nextPending = (afterId: string) => {
    const i = visible.findIndex((f) => f.id === afterId)
    const isNext = (f: (typeof visible)[number]) => f.status === 'pending_review' && f.id !== afterId
    return (visible.slice(i + 1).find(isNext) ?? visible.slice(0, Math.max(0, i)).find(isNext))?.id ?? null
  }

  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)

  // Records ticked for deletion. Only rows still on screen count.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const visibleIds = useMemo(() => new Set(visible.map((f) => f.id)), [visible])
  const ticked = useMemo(() => [...selected].filter((id) => visibleIds.has(id)), [selected, visibleIds])
  const onSelect = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  const deletable = useMemo(() => visible.filter(canDelete).map((f) => f.id), [visible])

  // Ids waiting for the user to confirm the move to the trash (one record, or the ticked ones).
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteForms(ids),
    onSuccess: (_data, ids) => {
      dropForms(ids)
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
      if (filters.open && ids.includes(filters.open)) update({ open: null })
      setConfirmDelete(null)
      setToast({ text: ids.length === 1 ? 'הטופס הועבר לסל המחזור' : `${ids.length} טפסים הועברו לסל המחזור`, n: Date.now() })
    },
  })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const onSort = (key: SortKey) =>
    update(
      key === filters.sort
        ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: ['commitment', 'name', 'id', 'status'].includes(key) ? 'asc' : 'desc' },
    )

  const onlyToday = currentPreset(filters) === 'today' && !hasActiveFilters(filters)
  const subtitle = forms.isPending
    ? 'טוען…'
    : onlyToday
      ? `${formatNumber(visible.length)} טפסים מהיום · ${formatNumber(all.length)} בסך הכול`
      : hasActiveFilters(filters)
        ? `${formatNumber(visible.length)} מתוך ${formatNumber(all.length)} טפסים`
        : `${formatNumber(all.length)} טפסים`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>טפסים</h1>
          <p aria-live="polite">{subtitle}</p>
        </div>
        <div className="page-head-actions">
          <ExportMenu forms={all} onDone={(text) => setToast({ text, n: Date.now() })} />
          <Link className="btn btn-outline" to="/records/trash">
            <Trash2 size={18} aria-hidden="true" />
            סל מחזור
          </Link>
          <div className="segmented" role="group" aria-label="תצוגה">
            <button type="button" aria-pressed={filters.view === 'table'} onClick={() => update({ view: 'table' })}>
              <Table2 size={16} aria-hidden="true" />
              טבלה
            </button>
            <button type="button" aria-pressed={filters.view === 'board'} onClick={() => update({ view: 'board' })}>
              <Columns3 size={16} aria-hidden="true" />
              לוח סטטוסים
            </button>
          </div>
        </div>
      </div>

      <RecordsToolbar filters={filters} counts={counts} onChange={update} />

      {ticked.length > 0 && filters.view === 'table' && (
        <div className="selection-bar" role="region" aria-label="פעולות על הטפסים שנבחרו">
          <span className="selection-count">
            {ticked.length === 1 ? 'נבחר טופס אחד' : `נבחרו ${formatNumber(ticked.length)} טפסים`}
          </span>
          {ticked.length < deletable.length && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => onSelect(deletable, true)}>
              בחירת כל {formatNumber(deletable.length)} המוצגות
            </button>
          )}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(ticked)}>
            <Trash2 size={15} aria-hidden="true" />
            מחיקה
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>
            <X size={15} aria-hidden="true" />
            ביטול הבחירה
          </button>
        </div>
      )}

      {forms.isPending ? (
        <div className="records-loading" role="status">
          <RingsLoader />
          טוען את הטפסים…
        </div>
      ) : forms.isError ? (
        <EmptyState
          icon={<CircleAlert size={26} />}
          title="לא הצלחנו לטעון את הטפסים"
          action={
            <button type="button" className="btn btn-primary" onClick={() => forms.refetch()}>
              <RefreshCw size={18} aria-hidden="true" />
              לנסות שוב
            </button>
          }
        >
          {forms.error.message}
        </EmptyState>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Inbox size={26} />}
          title="עוד לא נקלטו טפסים"
          rings
          action={
            <Link className="btn btn-primary" to="/intake">
              לקליטת טפסים
            </Link>
          }
        />
      ) : visible.length === 0 && filters.view === 'table' ? (
        <EmptyState
          icon={<SearchX size={26} />}
          title={
            filters.statuses.length === 1 && filters.statuses[0] === 'pending_review'
              ? 'אין טפסים ממתינים'
              : onlyToday
                ? 'עוד לא נקלטו טפסים היום'
                : 'לא נמצאו טפסים שמתאימים לסינון'
          }
          rings={filters.statuses.length === 1 && filters.statuses[0] === 'pending_review'}
          action={
            hasActiveFilters(filters) ? (
              <button type="button" className="btn btn-outline" onClick={() => update(defaultFilters())}>
                ניקוי הסינון
              </button>
            ) : !showsAllDates(filters) ? (
              <button type="button" className="btn btn-outline" onClick={() => update({ from: null, to: null })}>
                להצגת כל הטפסים
              </button>
            ) : undefined
          }
        >
          אפשר לחפש מספר התחייבות, חלק מהשם, כמה ספרות מהת"ז, או תאריך כמו 20.10.
        </EmptyState>
      ) : filters.view === 'board' ? (
        <KanbanBoard
          forms={applyFilters(all, filters)}
          visibleStatuses={filters.statuses}
          onShowColumn={(statuses) => update({ view: 'table', statuses })}
          onOpen={(id) => update({ view: 'table', open: id })}
        />
      ) : (
        <RecordsTable
          forms={visible}
          selected={selected}
          onSelect={onSelect}
          onDelete={setConfirmDelete}
          sort={filters.sort}
          dir={filters.dir}
          onSort={onSort}
          openId={filters.open}
          onToggle={(id) => update({ open: filters.open === id ? null : id })}
          renderDetail={(id) => (
            <RecordDetail
              key={id}
              id={id}
              nextPending={nextPending}
              onDone={(next, message) => {
                setToast({ text: next ? message : `${message} · אין עוד טפסים ממתינים`, n: Date.now() })
                update({ open: null })
              }}
              onClose={() => update({ open: null })}
              onDelete={() => setConfirmDelete([id])}
            />
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.length === 1 ? 'למחוק את הטופס?' : `למחוק ${formatNumber(confirmDelete.length)} טפסים?`}
          confirmLabel="מחיקה"
          confirmIcon={<Trash2 size={18} aria-hidden="true" />}
          danger
          pending={remove.isPending}
          error={remove.error?.message}
          onConfirm={() => remove.mutate(confirmDelete)}
          onClose={() => {
            setConfirmDelete(null)
            remove.reset()
          }}
        >
          {confirmDelete.length === 1
            ? 'הטופס יעבור לסל המחזור. אפשר לשחזר אותו עד 30 יום, ואחר כך הוא נמחק לתמיד.'
            : 'הטפסים יעברו לסל המחזור. אפשר לשחזר אותם עד 30 יום, ואחר כך הם נמחקים לתמיד.'}
        </ConfirmDialog>
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
