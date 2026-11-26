// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ATTENTION_KIND_LABEL, ATTENTION_META_NAME_MIN, AttentionMeta, attentionMetaStep } from '../src/components/ui/attention-meta.js'

/**
 * jsdom has no layout: every measured part is 6px a character, a separator 12px and the mark 16px; the line is as wide
 * as `available` says. With those, "billing-api · Approval · 2m" after its mark needs 166px, 142px without the age and
 * 130px with the name at its eight-character floor ("billing-…").
 */
let available = 400
const CHAR = 6
const widthOf = (element: Element): number => {
  if (element.matches('[data-slot="attention-meta"]')) return available
  if (element.matches('[data-attention-meta-part="mark"], [data-attention-meta-part="rail"]')) return 16
  if (element.matches('[data-measure-part="sep"]')) return 12
  if (element.matches('[data-measure-part]')) return [...(element.textContent ?? '')].length * CHAR
  return 0
}
const original = HTMLElement.prototype.getBoundingClientRect
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
class FakeResizeObserver {
  readonly #entry: { callback: ResizeObserverCallback; targets: Set<Element> }
  constructor(callback: ResizeObserverCallback) {
    this.#entry = { callback, targets: new Set() }
    observers.push(this.#entry)
  }
  observe(target: Element): void {
    this.#entry.targets.add(target)
  }
  unobserve(target: Element): void {
    this.#entry.targets.delete(target)
  }
  disconnect(): void {
    this.#entry.targets.clear()
  }
}
/** The column changes width: every observed line hears it, as from a real ResizeObserver. */
const resize = (width: number): void => {
  available = width
  act(() => {
    for (const { callback, targets } of observers)
      // SAFETY: the fake observer's entries only carry the target the component reads.
      callback([...targets].map(target => ({ target }) as ResizeObserverEntry), {} as ResizeObserver)
  })
}

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return { width: widthOf(this), height: 16, top: 0, left: 0, right: widthOf(this), bottom: 16, x: 0, y: 0, toJSON: () => ({}) }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: FakeResizeObserver, configurable: true })
})
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = original
})
afterEach(() => {
  cleanup()
  available = 400
})

const shown = (root: HTMLElement): string =>
  [...root.querySelectorAll(':scope > [data-attention-meta-part]')].map(part => part.getAttribute('data-attention-meta-part') ?? '').join(' ')

describe('ATTENTION_KIND_LABEL', () => {
  it('is the one word list: Approval, Question, Turn failed', () => {
    expect(ATTENTION_KIND_LABEL).toEqual({ approval: 'Approval', question: 'Question', failed: 'Turn failed' })
    expect(Object.values(ATTENTION_KIND_LABEL)).not.toContain('Thread question')
  })
})

describe('attentionMetaStep', () => {
  const widths = { lead: 16, name: 66, nameMin: 54, kind: 48, age: 12, sep: 12, rail: false } as const
  it('keeps every part while they fit', () => {
    expect(attentionMetaStep({ ...widths, available: 166 })).toBe('full')
  })
  it('drops the age first', () => {
    expect(attentionMetaStep({ ...widths, available: 165 })).toBe('no-age')
    expect(attentionMetaStep({ ...widths, available: 142 })).toBe('no-age')
  })
  it('then lets the name truncate, down to eight characters', () => {
    expect(attentionMetaStep({ ...widths, available: 130 })).toBe('no-age')
  })
  it('then drops the name rather than cut it to a stub; the mark stays', () => {
    expect(attentionMetaStep({ ...widths, available: 129 })).toBe('no-name')
  })
  it('drops a short name it cannot show whole', () => {
    expect(attentionMetaStep({ ...widths, name: 42, nameMin: 42, age: 0, available: 118 })).toBe('full')
    expect(attentionMetaStep({ ...widths, name: 42, nameMin: 42, age: 0, available: 117 })).toBe('no-name')
  })
  it('without a project, only the age can go', () => {
    expect(attentionMetaStep({ ...widths, lead: 0, name: 0, nameMin: 0, available: 20 })).toBe('no-age')
  })
})

describe('AttentionMeta', () => {
  it('reads mark · name · kind · age with room', () => {
    const view = render(<AttentionMeta project="billing-api" kind={ATTENTION_KIND_LABEL.approval} age="2m" />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(root.dataset['step']).toBe('full')
    expect(shown(root)).toBe('mark name sep kind sep age')
    expect(root.querySelector('[data-attention-meta-part="name"]')?.textContent).toBe('billing-api')
  })

  it('takes each drop step as its column narrows, and comes back as it widens', () => {
    const view = render(<AttentionMeta project="billing-api" kind="Approval" age="2m" />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    resize(150)
    expect(root.dataset['step']).toBe('no-age')
    expect(shown(root)).toBe('mark name sep kind')
    resize(130)
    expect(root.dataset['step']).toBe('no-age')
    resize(129)
    expect(root.dataset['step']).toBe('no-name')
    expect(shown(root)).toBe('mark sep kind')
    resize(166)
    expect(root.dataset['step']).toBe('full')
  })

  it('keeps the dropped words for assistive tech', () => {
    available = 100
    const view = render(<AttentionMeta project="billing-api" kind="Approval" age="2m" />)
    const hidden = [...view.container.querySelectorAll('.dshx\\:sr-only')].map(node => node.textContent)
    expect(hidden).toContain('billing-api')
    expect(hidden).toContain(', 2m')
    expect(view.container.querySelector('[data-attention-meta-part="mark"]')?.getAttribute('aria-hidden')).toBe('true')
  })

  it(`never shows a name cut below ${String(ATTENTION_META_NAME_MIN)} characters`, () => {
    // "web-app" (42px) after its mark and before "· Turn failed" (12 + 66) needs 136px whole.
    available = 135
    const view = render(<AttentionMeta project="web-app" kind={ATTENTION_KIND_LABEL.failed} />)
    expect(view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!.dataset['step']).toBe('no-name')
    resize(136)
    expect(view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!.dataset['step']).toBe('full')
  })

  it('in rail mode hangs the mark in a 16px seat before the name, and keeps the seat without a project', () => {
    const view = render(<AttentionMeta markSeat="rail" project="web-app" kind="Question" mark={{ tone: 2, 'data-thread-project-mark': 'web-app' }} />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(root.dataset['markSeat']).toBe('rail')
    const seat = root.querySelector<HTMLElement>(':scope > [data-attention-meta-part="rail"]')!
    expect(root.firstElementChild).toBe(seat)
    expect(seat.className).toContain('dshx:w-4')
    expect(seat.className).toContain('dshx:mr-[var(--attention-meta-rail-gap,0.5rem)]')
    const mark = seat.querySelector<HTMLElement>('[data-slot="project-mark"]')!
    expect(mark.dataset['size']).toBe('dense')
    expect(mark.dataset['threadProjectMark']).toBe('web-app')
    expect(mark.className).toContain('project-tone-balanced-2')
    // The name lines up with the title: no inline gap of its own.
    expect(root.querySelector('[data-attention-meta-part="name"]')?.className).not.toContain('dshx:pl-1.5')

    view.rerender(<AttentionMeta markSeat="rail" kind="Waiting on 1 subagent" />)
    const empty = root.querySelector<HTMLElement>(':scope > [data-attention-meta-part="rail"]')!
    expect(root.firstElementChild).toBe(empty)
    expect(empty.childElementCount).toBe(0)
    expect(shown(root)).toBe('rail kind')
  })

  it('in rail mode follows the seat with the kind alone once the name drops', () => {
    available = 60
    const view = render(<AttentionMeta markSeat="rail" project="billing-api" kind="Approval" />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(root.dataset['step']).toBe('no-name')
    expect(shown(root)).toBe('rail kind')
    expect(root.querySelector('[data-attention-meta-part="kind"]')?.className).toContain('dshx:truncate')
  })

  it('is the 12/16 muted meta step, and takes its width from its parent', () => {
    const view = render(<AttentionMeta project="docs-site" kind="Approval" />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    for (const name of ['dshx:text-xs/4', 'dshx:text-muted-foreground', 'dshx:flex-1', 'dshx:min-w-0', 'dshx:overflow-hidden']) expect(root.className).toContain(name)
  })
})
