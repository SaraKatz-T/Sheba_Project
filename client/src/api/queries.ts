import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query'
import { ApiError } from './client'
import { getSession, listDismissals, listForms, listTrash, listUploads } from './endpoints'
import { getLiveStatus } from './liveStatus'
import type { DuplicateDismissal, FormList, FormSummary, Upload, UploadList } from './types'

export const keys = {
  session: ['session'] as const,
  uploads: ['uploads'] as const,
  forms: ['forms'] as const,
  form: (id: string) => ['forms', id] as const,
  dismissals: ['duplicate-dismissals'] as const,
  trash: ['forms', 'trash'] as const,
}

/** The identity of a group of forms, whatever order the ids come in. */
export const groupKey = (formIds: string[]) => [...new Set(formIds)].sort().join('+')

export function useDismissals() {
  return useQuery({
    queryKey: keys.dismissals,
    queryFn: listDismissals,
    select: (data) => new Set(data.items.map((d) => groupKey(d.form_ids))),
    refetchInterval: () => (getLiveStatus() === 'open' ? SAFETY_POLL_MS : IDLE_POLL_MS),
  })
}

export function addDismissal(dismissal: DuplicateDismissal) {
  queryClient.setQueryData<{ items: DuplicateDismissal[] }>(keys.dismissals, (old) => {
    if (!old) return old
    const key = groupKey(dismissal.form_ids)
    return old.items.some((d) => groupKey(d.form_ids) === key) ? old : { items: [...old.items, dismissal] }
  })
}

// While the live connection is down, poll instead: fast while work is in flight,
// slowly otherwise (to pick up forms that arrive from the phone or another screen).
const FAST_POLL_MS = 2000
const IDLE_POLL_MS = 15_000
// Even with a live connection, an occasional full refresh corrects any drift.
const SAFETY_POLL_MS = 60_000

const FORM_IN_FLIGHT = new Set(['received', 'processing'])
const UPLOAD_IN_FLIGHT = new Set(['queued', 'splitting', 'processing'])
const isUploadInFlight = (u: Upload) => UPLOAD_IN_FLIGHT.has(u.status) && !u.paused

export function handleAuthError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(keys.session, false)
  }
}

// Server data lives only in this in-memory cache and is dropped on logout.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500 && error.status > 0) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      gcTime: 5 * 60_000,
    },
  },
})

function pollInterval(busy: boolean) {
  if (getLiveStatus() === 'open') return SAFETY_POLL_MS
  return busy ? FAST_POLL_MS : IDLE_POLL_MS
}

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        await getSession()
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return false
        throw e
      }
    },
    retry: false,
    staleTime: Infinity,
  })
}

export function useForms() {
  return useQuery({
    queryKey: keys.forms,
    queryFn: listForms,
    refetchInterval: (query) => {
      const data = query.state.data as FormList | undefined
      return pollInterval(!!data?.items.some((f) => FORM_IN_FLIGHT.has(f.status)))
    },
  })
}

export function useUploads() {
  return useQuery({
    queryKey: keys.uploads,
    queryFn: listUploads,
    refetchInterval: (query) => {
      const data = query.state.data as UploadList | undefined
      return pollInterval(!!data?.items.some(isUploadInFlight))
    },
  })
}

const newestFirst = (a: { received_at: string }, b: { received_at: string }) =>
  b.received_at.localeCompare(a.received_at)

/** Replaces (or adds) one upload in the cached list. */
export function upsertUpload(upload: Upload) {
  queryClient.setQueryData<UploadList>(keys.uploads, (old) => {
    if (!old) return old
    const items = old.items.filter((u) => u.id !== upload.id)
    items.push(upload)
    return { items: items.sort(newestFirst) }
  })
}

/** Drops an upload that left the intake queue, and the forms that left the list with it. */
export function dropUpload(uploadId: string, formIds: string[]) {
  queryClient.setQueryData<UploadList>(keys.uploads, (old) =>
    old && { items: old.items.filter((u) => u.id !== uploadId) },
  )
  dropForms(formIds)
}

/** Forms that left the records list (moved to the trash, or deleted with their file). */
export function dropForms(formIds: string[]) {
  if (!formIds.length) return
  const gone = new Set(formIds)
  queryClient.setQueryData<FormList>(keys.forms, (old) => old && { items: old.items.filter((f) => !gone.has(f.id)) })
  formIds.forEach((id) => queryClient.removeQueries({ queryKey: keys.form(id), exact: true }))
  void queryClient.invalidateQueries({ queryKey: keys.trash, exact: true })
}

/** The trash: forms deleted in the last 30 days, newest first. */
export function useTrash() {
  return useQuery({ queryKey: keys.trash, queryFn: listTrash })
}

/** Replaces (or adds) one form in the cached list and refreshes its open detail view. */
export function upsertForm(form: FormSummary) {
  if (form.deleted_at) return dropForms([form.id])   // in the trash: not part of the records list
  queryClient.setQueryData<FormList>(keys.forms, (old) => {
    if (!old) return old
    // An updated form keeps its place (approving a row must not move it); a new one is added.
    const i = old.items.findIndex((f) => f.id === form.id)
    if (i >= 0) return { items: old.items.map((f, j) => (j === i ? form : f)) }
    return { items: [...old.items, form].sort(newestFirst) }
  })
  void queryClient.invalidateQueries({ queryKey: keys.form(form.id), exact: true })
}
