// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PickClickGuard, PickSession, type PickResult } from './pick-session.js'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ''
})

const button = ({ label }: { readonly label: string }): HTMLButtonElement => {
  const element = document.createElement('button')
  element.textContent = label
  document.body.append(element)
  return element
}

const pointer = (type: string, { x, y, button: pressed = 0 }: { readonly x: number; readonly y: number; readonly button?: number }): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: pressed })

const session = ({ mode, onPicked }: { readonly mode: 'element' | 'region'; readonly onPicked: (result: PickResult) => void }): (() => void) => {
  const stop = PickSession.install({
    mode,
    url: () => 'http://dsh.test/',
    handlers: { onPicked, onHover: () => undefined, onDrag: () => undefined, onCancel: () => undefined },
  })
  cleanups.push(stop)
  return stop
}

describe('pick session', () => {
  it('cancels the click a picked element would otherwise receive', () => {
    const picked: PickResult[] = []
    cleanups.push(PickClickGuard.install())
    session({ mode: 'element', onPicked: result => picked.push(result) })
    const target = button({ label: 'Board' })
    const activated = vi.fn()
    target.addEventListener('click', activated)

    target.dispatchEvent(pointer('pointerdown', { x: 20, y: 30 }))
    expect(picked).toHaveLength(1)
    const click = pointer('click', { x: 20, y: 30 })
    target.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(activated).not.toHaveBeenCalled()
  })

  it('keeps the click of a later gesture on the same element', () => {
    const picked: PickResult[] = []
    cleanups.push(PickClickGuard.install())
    const stop = session({ mode: 'element', onPicked: result => picked.push(result) })
    const target = button({ label: 'Board' })
    const activated = vi.fn()
    target.addEventListener('click', activated)

    target.dispatchEvent(pointer('pointerdown', { x: 20, y: 30 }))
    stop()
    target.dispatchEvent(pointer('pointerdown', { x: 20, y: 30 }))
    const click = pointer('click', { x: 20, y: 30 })
    target.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(activated).toHaveBeenCalledTimes(1)
  })

  it('lets an unrelated control keep its click right after a pick', () => {
    const picked: PickResult[] = []
    cleanups.push(PickClickGuard.install())
    session({ mode: 'element', onPicked: result => picked.push(result) })
    const target = button({ label: 'Board' })
    const toolbar = button({ label: 'Add' })
    const activated = vi.fn()
    toolbar.addEventListener('click', activated)

    target.dispatchEvent(pointer('pointerdown', { x: 20, y: 30 }))
    const click = pointer('click', { x: 400, y: 300 })
    toolbar.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(activated).toHaveBeenCalledTimes(1)
  })

  it('describes a dragged region', () => {
    const picked: PickResult[] = []
    session({ mode: 'region', onPicked: result => picked.push(result) })
    const target = button({ label: 'Area' })

    target.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
    target.dispatchEvent(pointer('pointermove', { x: 80, y: 60 }))
    target.dispatchEvent(pointer('pointerup', { x: 80, y: 60 }))

    expect(picked).toHaveLength(1)
    expect(picked[0]?.mode).toBe('region')
    expect(picked[0]?.target.rect).toMatchObject({ x: 10, y: 10, width: 70, height: 50 })
  })

  it('ignores a secondary-button press', () => {
    const picked: PickResult[] = []
    session({ mode: 'element', onPicked: result => picked.push(result) })
    const target = button({ label: 'Menu' })

    target.dispatchEvent(pointer('pointerdown', { x: 5, y: 5, button: 2 }))

    expect(picked).toHaveLength(0)
  })
})
