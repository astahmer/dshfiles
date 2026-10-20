import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { LoaderCircleIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { ImageLightbox, type ImageLightboxLabels, type LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import styles from './MessageImage.module.css'

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

function MessageImage({
  image,
  load,
  variant,
  labels,
  onLoaded,
  onPreview,
}: {
  image: MessageImageSource
  load: MessageImageLoader
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
  const fit = variant === 'single' ? (dimensions === undefined ? { width: 240, height: 240, objectPosition: 'center' } : singleFit(dimensions)) : undefined

  useEffect(() => {
    if (attachment === undefined) return
    let live = true
    setError(false)
    setLoaded(load.peek?.(attachment) ?? null)
    void load(attachment)
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
    }
  }, [attachment, load, attempt])

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
}: {
  images: readonly MessageImageSource[]
  load: MessageImageLoader
  align: 'start' | 'end'
  compact?: boolean
  thumbnail?: boolean
  labels: ImageLabels
}) {
  const [loadedUrls, setLoadedUrls] = useState<Readonly<Record<string, string>>>({})
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const recordLoaded = useCallback((key: string, url: string) => {
    setLoadedUrls(previous => (previous[key] === url ? previous : { ...previous, [key]: url }))
  }, [])
  const variant: ImageVariant = thumbnail ? 'thumbnail' : compact || images.length > 1 ? 'tile' : 'single'
  const lightboxImages = useMemo<readonly LightboxImage[]>(
    () =>
      images.map((image, index) => {
        const src = 'preview' in image ? image.preview.url : (loadedUrls[sourceKey(image, index)] ?? load.peek?.(image.attachment))
        const alt = sourceLabel(image, labels.image)
        return src === undefined ? { alt } : { src, alt }
      }),
    [images, labels.image, load, loadedUrls],
  )

  if (images.length === 0) return null
  return (
    <>
      <div className={`${styles.gallery} dshx-root`} data-align={align}>
        {images.map((image, index) => (
          <MessageImage
            key={sourceKey(image, index)}
            image={image}
            load={load}
            variant={variant}
            labels={labels}
            onLoaded={url => {
              recordLoaded(sourceKey(image, index), url)
            }}
            onPreview={() => {
              setPreviewIndex(index)
            }}
          />
        ))}
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
