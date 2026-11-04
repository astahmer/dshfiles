import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { LoaderCircleIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import type { MessageImageGallery } from '@dshfiles/chat/message-images'
import { ImageLightbox, type ImageLightboxLabels, type LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import styles from './MessageImage.module.css'
import { historicalImageQueue, type ImageLoadQueue } from './image-load-queue.js'

type MessageImageSource = MessageImagesProps['images'][number]
type MessageImageLoader = MessageImagesProps['loadImage']
export type ImageLabels = {
  image: string
  open: string
  openNamed: (label: string) => string
  loading: string
  loadFailed: string
  lightbox: ImageLightboxLabels
}
type ImageVariant = 'single' | 'tile' | 'thumbnail'
type ImageDimensions = { readonly width: number; readonly height: number }

function sourceKey(image: MessageImageSource, index: number): string {
  return 'attachment' in image ? `${image.attachment.attachmentId}:${index}` : `${image.preview.url}:${index}`
}

function sourceLabel(image: MessageImageSource, fallback: string): string {
  if ('attachment' in image) return image.label ?? image.attachment.name ?? fallback
  return image.preview.name ?? fallback
}

function sourceDimensions(image: MessageImageSource): ImageDimensions | undefined {
  if ('attachment' in image) return image.attachment
  if (image.preview.width === undefined || image.preview.height === undefined) return undefined
  return { width: image.preview.width, height: image.preview.height }
}

function singleFit(dimensions: ImageDimensions) {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** How far outside the viewport an image starts loading, so scrolling rarely meets a placeholder. */
const NEAR_VIEWPORT_MARGIN = '800px 0px'

/**
 * Latch to true once the element comes near the viewport. Without
 * IntersectionObserver (old engines) every image counts as near, which is the
 * previous behaviour.
 */
function useNearViewport(enabled: boolean): [(element: HTMLElement | null) => void, boolean] {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [element, setElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled || near || element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [enabled, near, element])
  return [setElement, near]
}

function MessageImage({
  image,
  load,
  queue,
  variant,
  labels,
  onLoaded,
  onPreview,
}: {
  image: MessageImageSource
  load: MessageImageLoader
  queue: ImageLoadQueue
  variant: ImageVariant
  labels: ImageLabels
  onLoaded: (url: string) => void
  onPreview: () => void
}) {
  const attachment = 'attachment' in image ? image.attachment : undefined
  const preview = 'preview' in image ? image.preview : undefined
  const [loaded, setLoaded] = useState<string | null>(() => (attachment === undefined ? null : (load.peek?.(attachment) ?? null)))
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const onLoadedRef = useRef(onLoaded)
  onLoadedRef.current = onLoaded
  const request = useCallback(() => {
    setAttempt(value => value + 1)
  }, [])
  const dimensions = sourceDimensions(image)
  // Bytes are read only once the image nears the viewport: a mounted page of
  // history no longer starts one Session read per attachment.
  const [observe, near] = useNearViewport(attachment !== undefined && loaded === null)
  const fit = variant === 'single' ? (dimensions === undefined ? { width: 240, height: 240, objectPosition: 'center' } : singleFit(dimensions)) : undefined

  useEffect(() => {
    if (attachment === undefined) return
    const cached = load.peek?.(attachment) ?? null
    if (!near && cached === null) return
    let live = true
    setError(false)
    setLoaded(cached)
    const scheduled = queue.schedule(() => load(attachment), 'visible')
    void scheduled.promise
      .then(url => {
        if (!live) return
        setLoaded(url)
        onLoadedRef.current(url)
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => {
      live = false
      scheduled.cancel()
    }
  }, [attachment, load, queue, attempt, near])

  const src = preview?.url ?? loaded
  const label = sourceLabel(image, labels.image)
  const loadingThumbnail = variant === 'thumbnail' && src === null
  if (error)
    return (
      <button
        type="button"
        className={styles.error}
        data-variant={variant}
        title={variant === 'thumbnail' ? labels.loadFailed : undefined}
        aria-label={variant === 'thumbnail' ? labels.loadFailed : undefined}
        onClick={request}
      >
        {variant === 'thumbnail' ? <RefreshCwIcon aria-hidden="true" /> : labels.loadFailed}
      </button>
    )

  return (
    <button
      ref={observe}
      type="button"
      className={styles.frame}
      data-variant={variant}
      style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
      title={loadingThumbnail ? labels.loading : labels.open}
      aria-label={loadingThumbnail ? labels.loading : labels.openNamed(label)}
      aria-busy={loadingThumbnail || undefined}
      onClick={() => {
        if (src !== null) onPreview()
      }}
    >
      {src === null ? (
        <span className={styles.loading} aria-hidden={loadingThumbnail || undefined}>
          {loadingThumbnail ? <LoaderCircleIcon className={styles.spinner} /> : labels.loading}
        </span>
      ) : (
        <img src={src} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />
      )}
    </button>
  )
}

export function ImageGallery({
  images,
  load,
  align,
  compact = false,
  thumbnail = false,
  labels,
  gallery,
  queue = historicalImageQueue,
}: {
  images: readonly MessageImageSource[]
  load: MessageImageLoader
  /** Bounded read queue; the client-wide queue by default. */
  queue?: ImageLoadQueue
  align: 'start' | 'end'
  compact?: boolean
  thumbnail?: boolean
  labels: ImageLabels
  gallery?: MessageImageGallery
}) {
  // A position of a larger message gallery: its own tile plus the whole group
  // the preview opens, so every image of the message stays reachable.
  const group = gallery !== undefined && gallery.images.length > 0 ? gallery.images : images
  const groupOffset = gallery === undefined ? 0 : gallery.index
  const [loadedUrls, setLoadedUrls] = useState<Readonly<Record<string, string>>>({})
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const pendingLoads = useRef(new Set<string>())
  const recordLoaded = useCallback((key: string, url: string) => {
    setLoadedUrls(previous => (previous[key] === url ? previous : { ...previous, [key]: url }))
  }, [])
  const variant: ImageVariant = thumbnail ? 'thumbnail' : compact || group.length > 1 ? 'tile' : 'single'
  const lightboxImages = useMemo<readonly LightboxImage[]>(
    () =>
      group.map((image, index) => {
        const src = 'preview' in image ? image.preview.url : (loadedUrls[sourceKey(image, index)] ?? load.peek?.(image.attachment))
        const alt = sourceLabel(image, labels.image)
        return src === undefined ? { alt } : { src, alt }
      }),
    [group, labels.image, load, loadedUrls],
  )

  useEffect(() => {
    if (previewIndex === null) return
    let live = true
    group.forEach((image, index) => {
      if (!('attachment' in image)) return
      const key = sourceKey(image, index)
      if (loadedUrls[key] !== undefined || pendingLoads.current.has(key)) return
      pendingLoads.current.add(key)
      // Prefetches yield to on-screen images, and run through the same bound.
      void queue
        .schedule(() => load(image.attachment), 'prefetch')
        .promise.then(url => {
          if (live) recordLoaded(key, url)
        })
        .catch(() => undefined)
        .finally(() => {
          pendingLoads.current.delete(key)
        })
    })
    return () => {
      live = false
    }
  }, [group, load, loadedUrls, previewIndex, queue, recordLoaded])

  if (images.length === 0) return null
  return (
    <>
      <div className={`${styles.gallery} dshx-root`} data-align={align}>
        {images.map((image, index) => {
          const groupIndex = groupOffset + index
          return (
            <MessageImage
              key={sourceKey(image, groupIndex)}
              image={image}
              load={load}
              queue={queue}
              variant={variant}
              labels={labels}
              onLoaded={url => {
                recordLoaded(sourceKey(image, groupIndex), url)
              }}
              onPreview={() => {
                setPreviewIndex(groupIndex)
              }}
            />
          )
        })}
      </div>
      {previewIndex !== null && lightboxImages[previewIndex] !== undefined && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={previewIndex}
          labels={labels.lightbox}
          onClose={() => {
            setPreviewIndex(null)
          }}
        />
      )}
    </>
  )
}
