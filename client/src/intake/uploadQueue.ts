// Files picked, dropped or pasted on the intake screen, until the server has them.
// Lives outside React so uploads keep going while the user moves to another screen.
// Everything here is in memory only and is cleared on logout.
import { useSyncExternalStore } from 'react'
import { ApiError } from '../api/client'
import { createUpload } from '../api/endpoints'
import { handleAuthError, keys, queryClient, upsertUpload } from '../api/queries'
import type { UploadList } from '../api/types'
import { isPreviewable, validateFile } from '../lib/files'
import { sha256Hex } from '../lib/sha256'

/**
 * There is no limit on how many files can be queued. This only caps how many travel
 * over the network at once, so the first files reach the server (and start being
 * processed) sooner and the live connection keeps a free browser connection.
 */
const PARALLEL_UPLOADS = 4

export type LocalPhase =
  | 'checking' // computing the fingerprint
  | 'waiting' // ready, waiting for a free upload slot
  | 'uploading'
  | 'duplicate' // needs a decision: send anyway or remove
  | 'invalid' // will not be sent (type, size, empty)
  | 'error' // sending failed; can retry
  | 'sent' // the server has it; from here on the Upload object is the source of truth

export interface Duplicate {
  kind: 'session' | 'server'
  fileName: string
  receivedAt: string | null
}

export interface LocalItem {
  key: string
  file: File
  /** Items added together share a batch; used to keep their order on screen. */
  batch: number
  order: number
  previewUrl: string | null
  phase: LocalPhase
  progress: number
  sha256: string | null
  message: string | null
  duplicate: Duplicate | null
  uploadId: string | null
  force: boolean
}

let items: LocalItem[] = []
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let seq = 0
let hashing = false

function commit(next: LocalItem[]) {
  items = next
  listeners.forEach((l) => l())
}

function patch(key: string, changes: Partial<LocalItem>) {
  commit(items.map((i) => (i.key === key ? { ...i, ...changes } : i)))
}

const exists = (key: string) => items.some((i) => i.key === key)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLocalQueue(): LocalItem[] {
  return useSyncExternalStore(subscribe, () => items)
}

export const isLocalBusy = (item: LocalItem) =>
  item.phase === 'checking' || item.phase === 'waiting' || item.phase === 'uploading'

/** Adds files to the queue and returns how many were added. */
export function addFiles(files: File[]): number {
  const batch = Date.now()
  const added = files.map((file, order): LocalItem => {
    const invalid = validateFile(file)
    return {
      key: `local-${++seq}`,
      file,
      batch,
      order,
      previewUrl: !invalid && isPreviewable(file) ? URL.createObjectURL(file) : null,
      phase: invalid ? 'invalid' : 'checking',
      progress: 0,
      sha256: null,
      message: invalid,
      duplicate: null,
      uploadId: null,
      force: false,
    }
  })
  commit([...items, ...added])
  pump()
  return added.length
}

/** Cancels a pending upload or drops a row that will not be sent. */
export function removeItem(key: string) {
  const item = items.find((i) => i.key === key)
  if (!item) return
  commit(items.filter((i) => i.key !== key))
  controllers.get(key)?.abort()
  controllers.delete(key)
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  pump()
}

export function sendAnyway(key: string) {
  patch(key, { phase: 'waiting', force: true, duplicate: null, message: null })
  pump()
}

export function retryItem(key: string) {
  patch(key, { phase: 'waiting', progress: 0, message: null })
  pump()
}

/** On logout: stop everything and forget every file. */
export function resetQueue() {
  controllers.forEach((c) => c.abort())
  controllers.clear()
  items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl))
  commit([])
}

function pump() {
  void hashNext()
  startUploads()
}

async function hashNext() {
  if (hashing) return
  const next = items.find((i) => i.phase === 'checking')
  if (!next) return
  hashing = true
  try {
    const sha = await sha256Hex(next.file)
    if (!exists(next.key)) return

    // The same file twice in this session, or already on the server today:
    // ask before sending, so the models never read the same form twice.
    const twin = items.find(
      (i) => i.key !== next.key && i.sha256 === sha && ['waiting', 'uploading', 'sent'].includes(i.phase),
    )
    const serverItems = queryClient.getQueryData<UploadList>(keys.uploads)?.items ?? []
    const known =
      serverItems.find((u) => twin?.uploadId && u.id === twin.uploadId) ??
      serverItems.find((u) => u.file_sha256 === sha)

    if (known) {
      patch(next.key, {
        sha256: sha,
        phase: 'duplicate',
        duplicate: { kind: 'server', fileName: known.file_name, receivedAt: known.received_at },
      })
    } else if (twin) {
      patch(next.key, {
        sha256: sha,
        phase: 'duplicate',
        duplicate: { kind: 'session', fileName: twin.file.name, receivedAt: null },
      })
    } else {
      patch(next.key, { sha256: sha, phase: 'waiting' })
    }
  } catch {
    if (exists(next.key)) {
      patch(next.key, { phase: 'error', message: 'לא הצלחנו לקרוא את הקובץ מהמחשב. כדאי לנסות שוב.' })
    }
  } finally {
    hashing = false
    pump()
  }
}

function startUploads() {
  let active = items.filter((i) => i.phase === 'uploading').length
  for (const item of items) {
    if (active >= PARALLEL_UPLOADS) break
    if (item.phase !== 'waiting' || !item.sha256) continue
    active++
    void send(item)
  }
}

async function send(item: LocalItem) {
  const controller = new AbortController()
  controllers.set(item.key, controller)
  patch(item.key, { phase: 'uploading', progress: 0 })
  let lastPaint = 0

  try {
    const upload = await createUpload({
      file: item.file,
      sha256: item.sha256!,
      force: item.force,
      signal: controller.signal,
      onProgress: (fraction) => {
        const now = performance.now()
        if (fraction === 1 || now - lastPaint > 120) {
          lastPaint = now
          if (exists(item.key)) patch(item.key, { progress: fraction })
        }
      },
    })
    if (!exists(item.key)) return
    upsertUpload(upload)
    patch(item.key, { phase: 'sent', progress: 1, uploadId: upload.id })
  } catch (e) {
    if (!exists(item.key)) return // cancelled
    handleAuthError(e)
    if (e instanceof ApiError && e.code === 'duplicate_file') {
      const existing = e.existingUpload
      patch(item.key, {
        phase: 'duplicate',
        duplicate: {
          kind: 'server',
          fileName: existing?.file_name ?? item.file.name,
          receivedAt: existing?.received_at ?? null,
        },
      })
    } else {
      patch(item.key, {
        phase: 'error',
        progress: 0,
        message: e instanceof ApiError ? e.message : 'השליחה נכשלה. כדאי לנסות שוב.',
      })
    }
  } finally {
    controllers.delete(item.key)
    startUploads()
  }
}
