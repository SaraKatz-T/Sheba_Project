// Duplicates among live forms (rejected ones, including merged ones, no longer count,
// so resolving a group makes it disappear):
// - 'form':   the same commitment number twice — the same paper captured again.
// - 'person': the same ID number on forms with different commitment numbers —
//             either two real forms of one patient, or a misread ID.
import { useSyncExternalStore } from 'react'
import type { FormSummary } from '../api/types'

export type DuplicateKind = 'form' | 'person'

export interface DuplicateGroup {
  key: string
  kind: DuplicateKind
  /** The shared commitment number ('form') or ID number ('person'). */
  value: string
  forms: FormSummary[]
}

const digitsOnly = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '')

// Groups the user marked as "keep both", for this session only.
let dismissed = new Set<string>()
const listeners = new Set<() => void>()

export function dismissGroup(key: string) {
  dismissed = new Set(dismissed).add(key)
  listeners.forEach((l) => l())
}

export function resetDismissedDuplicates() {
  dismissed = new Set()
  listeners.forEach((l) => l())
}

export function useDismissedDuplicates(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => dismissed,
  )
}

function groupBy(forms: FormSummary[], pick: (f: FormSummary) => string | null) {
  const map = new Map<string, FormSummary[]>()
  for (const f of forms) {
    const raw = pick(f)
    const value = raw ? digitsOnly(raw) : ''
    if (value) map.set(value, [...(map.get(value) ?? []), f])
  }
  return [...map].filter(([, group]) => group.length > 1)
}

const idsKey = (forms: FormSummary[]) =>
  forms
    .map((f) => f.id)
    .sort()
    .join('+')

export function findDuplicates(forms: FormSummary[], skip: Set<string>): DuplicateGroup[] {
  const live = forms.filter((f) => f.status !== 'rejected')
  const groups: DuplicateGroup[] = []
  const seen = new Set<string>()

  for (const [kind, pick] of [
    ['form', (f: FormSummary) => f.commitment_number],
    ['person', (f: FormSummary) => f.id_number],
  ] as const) {
    for (const [value, group] of groupBy(live, pick)) {
      const ids = idsKey(group)
      // The same forms grouped by commitment number need not show again by ID.
      if (seen.has(ids)) continue
      seen.add(ids)
      // The key changes when a new form joins, so a dismissed group comes back if it grows.
      const key = `${kind}:${ids}`
      if (skip.has(key)) continue
      groups.push({
        key,
        kind,
        value,
        forms: [...group].sort((a, b) => a.received_at.localeCompare(b.received_at)),
      })
    }
  }
  // Same-form duplicates first: they are almost always real.
  return groups.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'form' ? -1 : 1) ||
      b.forms.at(-1)!.received_at.localeCompare(a.forms.at(-1)!.received_at),
  )
}

/** Form id → the first group it belongs to, for marking rows. */
export function duplicateIndex(groups: DuplicateGroup[]): Map<string, DuplicateGroup> {
  const index = new Map<string, DuplicateGroup>()
  for (const g of groups) for (const f of g.forms) if (!index.has(f.id)) index.set(f.id, g)
  return index
}
