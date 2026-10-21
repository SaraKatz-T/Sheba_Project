import { useEffect, useState } from 'react'
import { fetchImage } from '../api/endpoints'

/**
 * Page images of one form, each fetched once and shared by every crop and the full viewer.
 * Lives only while the form is open; dispose() releases the memory.
 */
export class PageImageCache {
  private pending = new Map<string, Promise<string>>()
  private urls: string[] = []
  private disposed = false

  get(url: string): Promise<string> {
    let p = this.pending.get(url)
    if (!p) {
      p = fetchImage(url).then((objectUrl) => {
        if (this.disposed) URL.revokeObjectURL(objectUrl)
        else this.urls.push(objectUrl)
        return objectUrl
      })
      // A failed load may be retried later.
      p.catch(() => this.pending.delete(url))
      this.pending.set(url, p)
    }
    return p
  }

  dispose() {
    this.disposed = true
    this.urls.forEach((u) => URL.revokeObjectURL(u))
    this.urls = []
    this.pending.clear()
  }

  /** Back in use after a dispose (React may unmount and remount the same component). */
  revive() {
    this.disposed = false
  }
}

/** One cache per mounted component, released on unmount and safe under StrictMode's double effects. */
export function usePageImageCache(): PageImageCache {
  const [cache] = useState(() => new PageImageCache())
  useEffect(() => {
    cache.revive()
    return () => cache.dispose()
  }, [cache])
  return cache
}

export type ImageState = { status: 'loading' } | { status: 'ready'; src: string } | { status: 'error' }

export function useCachedImage(cache: PageImageCache, url: string | null): ImageState {
  const [state, setState] = useState<ImageState>({ status: 'loading' })
  useEffect(() => {
    if (!url) return
    let live = true
    setState({ status: 'loading' })
    cache.get(url).then(
      (src) => live && setState({ status: 'ready', src }),
      () => live && setState({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [cache, url])
  return url ? state : { status: 'error' }
}
