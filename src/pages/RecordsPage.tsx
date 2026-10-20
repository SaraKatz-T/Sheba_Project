import { CircleAlert, CircleCheck, ClipboardCheck, Columns3, Inbox, LoaderCircle, RefreshCw, SearchX, Table2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForms } from '../api/queries'
import type { FormStatus } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ExportMenu } from '../export/ExportMenu'
import { formatNumber } from '../lib/format'
import { DuplicatesPanel } from '../records/DuplicatesPanel'
import { duplicateIndex, findDuplicates, useDismissedDuplicates, type DuplicateGroup } from '../records/duplicates'
import { applyFilters, hasActiveFilters, readFilters, sortForms, writeFilters, type Filters, type SortKey } from '../records/filters'
import { KanbanBoard } from '../records/KanbanBoard'
import { MergeDialog } from '../records/MergeDialog'
import { RecordDetail } from '../records/RecordDetail'
import { RecordsTable } from '../records/RecordsTable'
import { RecordsToolbar } from '../records/RecordsToolbar'

export function RecordsPage() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const forms = useForms()
  const all = useMemo(() => forms.data?.items ?? [], [forms.data])
  const dismissed = useDismissedDuplicates()
  const [dupsOpen, setDupsOpen] = useState(false)
  const [merging, setMerging] = useState<DuplicateGroup | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const update = useCallback(
    (patch: Partial<Filters>) => setParams((prev) => writeFilters({ ...readFilters(prev), ...patch }), { replace: true }),
    [setParams],
  )

  const groups = useMemo(() => findDuplicates(all, dismissed), [all, dismissed])
  const dupIndex = useMemo(() => duplicateIndex(groups), [groups])

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

  const pendingCount = useMemo(() => all.filter((f) => f.status === 'pending_review').length, [all])

  // After approving or rejecting, the next waiting record in the table opens by itself.
  const nextPending = (afterId: string) => {
    const i = visible.findIndex((f) => f.id === afterId)
    const isNext = (f: (typeof visible)[number]) => f.status === 'pending_review' && f.id !== afterId
    return (visible.slice(i + 1).find(isNext) ?? visible.slice(0, Math.max(0, i)).find(isNext))?.id ?? null
  }

  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const startReview = () => {
    const waiting = sortForms(
      all.filter((f) => f.status === 'pending_review'),
      filters.sort,
      filters.dir,
    )
    update({ statuses: ['pending_review'], view: 'table', open: waiting[0]?.id ?? null })
  }

  const onSort = (key: SortKey) =>
    update(
      key === filters.sort
        ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: ['commitment', 'name', 'id', 'status'].includes(key) ? 'asc' : 'desc' },
    )

  const showDuplicates = () => {
    setDupsOpen(true)
    document.getElementById('dups-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const subtitle = forms.isPending
    ? 'טוען…'
    : hasActiveFilters(filters)
      ? `${formatNumber(visible.length)} מתוך ${formatNumber(all.length)} טפסים`
      : `${formatNumber(all.length)} טפסים`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>רשומות</h1>
          <p aria-live="polite">{subtitle}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={startReview} disabled={pendingCount === 0}>
            <ClipboardCheck size={18} aria-hidden="true" />
            ממתינים לבדיקה
            {pendingCount > 0 && <span className="badge">{formatNumber(pendingCount)}</span>}
          </button>
          <ExportMenu
            forms={filters.view === 'board' ? sortForms(applyFilters(all, filters), filters.sort, filters.dir) : visible}
            onDone={(text) => setToast({ text, n: Date.now() })}
          />
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

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <DuplicatesPanel
        groups={groups}
        open={dupsOpen}
        onToggle={() => setDupsOpen((o) => !o)}
        onMerge={setMerging}
        onAnnounce={setAnnouncement}
        onOpen={(id) => update({ view: 'table', open: id })}
      />

      <RecordsToolbar filters={filters} counts={counts} onChange={update} />

      {forms.isPending ? (
        <div className="records-loading" role="status">
          <LoaderCircle size={22} className="spin" aria-hidden="true" />
          טוען את הרשומות…
        </div>
      ) : forms.isError ? (
        <EmptyState
          icon={<CircleAlert size={26} />}
          title="לא הצלחנו לטעון את הרשומות"
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
          action={
            <Link className="btn btn-primary" to="/intake">
              לקליטת טפסים
            </Link>
          }
        >
          טפסים שייקלטו יופיעו כאן, עם הסטטוס שלהם.
        </EmptyState>
      ) : visible.length === 0 && filters.view === 'table' ? (
        <EmptyState
          icon={<SearchX size={26} />}
          title={
            filters.statuses.length === 1 && filters.statuses[0] === 'pending_review'
              ? 'אין טפסים ממתינים 🎉'
              : 'לא נמצאו טפסים שמתאימים לסינון'
          }
          action={
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => update({ q: '', statuses: [], from: null, to: null, yellow: false })}
            >
              ניקוי הסינון
            </button>
          }
        >
          אפשר לחפש מספר התחייבות, חלק מהשם, כמה ספרות מהת"ז, או תאריך כמו 20.10.
        </EmptyState>
      ) : filters.view === 'board' ? (
        <KanbanBoard
          forms={applyFilters(all, filters)}
          visibleStatuses={filters.statuses}
          duplicates={dupIndex}
          onShowColumn={(statuses) => update({ view: 'table', statuses })}
          onOpen={(id) => update({ view: 'table', open: id })}
        />
      ) : (
        <RecordsTable
          forms={visible}
          sort={filters.sort}
          dir={filters.dir}
          onSort={onSort}
          duplicates={dupIndex}
          onShowDuplicates={showDuplicates}
          openId={filters.open}
          onToggle={(id) => update({ open: filters.open === id ? null : id })}
          renderDetail={(id) => (
            <RecordDetail
              key={id}
              id={id}
              nextPending={nextPending}
              onDone={(next, message) => {
                setToast({ text: next ? message : `${message} · אין עוד טפסים ממתינים 🎉`, n: Date.now() })
                update({ open: next })
              }}
              onClose={() => update({ open: null })}
            />
          )}
        />
      )}

      <p className="toast" role="status" aria-live="polite" key={toast?.n}>
        {toast && (
          <>
            <CircleCheck size={18} aria-hidden="true" />
            {toast.text}
          </>
        )}
      </p>

      {merging && (
        <MergeDialog
          key={merging.key}
          group={merging}
          onClose={() => setMerging(null)}
          onMerged={(message) => {
            setMerging(null)
            setAnnouncement(message)
          }}
        />
      )}
    </>
  )
}
