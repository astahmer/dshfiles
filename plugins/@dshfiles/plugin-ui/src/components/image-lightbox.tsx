import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '../icons.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'

export interface ImageLightboxLabels {
  readonly dialog: string
  readonly close: string
  readonly previous: string
  readonly next: string
  readonly thumbnail: (position: number, total: number) => string
  readonly loading: string
}

export interface LightboxImage {
  readonly src?: string
  readonly alt: string
}

const englishLabels: ImageLightboxLabels = {
  dialog: 'Image preview',
  close: 'Close image preview',
  previous: 'Previous image',
  next: 'Next image',
  thumbnail: (position, total) => `Image ${String(position)} of ${String(total)}`,
  loading: 'Loading image',
}

const controlClass =
  'dshx:fixed dshx:z-[1] dshx:grid dshx:place-items-center dshx:rounded-full dshx:border-[0.5px] dshx:border-(--dsw-alias-border-l2-darkmode-thin) dshx:bg-(--dsw-specific-input-major) dshx:text-foreground dshx:hover:bg-(--dsw-specific-input-major) dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-offset-3 dshx:focus-visible:outline-ring'

const navigationClass = cn(controlClass, 'dshx:top-1/2 dshx:size-11 dshx:-translate-y-1/2')

/**
 * Full-window image viewer with a keyboard-navigable gallery: arrows and side controls move between images, the
 * thumbnail strip jumps, Escape closes and focus returns to the opener. An image without `src` shows as loading.
 */
export const ImageLightbox = (props: {
  readonly images: readonly LightboxImage[]
  readonly initialIndex: number
  readonly labels?: ImageLightboxLabels
  readonly onClose: () => void
}): JSX.Element | null => {
  const { images, onClose } = props
  const labels = props.labels ?? englishLabels
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(props.initialIndex)
  const activeImage = images[activeIndex]
  const hasGallery = images.length > 1

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
        return
      }
      if (!hasGallery || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      event.preventDefault()
      event.stopPropagation()
      const offset = event.key === 'ArrowRight' ? 1 : -1
      setActiveIndex(index => (index + offset + images.length) % images.length)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [hasGallery, images.length, onClose])

  if (activeImage === undefined) return null
  const move = (offset: number): void => {
    setActiveIndex(index => (index + offset + images.length) % images.length)
  }

  return createPortal(
    <div
      className="dshx-root dshx:fixed dshx:inset-0 dshx:z-[1050] dshx:grid dshx:place-items-center dshx:p-10"
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div
        className="dshx:absolute dshx:inset-0 dshx:bg-(--dsw-alias-bg-mask-1) dshx:[backdrop-filter:var(--dsw-mask-blur)]"
        aria-hidden="true"
        onMouseDown={onClose}
      />
      {hasGallery && (
        <Button type="button" variant="ghost" size="icon" className={cn(navigationClass, 'dshx:left-6')} aria-label={labels.previous} onClick={() => move(-1)}>
          <ChevronLeftIcon />
        </Button>
      )}
      {activeImage.src === undefined ? (
        <span className="dshx:relative dshx:text-foreground" role="status">
          {labels.loading}
        </span>
      ) : (
        <img
          className="dshx:relative dshx:max-h-[calc(100vh-120px)] dshx:max-w-[min(100%,1600px)] dshx:rounded-(--dsw-radius-lg) dshx:bg-(--dsw-specific-input-major) dshx:object-contain dshx:shadow-(--dsw-elevation-prominent)"
          src={activeImage.src}
          alt={activeImage.alt}
        />
      )}
      {hasGallery && (
        <Button type="button" variant="ghost" size="icon" className={cn(navigationClass, 'dshx:right-6')} aria-label={labels.next} onClick={() => move(1)}>
          <ChevronRightIcon />
        </Button>
      )}
      {hasGallery && (
        <div
          className="dshx:fixed dshx:bottom-5 dshx:z-[1] dshx:flex dshx:max-w-[min(80vw,720px)] dshx:gap-2 dshx:overflow-x-auto dshx:rounded-(--dsw-radius-lg) dshx:border-[0.5px] dshx:border-(--dsw-alias-border-l2-darkmode-thin) dshx:bg-(--dsw-specific-input-major) dshx:p-1.5"
          role="group"
          aria-label={labels.dialog}
        >
          {images.map((image, index) => (
            <Button
              key={`${image.src ?? 'loading'}:${String(index)}`}
              type="button"
              variant="ghost"
              className={cn(
                'dshx:h-14 dshx:w-16 dshx:flex-[0_0_64px] dshx:overflow-hidden dshx:rounded-(--dsw-radius-sm) dshx:border-2 dshx:border-transparent dshx:p-0 dshx:opacity-60 dshx:hover:bg-transparent dshx:focus-visible:outline-2 dshx:focus-visible:outline-offset-3 dshx:focus-visible:outline-ring',
                index === activeIndex && 'dshx:border-ring dshx:opacity-100',
              )}
              aria-label={labels.thumbnail(index + 1, images.length)}
              aria-current={index === activeIndex ? 'true' : undefined}
              disabled={image.src === undefined}
              onClick={() => setActiveIndex(index)}
            >
              {image.src === undefined ? <span /> : <img src={image.src} alt="" className="dshx:size-full dshx:object-cover" />}
            </Button>
          ))}
        </div>
      )}
      <Button
        ref={closeRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(controlClass, 'dshx:top-5 dshx:right-5 dshx:size-9')}
        aria-label={labels.close}
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>,
    document.body,
  )
}
