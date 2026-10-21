import { ArrowDown, ArrowUp, ChevronDown, Copy, FlaskConical, Smartphone, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { FormSummary } from '../api/types'
import { StatusChip, YellowChip } from '../components/StatusChip'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import type { DuplicateGroup } from './duplicates'
import type { SortKey } from './filters'

const PAGE = 50

const SOURCE_ICON = { upload: Upload, phone: Smartphone, demo: FlaskConical }
const SOURCE_LABEL = { upload: 'הועלה מהמחשב', phone: 'צולם בטלפון', demo: 'הדגמה' }

interface Column {
  key: SortKey | null
  label: string
  className?: string
}

const COLUMNS: Column[] = [
  { key: 'commitment', label: 'מספר התחייבות' },
  { key: 'name', label: 'שם' },
  { key: 'id', label: 'ת"ז' },
  { key: 'form_date', label: 'תאריך הטופס' },
  { key: 'received', label: 'התקבל' },
  { key: 'status', label: 'סטטוס' },
  { key: 'uncertain', label: 'לבדיקה', className: 'col-count' },
  { key: null, label: '', className: 'col-action' },
]

// The same widths in every file's table, so the columns line up from one table to the next.
const COLUMN_WIDTHS = ['16%', '19%', '13%', '12%', '15%', '11%', '8%', '6%']

// The field keys each column shows, so a cell turns yellow while one of them is still open.
const CELL_KEYS = {
  commitment: ['commitment_number'],
  name: ['first_name', 'last_name', 'full_name'],
  id: ['id_number'],
  date: ['received_date', 'form_date'],
}

function yellow(f: FormSummary, cell: keyof typeof CELL_KEYS, className = '') {
  const open = f.status === 'pending_review' && CELL_KEYS[cell].some((k) => f.uncertain_keys?.includes(k))
  return `${className}${open ? ' cell-yellow' : ''}`.trim() || undefined
}

/** Rows grouped by the file they came from, keeping the table's order. */
function byFile(forms: FormSummary[]) {
  const groups: Array<{ uploadId: string; forms: FormSummary[] }> = []
  const index = new Map<string, number>()
  for (const f of forms) {
    const i = index.get(f.upload_id)
    if (i === undefined) {
      index.set(f.upload_id, groups.length)
      groups.push({ uploadId: f.upload_id, forms: [f] })
    } else {
      groups[i].forms.push(f)
    }
  }
  return groups
}

interface Props {
  forms: FormSummary[]
  sort: SortKey
  dir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  duplicates: Map<string, DuplicateGroup>
  onShowDuplicates: () => void
  openId: string | null
  onToggle: (id: string) => void
  renderDetail: (id: string) => ReactNode
}

export function RecordsTable({ forms, sort, dir, onSort, duplicates, onShowDuplicates, openId, onToggle, renderDetail }: Props) {
  const [limit, setLimit] = useState(PAGE)

  // A new search or sort starts again from the top of the list.
  useEffect(() => setLimit(PAGE), [sort, dir])

  // The open record is always within the rows shown, and in view.
  const openIndex = openId ? forms.findIndex((f) => f.id === openId) : -1
  useEffect(() => {
    if (openIndex >= limit) setLimit(Math.ceil((openIndex + 1) / PAGE) * PAGE)
  }, [openIndex, limit])
  useEffect(() => {
    if (openId) document.getElementById(`row-${openId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [openId])

  const groups = byFile(forms.slice(0, limit))

  const head = (
    <thead>
      <tr>
        {COLUMNS.map((col, i) => {
          const active = col.key !== null && col.key === sort
          return (
            <th
              key={i}
              scope="col"
              className={col.className}
              aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              {col.key ? (
                <button type="button" className="th-sort" onClick={() => onSort(col.key!)}>
                  {col.label}
                  {active &&
                    (dir === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />)}
                </button>
              ) : (
                col.label && <span>{col.label}</span>
              )}
            </th>
          )
        })}
      </tr>
    </thead>
  )

  return (
    <div className="file-tables">
      {groups.map((group) => {
        const file = group.forms[0]
        const SourceIcon = SOURCE_ICON[file.source]
        const titleId = `file-${group.uploadId}`
        return (
          <section key={group.uploadId} className="table-card file-card" aria-labelledby={titleId}>
            <header className="file-head">
              <SourceIcon size={16} aria-label={SOURCE_LABEL[file.source]} />
              <h2 id={titleId} className="file-head-name" title={file.file_name}>
                <bdi>{file.file_name}</bdi>
              </h2>
              <span className="file-head-count">
                {group.forms.length === 1 ? 'טופס אחד' : `${formatNumber(group.forms.length)} טפסים`}
              </span>
            </header>
            <div className="table-scroll">
              <table className="records">
                <caption className="visually-hidden">
                  טפסים מהקובץ {file.file_name}, ממוינים לפי {COLUMNS.find((c) => c.key === sort)?.label}. לחיצה על שורה
                  פותחת את הטופס.
                </caption>
                <colgroup>
                  {COLUMN_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                {head}
                <tbody>
                  {group.forms.map((f) => {
                    const dup = duplicates.get(f.id)
                    const open = f.id === openId
                    return [
                      <tr
                        key={f.id}
                        id={`row-${f.id}`}
                        className={open ? 'is-open' : undefined}
                        onClick={(e) => !(e.target as Element).closest('a, button:not(.row-toggle)') && onToggle(f.id)}
                      >
                        <td className={yellow(f, 'commitment')}>
                          <div className="cell-key">
                            <button
                              type="button"
                              className="row-toggle"
                              aria-expanded={open}
                              aria-controls={open ? `detail-${f.id}` : undefined}
                            >
                              {f.commitment_number ? (
                                <span className="ltr num">{f.commitment_number}</span>
                              ) : (
                                <span className="muted">{f.status === 'failed' ? 'לא נקרא' : 'טרם חולץ'}</span>
                              )}
                            </button>
                            {dup && (
                              <button
                                type="button"
                                className="chip chip-pending chip-button"
                                onClick={onShowDuplicates}
                                title={`מספר ההתחייבות הזה מופיע ב-${dup.forms.length} טפסים`}
                              >
                                <Copy size={12} aria-hidden="true" />
                                כפילות
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={yellow(f, 'name', 'cell-name')}>{f.person_name ?? <span className="muted">—</span>}</td>
                        <td className={yellow(f, 'id')}>
                          <span className="ltr num">{f.id_number ?? '—'}</span>
                        </td>
                        <td className={yellow(f, 'date')}>
                          <span className="num">{f.form_date ? formatDate(f.form_date) : '—'}</span>
                        </td>
                        <td>
                          <span className="num">{formatDateTime(f.received_at)}</span>
                        </td>
                        <td>
                          <StatusChip status={f.status} />
                        </td>
                        <td className="col-count">
                          {f.status === 'pending_review' && <YellowChip count={f.uncertain_count} />}
                        </td>
                        <td className="col-action">
                          <ChevronDown size={18} className="row-chevron" aria-hidden="true" />
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${f.id}-detail`} id={`detail-${f.id}`} className="detail-row">
                          <td colSpan={COLUMNS.length}>{renderDetail(f.id)}</td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
      {forms.length > limit && (
        <div className="table-more">
          <span className="muted">
            מוצגים {formatNumber(limit)} מתוך {formatNumber(forms.length)}
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setLimit((l) => l + PAGE)}>
            להציג עוד {formatNumber(Math.min(PAGE, forms.length - limit))}
          </button>
        </div>
      )}
    </div>
  )
}
