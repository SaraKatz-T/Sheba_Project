// The same ID number on more than one live form. Rejected forms (including merged
// ones) no longer count, so resolving a group makes it disappear.
import { useSyncExternalStore } from 'react'
import type { FormSummary } from '../api/types'

export interface DuplicateGroup {
  key: string
  idNumber: string
  forms: FormSummary[]
  /** All forms carry the same form date: very likely the same paper scanned twice. */
  sameFormDate: boolean
}

const normalizeId = (id: string) => id.replace(/\D/g, '').replace(/^0+/, '')

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

export function findDuplicates(forms: FormSummary[], skip: Set<string>): DuplicateGroup[] {
  const byId = new Map<string, FormSummary[]>()
  for (const f of forms) {
    if (!f.id_number || f.status === 'rejected') continue
    const id = normalizeId(f.id_number)
    if (!id) continue
    byId.set(id, [...(byId.get(id) ?? []), f])
  }

  const groups: DuplicateGroup[] = []
  for (const [idNumber, group] of byId) {
    if (group.length < 2) continue
    // The key changes when a new form joins, so a dismissed group comes back if it grows.
    const key = group
      .map((f) => f.id)
      .sort()
      .join('+')
    if (skip.has(key)) continue
    const dates = new Set(group.map((f) => f.form_date))
    groups.push({
      key,
      idNumber,
      forms: [...group].sort((a, b) => a.received_at.localeCompare(b.received_at)),
      sameFormDate: dates.size === 1 && !dates.has(null),
    })
  }
  return groups.sort((a, b) => b.forms.at(-1)!.received_at.localeCompare(a.forms.at(-1)!.received_at))
}

/** Form id → the group it belongs to, for marking rows. */
export function duplicateIndex(groups: DuplicateGroup[]): Map<string, DuplicateGroup> {
  const index = new Map<string, DuplicateGroup>()
  for (const g of groups) for (const f of g.forms) index.set(f.id, g)
  return index
}
