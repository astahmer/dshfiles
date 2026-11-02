// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { ImageGallery, type ImageLabels } from '../src/MessageImage.js'

afterEach(cleanup)

const labels: ImageLabels = {
  image: 'Image',
  open: 'Open image',
  openNamed: name => `Open ${name}`,
  loading: 'Loading image',
  loadFailed: 'Image failed to load; click to retry',
  lightbox: {
    dialog: 'Image preview',
    close: 'Close image preview',
    previous: 'Previous image',
    next: 'Next image',
    thumbnail: (position, total) => `Image ${position} of ${total}`,
    loading: 'Loading image',
  },
}

const red = { preview: { url: 'blob:red', name: 'red.png', width: 120, height: 80 } }
const blue = { preview: { url: 'blob:blue', name: 'blue.png', width: 80, height: 120 } }
const load = vi.fn(() => Promise.reject(new Error('preview sources never load')))

describe('ImageGallery', () => {
  it('opens the whole message gallery from one rendered position', () => {
    const view = render(<ImageGallery images={[red]} gallery={{ images: [red, blue], index: 0 }} load={load} align="end" thumbnail labels={labels} />)

    fireEvent.click(view.getByRole('button', { name: 'Open red.png' }))

    expect(view.getByRole('dialog', { name: 'Image preview' })).toBeDefined()
    expect(within(view.getByRole('dialog')).getByRole('img', { name: 'red.png' })).toBeDefined()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(view.getByRole('dialog')).getByRole('img', { name: 'blue.png' })).toBeDefined()
    expect(view.getByRole('button', { name: 'Image 2 of 2' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: 'Image 1 of 2' }))
    expect(within(view.getByRole('dialog')).getByRole('img', { name: 'red.png' })).toBeDefined()
  })

  it('starts a grouped gallery at the rendered position', () => {
    const view = render(<ImageGallery images={[blue]} gallery={{ images: [red, blue], index: 1 }} load={load} align="start" thumbnail labels={labels} />)

    fireEvent.click(view.getByRole('button', { name: 'Open blue.png' }))
    expect(view.getByRole('button', { name: 'Image 2 of 2' }).getAttribute('aria-current')).toBe('true')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(within(view.getByRole('dialog')).getByRole('img', { name: 'red.png' })).toBeDefined()
  })

  it('keeps a single submitted group self-contained', () => {
    const view = render(<ImageGallery images={[red, blue]} load={load} align="end" labels={labels} />)

    fireEvent.click(view.getByRole('button', { name: 'Open red.png' }))
    expect(view.getByRole('button', { name: 'Image 1 of 2' })).toBeDefined()
    expect(view.getByRole('button', { name: 'Image 2 of 2' })).toBeDefined()
  })
})
