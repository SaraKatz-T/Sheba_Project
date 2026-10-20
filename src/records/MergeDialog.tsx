import { useMutation, useQueries } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, Merge, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { getForm, mergeForm } from '../api/endpoints'
import { keys, queryClient } from '../api/queries'
import type { FormDetail } from '../api/types'
import { StatusChip } from '../components/StatusChip'
import { formatDateTime } from '../lib/format'
import type { DuplicateGroup } from './duplicates'

interface Props {
  group: DuplicateGroup
  onClose: () => void
  onMerged: (message: string) => void
}

interface FieldChoice {
  key: string
  label: string
  options: Array<{ value: string; formIds: string[] }>
}

/** The approved form if there is one (its values are final), otherwise the earliest. */
function defaultKept(group: DuplicateGroup) {
  return (group.forms.find((f) => f.status === 'approved') ?? group.forms[0]).id
}

export function MergeDialog({ group, onClose, onMerged }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [keptId, setKeptId] = useState(() => defaultKept(group))
  const [choices, setChoices] = useState<Record<string, string>>({})

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const results = useQueries({
    queries: group.forms.map((f) => ({ queryKey: keys.form(f.id), queryFn: () => getForm(f.id) })),
  })
  const loading = results.some((r) => r.isPending)
  const loadError = results.find((r) => r.error)?.error
  const details = useMemo(
    () => new Map(results.filter((r) => r.data).map((r) => [r.data!.id, r.data as FormDetail])),
    [results],
  )

  const kept = details.get(keptId)
  const keptApproved = group.forms.find((f) => f.id === keptId)?.status === 'approved'

  // Every field, with the distinct non-empty values the forms hold for it.
  const fields = useMemo<FieldChoice[]>(() => {
    if (loading) return []
    const order: string[] = []
    const labels = new Map<string, string>()
    const values = new Map<string, Map<string, string[]>>()
    const all = [kept, ...[...details.values()].filter((d) => d.id !== keptId)].filter(Boolean) as FormDetail[]
    for (const d of all) {
      for (const field of d.fields) {
        if (!labels.has(field.key)) {
          order.push(field.key)
          labels.set(field.key, field.label)
          values.set(field.key, new Map())
        }
        if (!field.value.trim()) continue
        const byValue = values.get(field.key)!
        byValue.set(field.value, [...(byValue.get(field.value) ?? []), d.id])
      }
    }
    return order.map((key) => ({
      key,
      label: labels.get(key)!,
      options: [...values.get(key)!].map(([value, formIds]) => ({ value, formIds })),
    }))
  }, [loading, details, kept, keptId])

  const keptValue = (key: string) => kept?.fields.find((f) => f.key === key)?.value ?? ''
  const chosen = (f: FieldChoice) => (keptApproved ? keptValue(f.key) : (choices[f.key] ?? (keptValue(f.key) || f.options[0]?.value || '')))
  const conflicts = fields.filter((f) => f.options.length > 1)

  const formLabel = (id: string) => {
    const f = group.forms.find((x) => x.id === id)
    return f ? `התקבל ${formatDateTime(f.received_at)}` : id
  }

  const merge = useMutation({
    mutationFn: async () => {
      const values: Record<string, string> = {}
      for (const f of fields) {
        const v = chosen(f)
        if (v && v !== keptValue(f.key)) values[f.key] = v
      }
      const others = group.forms.filter((f) => f.id !== keptId)
      for (const [i, other] of others.entries()) {
        await mergeForm(other.id, keptId, i === 0 ? values : {})
      }
      return others.length
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: keys.forms })
      ref.current?.close()
      onMerged(count === 1 ? 'הטפסים מוזגו לטופס אחד.' : `${count + 1} הטפסים מוזגו לטופס אחד.`)
    },
  })

  const name = group.forms.find((f) => f.person_name)?.person_name ?? ''

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="dialog-head">
        <h2 id={titleId}>
          מיזוג טפסים של {name} <span className="ltr num muted">{group.idNumber}</span>
        </h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="סגירה">
          <X size={20} />
        </button>
      </header>

      <div className="dialog-body">
        <fieldset className="merge-keep">
          <legend>איזה טופס נשמר?</legend>
          <p className="muted">השאר יסומנו "נדחה" עם קישור לטופס הזה, כך ששום מידע לא נמחק.</p>
          {group.forms.map((f) => (
            <label key={f.id} className="merge-option">
              <input
                type="radio"
                name="kept"
                checked={keptId === f.id}
                onChange={() => {
                  setKeptId(f.id)
                  setChoices({})
                }}
              />
              <span className="merge-option-body">
                <strong className="num">התקבל {formatDateTime(f.received_at)}</strong>
                <span className="muted merge-option-file">{f.file_name}</span>
              </span>
              <StatusChip status={f.status} />
            </label>
          ))}
        </fieldset>

        {loading && (
          <p className="dialog-loading" role="status">
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            טוען את השדות של הטפסים…
          </p>
        )}
        {loadError && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {loadError.message}
          </p>
        )}

        {!loading && !loadError && (
          <section className="merge-fields" aria-label="השוואת שדות">
            <h3>
              {conflicts.length === 0
                ? 'כל השדות זהים בטפסים'
                : conflicts.length === 1
                  ? 'שדה אחד שונה בין הטפסים'
                  : `${conflicts.length} שדות שונים בין הטפסים`}
            </h3>
            {keptApproved && conflicts.length > 0 && (
              <p className="alert alert-info">הטופס שנשמר כבר אושר, ולכן הערכים שלו נשארים כמו שהם.</p>
            )}
            <div className="merge-table" role="table">
              {fields.map((f) => (
                <div key={f.key} className={f.options.length > 1 ? 'merge-row is-conflict' : 'merge-row'} role="row">
                  <span className="merge-label" role="rowheader">
                    {f.label}
                  </span>
                  <span className="merge-values" role="cell">
                    {f.options.length <= 1 ? (
                      <span className="merge-same">{f.options[0]?.value || <span className="muted">ריק</span>}</span>
                    ) : (
                      f.options.map((o) => (
                        <label key={o.value} className="merge-choice">
                          <input
                            type="radio"
                            name={`field-${f.key}`}
                            checked={chosen(f) === o.value}
                            disabled={keptApproved}
                            onChange={() => setChoices((c) => ({ ...c, [f.key]: o.value }))}
                          />
                          <span>{o.value}</span>
                          <span className="muted merge-choice-src">{o.formIds.map(formLabel).join(', ')}</span>
                        </label>
                      ))
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {merge.error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {merge.error.message}
          </p>
        )}
      </div>

      <footer className="dialog-foot">
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          ביטול
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => merge.mutate()}
          disabled={loading || !!loadError || merge.isPending}
        >
          {merge.isPending ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : (
            <Merge size={18} aria-hidden="true" />
          )}
          מיזוג לטופס אחד
        </button>
      </footer>
    </dialog>
  )
}
