import { ArrowDown, ArrowUp, ChevronDown, FlaskConical, Smartphone, Trash2, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { FormSummary } from '../api/types'
import { StatusChip, YellowChip } from '../components/StatusChip'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
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
  { key: null, label: '', className: 'col-select' },
  { key: 'commitment', label: 'מספר התחייבות' },
  { key: 'first_name', label: 'שם פרטי' },
  { key: 'name', label: 'שם משפחה' },
  { key: 'id', label: 'ת"ז' },
  { key: null, label: 'מספר מרכזי' },
  { key: null, label: 'שולח' },
  { key: 'form_date', label: 'תאריך הטופס' },
  // "Received" is the same for every form in a file, so it's shown once in the file's header row.
  { key: 'status', label: 'סטטוס' },
  { key: 'uncertain', label: 'לבדיקה', className: 'col-count' },
  { key: null, label: '', className: 'col-action' },
]

// The same widths in every file's table, so the columns line up from one table to the next.
const COLUMN_WIDTHS = ['3%', '12%', '10%', '10%', '10%', '9%', '14%', '10%', '11%', '7%', '4%']

// The field keys each column shows, so a cell turns yellow while one of them is still open.
const CELL_KEYS = {
  commitment: ['commitment_number'],
  first_name: ['first_name'],
  last_name: ['last_name', 'full_name'],
  id: ['id_number'],
  central: ['central_numbers'],
  sender: ['sender'],
  date: ['received_date', 'form_date'],
}

function yellow(f: FormSummary, cell: keyof typeof CELL_KEYS, className = '') {
  const open = f.status === 'pending_review' && CELL_KEYS[cell].some((k) => f.uncertain_keys?.includes(k))
  return `${className}${open ? ' cell-yellow' : ''}`.trim() || undefined
}

/**
 * An empty cell: "not found" once the form was read, a dash while it is still being read.
 * `sent` is false when the server didn't send this field at all (an older server): that's
 * not "not found", so it gets a dash too.
 */
function Missing({ form, sent = true }: { form: FormSummary; sent?: boolean }) {
  const read = form.status !== 'received' && form.status !== 'processing' && form.status !== 'failed'
  return <span className="muted">{read && sent ? 'לא נמצא' : '—'}</span>
}

/** A record still being read can't be deleted here; it is stopped from the intake queue. */
export const canDelete = (f: FormSummary) => f.status !== 'received' && f.status !== 'processing'

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
  openId: string | null
  onToggle: (id: string) => void
  renderDetail: (id: string) => ReactNode
  /** Records ticked for a bulk action (delete). */
  selected: Set<string>
  onSelect: (ids: string[], on: boolean) => void
  /** Asks to move these records (all the deletable ones of one file) to the trash. */
  onDelete: (ids: string[]) => void
}

export function RecordsTable({ forms, sort, dir, onSort, openId, onToggle, renderDetail, selected, onSelect, onDelete }: Props) {
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

  const head = (fileForms: FormSummary[], fileName: string) => {
    const ids = fileForms.filter(canDelete).map((f) => f.id)
    const ticked = ids.filter((id) => selected.has(id)).length
    return (
    <thead>
      <tr>
        {COLUMNS.map((col, i) => {
          if (col.className === 'col-select') {
            return (
              <th key={i} scope="col" className="col-select">
                <input
                  type="checkbox"
                  aria-label={`בחירת כל הטפסים בקובץ ${fileName}`}
                  checked={ids.length > 0 && ticked === ids.length}
                  ref={(el) => {
                    if (el) el.indeterminate = ticked > 0 && ticked < ids.length
                  }}
                  disabled={ids.length === 0}
                  onChange={(e) => onSelect(ids, e.target.checked)}
                />
              </th>
            )
          }
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
  }

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
              <span className="file-head-date">
                התקבל <span className="num">{formatDateTime(file.received_at)}</span>
              </span>
              {group.forms.some(canDelete) && (
                <button
                  type="button"
                  className="icon-btn file-head-delete"
                  onClick={() => onDelete(group.forms.filter(canDelete).map((f) => f.id))}
                  aria-label={`מחיקת הקובץ ${file.file_name}`}
                  title="מחיקת הקובץ (כל הטפסים שלו)"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </header>
            <div className="table-scroll">
              <table className="records">
                <caption className="visually-hidden">
                  טפסים מהקובץ {file.file_name}, ממוינים לפי {COLUMNS.find((c) => c.key === sort)?.label ?? 'התקבל'}. לחיצה על שורה
                  פותחת את הטופס.
                </caption>
                <colgroup>
                  {COLUMN_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                {head(group.forms, file.file_name)}
                <tbody>
                  {group.forms.map((f) => {
                    // Every row opens, approved ones too: their fields can still be corrected.
                    const open = f.id === openId
                    return [
                      <tr
                        key={f.id}
                        id={`row-${f.id}`}
                        className={open ? 'is-open' : undefined}
                        onClick={(e) =>
                          !(e.target as Element).closest('a, input, label, button:not(.row-toggle)') && onToggle(f.id)
                        }
                      >
                        <td className="col-select">
                          <input
                            type="checkbox"
                            aria-label={`בחירת הטופס ${f.commitment_number ?? ''}`}
                            checked={selected.has(f.id)}
                            disabled={!canDelete(f)}
                            title={canDelete(f) ? undefined : 'הטופס עוד בעיבוד'}
                            onChange={(e) => onSelect([f.id], e.target.checked)}
                          />
                        </td>
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
                          </div>
                        </td>
                        <td className={yellow(f, 'first_name', 'cell-name')}>
                          {f.first_name || <Missing form={f} sent={f.first_name !== undefined} />}
                        </td>
                        <td className={yellow(f, 'last_name', 'cell-name')}>
                          {/* A server that doesn't send the split names: the full name stays in one cell */}
                          {(f.first_name === undefined ? f.person_name : f.last_name) || <Missing form={f} />}
                        </td>
                        <td className={yellow(f, 'id')}>
                          {f.id_number ? <span className="ltr num">{f.id_number}</span> : <Missing form={f} />}
                        </td>
                        <td className={yellow(f, 'central')}>
                          {f.central_number ? (
                            <span className="ltr num">{f.central_number}</span>
                          ) : (
                            <Missing form={f} sent={f.central_number !== undefined} />
                          )}
                        </td>
                        <td className={yellow(f, 'sender', 'cell-name')}>
                          {f.sender || <Missing form={f} sent={f.sender !== undefined} />}
                        </td>
                        <td className={yellow(f, 'date')}>
                          {f.form_date ? <span className="num">{formatDate(f.form_date)}</span> : <Missing form={f} />}
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
