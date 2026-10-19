import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query'
import { ApiError } from './client'
import { getSession, listForms } from './endpoints'
import type { FormList } from './types'

export const keys = {
  session: ['session'] as const,
  forms: ['forms'] as const,
  form: (id: string) => ['forms', id] as const,
}

const IN_FLIGHT = new Set(['received', 'processing'])
const POLL_MS = 2000
// Picks up forms that arrive from elsewhere (the phone, another screen).
const IDLE_POLL_MS = 15_000

function onApiError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(keys.session, false)
  }
}

// Server data lives only in this in-memory cache and is dropped on logout.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status > 0) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      gcTime: 5 * 60_000,
    },
  },
})

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
    // Poll while something is still being extracted, so progress updates live.
    refetchInterval: (query) => {
      const data = query.state.data as FormList | undefined
      return data?.items.some((f) => IN_FLIGHT.has(f.status)) ? POLL_MS : IDLE_POLL_MS
    },
  })
}
