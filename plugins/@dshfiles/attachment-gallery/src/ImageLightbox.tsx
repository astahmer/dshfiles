import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import styles from './ImageLightbox.module.css'

export interface ImageLightboxLabels {
  dialog: string
  close: string
  previous: string
  next: string
  thumbnail: (position: number, total: number) => string
  loading: string
}

export interface LightboxImage {
  src?: string
  alt: string
}

export function ImageLightbox({
  images,
  initialIndex,
  labels,
  onClose,
}: {
  images: readonly LightboxImage[]
  initialIndex: number
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(initialIndex)
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
    <div className={`${styles.backdrop} dshx-root`} role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className={styles.mask} aria-hidden="true" onMouseDown={onClose} />
      {hasGallery && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${styles.navigation} ${styles.previous}`}
          aria-label={labels.previous}
          onClick={() => {
            move(-1)
          }}
        >
          <ChevronLeftIcon />
        </Button>
      )}
      {activeImage.src === undefined ? (
        <span className={styles.loading} role="status">
          {labels.loading}
        </span>
      ) : (
        <img className={styles.image} src={activeImage.src} alt={activeImage.alt} />
      )}
      {hasGallery && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${styles.navigation} ${styles.next}`}
          aria-label={labels.next}
          onClick={() => {
            move(1)
          }}
        >
          <ChevronRightIcon />
        </Button>
      )}
      {hasGallery && (
        <div className={styles.thumbnails} role="group" aria-label={labels.dialog}>
          {images.map((image, index) => (
            <Button
              key={`${image.src ?? 'loading'}:${index}`}
              type="button"
              variant="ghost"
              className={styles.thumbnail}
              aria-label={labels.thumbnail(index + 1, images.length)}
              aria-current={index === activeIndex ? 'true' : undefined}
              disabled={image.src === undefined}
              onClick={() => {
                setActiveIndex(index)
              }}
            >
              {image.src === undefined ? <span /> : <img src={image.src} alt="" />}
            </Button>
          ))}
        </div>
      )}
      <Button ref={closeRef} type="button" variant="ghost" size="icon" className={styles.close} aria-label={labels.close} onClick={onClose}>
        <XIcon />
      </Button>
    </div>,
    document.body,
  )
}
