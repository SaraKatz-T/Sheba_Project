import { CircleAlert, Columns3, Inbox, LoaderCircle, RefreshCw, SearchX, Table2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForms } from '../api/queries'
import type { FormStatus } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { formatNumber } from '../lib/format'
import { DuplicatesPanel } from '../records/DuplicatesPanel'
import { duplicateIndex, findDuplicates, useDismissedDuplicates, type DuplicateGroup } from '../records/duplicates'
import { applyFilters, hasActiveFilters, readFilters, sortForms, writeFilters, type Filters, type SortKey } from '../records/filters'
import { KanbanBoard } from '../records/KanbanBoard'
import { MergeDialog } from '../records/MergeDialog'
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

  const onSort = (key: SortKey) =>
    update(
      key === filters.sort
        ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: key === 'name' || key === 'id' || key === 'status' ? 'asc' : 'desc' },
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

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <DuplicatesPanel
        groups={groups}
        open={dupsOpen}
        onToggle={() => setDupsOpen((o) => !o)}
        onMerge={setMerging}
        onAnnounce={setAnnouncement}
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
          title="לא נמצאו טפסים שמתאימים לסינון"
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
          אפשר לחפש חלק מהשם, כמה ספרות מהת"ז, או תאריך כמו 20.10.
        </EmptyState>
      ) : filters.view === 'board' ? (
        <KanbanBoard
          forms={applyFilters(all, filters)}
          visibleStatuses={filters.statuses}
          duplicates={dupIndex}
          onShowColumn={(statuses) => update({ view: 'table', statuses })}
        />
      ) : (
        <RecordsTable
          forms={visible}
          sort={filters.sort}
          dir={filters.dir}
          onSort={onSort}
          duplicates={dupIndex}
          onShowDuplicates={showDuplicates}
        />
      )}

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
