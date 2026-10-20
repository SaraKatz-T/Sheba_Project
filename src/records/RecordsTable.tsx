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
  { key: null, label: 'קובץ', className: 'col-file' },
  { key: 'status', label: 'סטטוס' },
  { key: 'uncertain', label: 'לבדיקה', className: 'col-count' },
  { key: null, label: '', className: 'col-action' },
]

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

  const shown = forms.slice(0, limit)

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="records">
          <caption className="visually-hidden">
            טפסים, ממוינים לפי {COLUMNS.find((c) => c.key === sort)?.label}. לחיצה על שורה פותחת את הטופס.
          </caption>
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
          <tbody>
            {shown.map((f) => {
              const SourceIcon = SOURCE_ICON[f.source]
              const dup = duplicates.get(f.id)
              const open = f.id === openId
              return [
                <tr
                  key={f.id}
                  id={`row-${f.id}`}
                  className={open ? 'is-open' : undefined}
                  onClick={(e) => !(e.target as Element).closest('a, button:not(.row-toggle)') && onToggle(f.id)}
                >
                  <td>
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
                          title={
                            dup.kind === 'form'
                              ? `מספר ההתחייבות הזה מופיע ב-${dup.forms.length} טפסים`
                              : `הת"ז הזו מופיעה ב-${dup.forms.length} טפסים`
                          }
                        >
                          <Copy size={12} aria-hidden="true" />
                          כפילות
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="cell-name">{f.person_name ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className="ltr num">{f.id_number ?? '—'}</span>
                  </td>
                  <td>
                    <span className="num">{f.form_date ? formatDate(f.form_date) : '—'}</span>
                  </td>
                  <td>
                    <span className="num">{formatDateTime(f.received_at)}</span>
                  </td>
                  <td className="col-file">
                    <span className="cell-file" title={`${SOURCE_LABEL[f.source]}: ${f.file_name}`}>
                      <SourceIcon size={15} aria-label={SOURCE_LABEL[f.source]} />
                      <span className="cell-file-name">{f.file_name}</span>
                    </span>
                  </td>
                  <td>
                    <StatusChip status={f.status} />
                  </td>
                  <td className="col-count">{f.status === 'pending_review' && <YellowChip count={f.uncertain_count} />}</td>
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
