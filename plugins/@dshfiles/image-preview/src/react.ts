/** Read one preview route into a blob URL the page owns, so the image never loads as a document. */
import { useEffect, useState } from 'react'
import { ImagePreview, type ImagePreviewRefusal } from './image-preview.ts'

export type ImagePreviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly src: string }
  | { readonly kind: 'refused'; readonly refusal: ImagePreviewRefusal }
  | { readonly kind: 'error' }

export interface ImagePreviewRead {
  readonly state: ImagePreviewState
  readonly retry: () => void
}

/**
 * Fetch the image once per URL and per retry; the blob URL is revoked when the URL changes or the viewer unmounts.
 * @param url - a document-relative preview route.
 * @returns the read's state and a retry for an error.
 */
export const useImagePreview = (url: string): ImagePreviewRead => {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ImagePreviewState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({ kind: 'loading' })
    fetch(url, { signal: controller.signal })
      .then(async response => {
        const refusal = ImagePreview.refusalOf(response.status)
        if (refusal !== undefined) return setState({ kind: 'refused', refusal })
        if (!response.ok) return setState({ kind: 'error' })
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ kind: 'ready', src: objectUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      })
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [url, attempt])
  return { state, retry: () => setAttempt(value => value + 1) }
}
