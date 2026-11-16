// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSheetDrag } from './sheet-drag.js'

const VIEWPORT = 844

const stubMedia = (phone: boolean): void => {
  window.matchMedia = (query: string): MediaQueryList => {
    const list = new EventTarget()
    return Object.assign(list, {
      matches: query.includes('max-width') ? phone : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })
  }
}

const measure = (element: HTMLElement, box: { readonly top: number; readonly height: number }): void => {
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: box.top, width: 390, height: box.height })
}

const size = (element: HTMLElement, scroll: { readonly scrollHeight: number; readonly clientHeight: number }): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scroll.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: scroll.clientHeight })
}

const touch = (target: Element, type: string, y: number, time: number): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const points = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: 100, clientY: y }]
  Object.defineProperty(event, 'touches', { value: points })
  Object.defineProperty(event, 'timeStamp', { value: time })
  target.dispatchEvent(event)
  return event
}

/** A 300 px sheet on the bottom edge: a handle strip, and a list that scrolls `hidden` px more. */
const mountSheet = (hidden: number) => {
  const sheet = document.createElement('section')
  sheet.setAttribute('data-dshx-sheet', '')
  sheet.style.height = '300px'
  const handle = document.createElement('header')
  handle.setAttribute('data-dshx-sheet-handle', '')
  const list = document.createElement('div')
  list.style.overflowY = 'auto'
  const row = document.createElement('button')
  list.append(row)
  sheet.append(handle, list)
  document.body.append(sheet)
  measure(sheet, { top: VIEWPORT - 300, height: 300 })
  size(list, { scrollHeight: 260 + hidden, clientHeight: 260 })
  return { sheet, handle, list, row }
}

let dispose: () => void = () => {}
let escapes = 0
const onKey = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') escapes += 1
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
  stubMedia(true)
  escapes = 0
  document.addEventListener('keydown', onKey)
  dispose = installSheetDrag(document)
})

afterEach(() => {
  dispose()
  document.removeEventListener('keydown', onKey)
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('installSheetDrag', () => {
  it('follows the finger down from the handle and dismisses past 30% through Escape', () => {
    const { sheet, handle } = mountSheet(0)
    touch(handle, 'touchstart', 560, 0)
    const move = touch(handle, 'touchmove', 680, 400)
    expect(move.defaultPrevented).toBe(true)
    expect(sheet.style.getPropertyValue('transform')).toBe('translateY(120px)')
    touch(handle, 'touchend', 680, 800)
    vi.advanceTimersByTime(300)
    expect(escapes).toBe(1)
    sheet.hidden = true
    vi.advanceTimersByTime(500)
    // The owner's own inline height comes back once the sheet is put away.
    expect(sheet.style.getPropertyValue('height')).toBe('300px')
    expect(sheet.style.getPropertyValue('transform')).toBe('')
  })

  it('springs back from a short slow pull and keeps the owner styles', () => {
    const { sheet, handle } = mountSheet(0)
    touch(handle, 'touchstart', 560, 0)
    touch(handle, 'touchmove', 600, 400)
    touch(handle, 'touchend', 600, 800)
    expect(sheet.style.getPropertyValue('transform')).toBe('translateY(0px)')
    vi.advanceTimersByTime(300)
    expect(escapes).toBe(0)
    expect(sheet.style.getPropertyValue('transform')).toBe('')
    expect(sheet.style.getPropertyValue('height')).toBe('300px')
  })

  it('dismisses on a fast downward flick however short', () => {
    const { handle } = mountSheet(0)
    touch(handle, 'touchstart', 560, 0)
    touch(handle, 'touchmove', 580, 10)
    touch(handle, 'touchmove', 620, 40)
    touch(handle, 'touchend', 620, 50)
    vi.advanceTimersByTime(300)
    expect(escapes).toBe(1)
  })

  it('expands towards 90% of the viewport when dragged up over overflowing content, and stays there', () => {
    const { sheet, handle } = mountSheet(1000)
    touch(handle, 'touchstart', 560, 0)
    touch(handle, 'touchmove', 160, 400)
    expect(sheet.style.getPropertyValue('height')).toBe('700px')
    touch(handle, 'touchend', 160, 800)
    vi.advanceTimersByTime(600)
    expect(sheet.style.getPropertyValue('height')).toMatch(/^759\.6\d*px$/)
    expect(sheet.style.getPropertyValue('transform')).toBe('none')
    expect(escapes).toBe(0)
  })

  it('leaves a scrolled list to scroll and drags from the content only once it is at the top', () => {
    const { sheet, list, row } = mountSheet(400)
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 50 })
    touch(row, 'touchstart', 700, 0)
    const scrolled = touch(row, 'touchmove', 760, 100)
    expect(scrolled.defaultPrevented).toBe(false)
    expect(sheet.style.getPropertyValue('transform')).toBe('')
    touch(row, 'touchend', 760, 200)

    list.scrollTop = 0
    touch(row, 'touchstart', 700, 1000)
    const up = touch(row, 'touchmove', 640, 1100)
    expect(up.defaultPrevented).toBe(false)
    touch(row, 'touchend', 640, 1200)

    touch(row, 'touchstart', 700, 2000)
    const down = touch(row, 'touchmove', 760, 2100)
    expect(down.defaultPrevented).toBe(true)
    expect(sheet.style.getPropertyValue('transform')).toBe('translateY(60px)')
  })

  it('swallows the click a drag release would fire on the row under the finger', () => {
    const { row, handle } = mountSheet(0)
    const clicked = vi.fn()
    row.addEventListener('click', clicked)
    touch(handle, 'touchstart', 560, 0)
    touch(handle, 'touchmove', 600, 400)
    touch(handle, 'touchend', 600, 800)
    row.click()
    expect(clicked).not.toHaveBeenCalled()
    row.click()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('shares one listener between installs and keeps it until the last release', () => {
    const second = installSheetDrag(document)
    const { sheet, handle } = mountSheet(0)
    touch(handle, 'touchstart', 560, 0)
    touch(handle, 'touchmove', 620, 400)
    expect(sheet.style.getPropertyValue('transform')).toBe('translateY(60px)')
    touch(handle, 'touchend', 620, 800)
    vi.advanceTimersByTime(300)
    dispose()
    dispose()
    touch(handle, 'touchstart', 560, 1000)
    expect(touch(handle, 'touchmove', 620, 1400).defaultPrevented).toBe(true)
    touch(handle, 'touchend', 620, 1800)
    vi.advanceTimersByTime(300)
    second()
    touch(handle, 'touchstart', 560, 2000)
    expect(touch(handle, 'touchmove', 620, 2400).defaultPrevented).toBe(false)
  })

  it('does nothing on a wide viewport', () => {
    stubMedia(false)
    const { sheet, handle } = mountSheet(0)
    touch(handle, 'touchstart', 560, 0)
    const move = touch(handle, 'touchmove', 700, 400)
    expect(move.defaultPrevented).toBe(false)
    expect(sheet.style.getPropertyValue('transform')).toBe('')
  })
})
