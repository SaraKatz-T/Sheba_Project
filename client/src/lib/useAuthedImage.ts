import { useEffect, useState } from 'react'
import { fetchImage } from '../api/endpoints'

/**
 * Loads an image from the API (it needs the session) into memory and returns an object
 * URL for <img>, or null while loading or on failure. The URL is released on unmount.
 * Images go through fetch rather than <img src> so they also work against the in-page mock.
 */
export function useAuthedImage(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    if (!url) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchImage(url, controller.signal).then(
      (u) => {
        objectUrl = u
        setSrc(u)
      },
      () => setSrc(null),
    )
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return src
}
