// The overview screen: five headline numbers, then forms received per day over the last
// 30 days. Clicking a day opens that day in the records.
import { Clock3, ClipboardCheck, Inbox, ShieldCheck, Table as TableIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormSummary } from '../api/types'
import { formatNumber } from '../lib/format'
import { israelDateKey } from '../lib/hebrewSearch'
import { useNow } from '../lib/useNow'
import { computeMetrics, countByDay, formatAgo, formatDuration, type DayCount } from './metrics'

const DAYS = 30

const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' })
const dayMonth = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
const percent = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 0 })

const formsCount = (n: number) => (n === 0 ? 'אין טפסים' : n === 1 ? 'טופס אחד' : `${formatNumber(n)} טפסים`)

/** "אחד ממתין" / "3 ממתינים" / nothing for zero. */
const count = (n: number, one: string, many: string) => (n === 0 ? '' : n === 1 ? one : `${formatNumber(n)} ${many}`)

/** Fourteen tiny columns; today in the accent, the rest quiet. */
function Spark({ days }: { days: DayCount[] }) {
  const last = days.slice(-14)
  const max = Math.max(1, ...last.map((d) => d.total))
  const w = 6
  const gap = 2
  return (
    <svg className="spark" viewBox={`0 0 ${last.length * (w + gap) - gap} 28`} aria-hidden="true">
      {last.map((d, i) => {
        // Empty days stay a faint hairline so the rhythm of days is still visible.
        const h = d.total ? Math.max(3, (d.total / max) * 28) : 1
        // Oldest on the right, like the timeline below.
        const x = (last.length - 1 - i) * (w + gap)
        const kind = i === last.length - 1 ? 'spark-now' : d.total ? 'spark-bar' : 'spark-empty'
        return <rect key={d.key} x={x} y={28 - h} width={w} height={h} rx={d.total ? 1.5 : 0} className={kind} />
      })}
    </svg>
  )
}

interface Props {
  forms: FormSummary[]
  onSelectDay: (day: string) => void
  onStartReview: () => void
}

export function Overview({ forms, onSelectDay, onStartReview }: Props) {
  const now = useNow(60_000)
  const m = useMemo(() => computeMetrics(forms, now), [forms, now])
  const days = useMemo(() => countByDay(forms, DAYS, now), [forms, now])
  const todayKey = israelDateKey(new Date(now).toISOString())
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<string | null>(null)

  const max = Math.max(1, ...days.map((d) => d.total))
  // A clean top gridline: the max rounded up to an even number (or 1–4 as is).
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2
  const diff = m.today - m.yesterday

  const shownDay = hover ? days.find((d) => d.key === hover) : undefined

  return (
    <section className="overview" aria-label="סיכום">
      <div className="kpis">
        <article className="kpi">
          <span className="kpi-label">
            <Inbox size={16} aria-hidden="true" />
            טפסים היום
          </span>
          <span className="kpi-value">{formatNumber(m.today)}</span>
          <span className="kpi-row">
            <span className="kpi-sub">
              {diff === 0 ? 'כמו אתמול' : diff > 0 ? `${formatNumber(diff)} יותר מאתמול` : `${formatNumber(-diff)} פחות מאתמול`}
            </span>
            <Spark days={days} />
          </span>
        </article>

        <button type="button" className="kpi kpi-action" onClick={onStartReview} disabled={m.pending === 0}>
          <span className="kpi-label">
            <ClipboardCheck size={16} aria-hidden="true" />
            ממתינים לבדיקה
          </span>
          <span className="kpi-value">{formatNumber(m.pending)}</span>
          <span className="kpi-sub">
            {m.pending === 0 ? 'אין טפסים ממתינים' : `הוותיק ביותר ${formatAgo(m.oldestWaitMs ?? 0)}`}
          </span>
        </button>

        <article className="kpi">
          <span className="kpi-label">
            <ShieldCheck size={16} aria-hidden="true" />
            אושרו
          </span>
          <span className="kpi-value">{formatNumber(m.approved)}</span>
          <span className="kpi-sub">{m.approvedToday ? `${formatNumber(m.approvedToday)} היום` : 'עוד לא אושרו טפסים היום'}</span>
        </article>

        <article className="kpi">
          <span className="kpi-label">אושרו בלי תיקון</span>
          <span className="kpi-value">{m.cleanShare === null ? '—' : percent.format(m.cleanShare)}</span>
          {m.cleanShare !== null && (
            <span
              className="meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(m.cleanShare * 100)}
              aria-label="אושרו בלי תיקון"
            >
              <span style={{ width: `${m.cleanShare * 100}%` }} />
            </span>
          )}
          <span className="kpi-sub">
            {m.approved ? `${formatNumber(m.cleanCount)} מתוך ${formatNumber(m.approved)}` : 'אין עדיין טפסים מאושרים'}
          </span>
        </article>

        <article className="kpi">
          <span className="kpi-label">
            <Clock3 size={16} aria-hidden="true" />
            זמן טיפול ממוצע
          </span>
          <span className="kpi-value">{m.avgHandlingMs === null ? '—' : formatDuration(m.avgHandlingMs)}</span>
          <span className="kpi-sub">מהקליטה ועד האישור</span>
        </article>
      </div>

      <figure className="timeline" aria-labelledby="timeline-title">
        <figcaption className="timeline-head">
          <span>
            <strong id="timeline-title">טפסים לפי יום קליטה</strong>
            <span className="muted"> · 30 הימים האחרונים · לחיצה על יום פותחת את הטפסים שלו</span>
          </span>
          <span className="timeline-readout" aria-live="polite">
            {shownDay ? (
              <>
                <strong>
                  {weekday.format(shownDay.date)} {dayMonth.format(shownDay.date)}
                </strong>
                {' · '}
                {formsCount(shownDay.total)}
                {shownDay.total > 0 &&
                  ` (${[
                    count(shownDay.pending, 'אחד ממתין', 'ממתינים'),
                    count(shownDay.approved, 'אחד אושר', 'אושרו'),
                    count(shownDay.other, 'אחד אחר', 'אחרים'),
                  ]
                    .filter(Boolean)
                    .join(', ')})`}
              </>
            ) : null}
          </span>
          <button
            type="button"
            className="link-btn timeline-table-toggle"
            aria-pressed={asTable}
            onClick={() => setAsTable((t) => !t)}
          >
            <TableIcon size={15} aria-hidden="true" />
            {asTable ? 'הצגה כתרשים' : 'הצגה כטבלה'}
          </button>
        </figcaption>

        {asTable ? (
          <div className="timeline-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">יום</th>
                  <th scope="col">טפסים</th>
                  <th scope="col">ממתינים</th>
                  <th scope="col">אושרו</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.key}>
                    <td>
                      {weekday.format(d.date)} {dayMonth.format(d.date)}
                    </td>
                    <td>{formatNumber(d.total)}</td>
                    <td>{formatNumber(d.pending)}</td>
                    <td>{formatNumber(d.approved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="timeline-plot">
            <span className="timeline-grid" aria-hidden="true">
              <span className="timeline-gridline" style={{ bottom: '100%' }}>
                <span className="timeline-tick">{formatNumber(top)}</span>
              </span>
              <span className="timeline-gridline" style={{ bottom: '50%' }}>
                <span className="timeline-tick">{formatNumber(top / 2)}</span>
              </span>
            </span>
            <ol className="timeline-days">
              {days.map((d, i) => {
                const isToday = d.key === todayKey
                // Every fifth day, plus today; never two labels side by side.
                const nearKey = (k: string) => {
                  const j = days.findIndex((x) => x.key === k)
                  return j >= 0 && j !== i && Math.abs(j - i) <= 2
                }
                const regular = d.date.getUTCDate() % 5 === 0 && !nearKey(todayKey)
                const label = isToday ? 'היום' : regular ? dayMonth.format(d.date) : ''
                const weekend = d.date.getUTCDay() === 6
                return (
                  <li key={d.key} className={weekend ? 'is-weekend' : undefined}>
                    <button
                      type="button"
                      className={`day${isToday ? ' is-today' : ''}`}
                      aria-label={`${weekday.format(d.date)} ${dayMonth.format(d.date)}: ${formsCount(d.total)}`}
                      onClick={() => onSelectDay(d.key)}
                      onPointerEnter={() => setHover(d.key)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(d.key)}
                      onBlur={() => setHover(null)}
                    >
                      <span className="day-plot">
                        {isToday && d.total > 0 && (
                          <span className="day-value" style={{ bottom: `${(d.total / top) * 100}%` }}>
                            {formatNumber(d.total)}
                          </span>
                        )}
                        <span className="day-bar" style={{ height: `${(d.total / top) * 100}%` }} />
                      </span>
                      <span className="day-label">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </figure>
    </section>
  )
}
