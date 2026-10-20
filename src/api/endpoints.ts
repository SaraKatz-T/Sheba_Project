import { API_BASE, ApiError, errorFromResponse, json, messageForStatus, request } from './client'
import type {
  CaptureSession,
  CaptureUploadResult,
  DuplicateDismissal,
  Field,
  FieldValueSource,
  FormDetail,
  FormList,
  FormSource,
  FormSummary,
  Session,
  Upload,
  UploadList,
} from './types'

const enc = encodeURIComponent

// Auth

export const login = (password: string) =>
  request<void>('/auth/login', { method: 'POST', ...json({ password }) })

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

export const getSession = () => request<Session>('/auth/session')

// Uploads

export const listUploads = () => request<UploadList>('/uploads')

export const getUpload = (id: string) => request<Upload>(`/uploads/${enc(id)}`)

export const retryUpload = (id: string) =>
  request<Upload>(`/uploads/${enc(id)}/retry`, { method: 'POST' })

// Forms

export const listForms = () => request<FormList>('/forms')

export const getForm = (id: string) => request<FormDetail>(`/forms/${enc(id)}`)

export const updateField = (id: string, key: string, value: string, source: FieldValueSource) =>
  request<Field>(`/forms/${enc(id)}/fields/${enc(key)}`, {
    method: 'PATCH',
    ...json({ value, source }),
  })

export const approveForm = (id: string) =>
  request<FormSummary>(`/forms/${enc(id)}/approve`, { method: 'POST' })

export const rejectForm = (id: string, reason?: string) =>
  request<FormSummary>(`/forms/${enc(id)}/reject`, { method: 'POST', ...json({ reason }) })

export const retryForm = (id: string) =>
  request<FormSummary>(`/forms/${enc(id)}/retry`, { method: 'POST' })

export const mergeForm = (id: string, into: string, values: Record<string, string>) =>
  request<FormSummary>(`/forms/${enc(id)}/merge`, { method: 'POST', ...json({ into, values }) })

// Duplicate decisions

export const listDismissals = () => request<{ items: DuplicateDismissal[] }>('/duplicate-dismissals')

export const createDismissal = (formIds: string[]) =>
  request<DuplicateDismissal>('/duplicate-dismissals', { method: 'POST', ...json({ form_ids: formIds }) })

/** Fetches an API image (page, thumbnail) into memory only; the caller must revoke the URL. */
export async function fetchImage(imageUrl: string, signal?: AbortSignal): Promise<string> {
  let res: Response
  try {
    res = await fetch(imageUrl, { credentials: 'same-origin', cache: 'no-store', signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError(0, 'network', messageForStatus(0))
  }
  if (!res.ok) throw await errorFromResponse(res)
  return URL.createObjectURL(await res.blob())
}

// Uploads use XHR because fetch has no upload progress events.

export interface UploadOptions {
  file: File
  sha256: string
  source?: FormSource
  force?: boolean
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

function upload<T>(path: string, parts: Record<string, string | Blob>, opts: UploadOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const body = new FormData()
    for (const [name, part] of Object.entries(parts)) {
      if (part instanceof File) body.append(name, part, part.name)
      else body.append(name, part)
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_BASE + path)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new ApiError(0, 'network', messageForStatus(0)))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
    xhr.onload = () => {
      const res = new Response(xhr.responseText || null, { status: xhr.status })
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1)
        resolve(JSON.parse(xhr.responseText) as T)
      } else {
        errorFromResponse(res).then(reject, reject)
      }
    }
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

export const createUpload = (opts: UploadOptions) =>
  upload<Upload>(
    '/uploads',
    {
      file: opts.file,
      sha256: opts.sha256,
      source: opts.source ?? 'upload',
      ...(opts.force ? { force: 'true' } : {}),
    },
    opts,
  )

// Phone capture

export const createCaptureSession = () =>
  request<CaptureSession>('/capture-sessions', { method: 'POST' })

export const checkCaptureSession = (token: string) =>
  request<{ expires_at: string }>(`/capture/${enc(token)}`)

export const uploadCapture = (token: string, opts: UploadOptions) =>
  upload<CaptureUploadResult>(
    `/capture/${enc(token)}/uploads`,
    { file: opts.file, sha256: opts.sha256 },
    opts,
  )
