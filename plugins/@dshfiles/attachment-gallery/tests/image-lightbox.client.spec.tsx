// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/dom'
import { cleanup, render } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.js'

afterEach(cleanup)

const labels = {
  dialog: 'Image preview',
  close: 'Close image preview',
  previous: 'Previous image',
  next: 'Next image',
  thumbnail: (position: number, total: number) => `Image ${position} of ${total}`,
  loading: 'Loading image',
}

const firstImage = { src: 'blob:first', alt: 'First image' }
const secondImage = { src: 'blob:second', alt: 'Second image' }
const images = [firstImage, secondImage]

describe('ImageLightbox', () => {
  it('navigates images with arrow keys, side controls, and thumbnails', () => {
    const view = render(<ImageLightbox images={images} initialIndex={1} labels={labels} onClose={vi.fn()} />)

    expect(view.getByRole('img').getAttribute('alt')).toBe('Second image')
    expect(view.getByRole('button', { name: 'Image 2 of 2' }).getAttribute('aria-current')).toBe('true')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(view.getByRole('img').getAttribute('alt')).toBe('First image')
    fireEvent.click(view.getByRole('button', { name: 'Next image' }))
    expect(view.getByRole('img').getAttribute('alt')).toBe('Second image')
    fireEvent.click(view.getByRole('button', { name: 'Image 1 of 2' }))
    expect(view.getByRole('img').getAttribute('alt')).toBe('First image')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(view.getByRole('img').getAttribute('alt')).toBe('Second image')
  })

  it('closes on Escape and restores focus to its opener', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox images={images} initialIndex={0} labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: 'Close image preview' })

    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps loading thumbnails disabled until their image is ready', () => {
    const view = render(<ImageLightbox images={[firstImage, { alt: 'Loading image' }]} initialIndex={1} labels={labels} onClose={vi.fn()} />)

    expect(view.getByRole('status').textContent).toBe('Loading image')
    expect(view.getByRole('button', { name: 'Image 2 of 2' }).hasAttribute('disabled')).toBe(true)
  })
})
