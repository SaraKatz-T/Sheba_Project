import { useSyncExternalStore } from 'react'

export type LiveStatus = 'connecting' | 'open' | 'offline'

let status: LiveStatus = 'offline'
const listeners = new Set<() => void>()

export function getLiveStatus() {
  return status
}

export function setLiveStatus(next: LiveStatus) {
  if (next === status) return
  status = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLiveStatus() {
  return useSyncExternalStore(subscribe, getLiveStatus)
}
