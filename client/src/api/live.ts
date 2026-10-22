// Live updates over /api/live. Every message carries a full object, so the client just
// replaces its copy. After each (re)connect the lists are reloaded, so messages missed
// while disconnected do not matter; while disconnected the queries fall back to polling.
import { API_BASE } from './client'
import { addDismissal, dropForms, dropUpload, keys, queryClient, upsertForm, upsertUpload } from './queries'
import { setLiveStatus } from './liveStatus'
import type { LiveEvent } from './types'

const MAX_BACKOFF_MS = 30_000

let socket: WebSocket | null = null
let stopped = true
let attempt = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

function resync() {
  void queryClient.invalidateQueries({ queryKey: keys.uploads })
  void queryClient.invalidateQueries({ queryKey: keys.forms })
  void queryClient.invalidateQueries({ queryKey: keys.dismissals })
}

function apply(event: LiveEvent) {
  if (event.type === 'upload.updated') upsertUpload(event.upload)
  else if (event.type === 'form.updated') upsertForm(event.form)
  else if (event.type === 'duplicate_dismissal.created') addDismissal(event.dismissal)
  else if (event.type === 'upload.removed') dropUpload(event.upload_id, event.form_ids)
  else if (event.type === 'form.deleted') dropForms(event.form_ids)
}

function connect() {
  setLiveStatus('connecting')
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API_BASE}/live`
  const ws = new WebSocket(url)
  socket = ws

  ws.onopen = () => {
    attempt = 0
    setLiveStatus('open')
    resync()
  }

  ws.onmessage = (e) => {
    try {
      apply(JSON.parse(String(e.data)) as LiveEvent)
    } catch {
      // Ignore malformed messages; the next resync corrects any drift.
    }
  }

  ws.onclose = (e) => {
    if (socket !== ws) return
    socket = null
    if (e.code === 4401) {
      stopLive()
      queryClient.setQueryData(keys.session, false)
      return
    }
    if (stopped) return
    setLiveStatus('offline')
    resync()
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++)
    retryTimer = setTimeout(connect, backoff)
  }
}

export function startLive() {
  if (!stopped) return
  stopped = false
  attempt = 0
  connect()
}

export function stopLive() {
  stopped = true
  clearTimeout(retryTimer)
  const ws = socket
  socket = null
  ws?.close(1000)
  setLiveStatus('offline')
}
