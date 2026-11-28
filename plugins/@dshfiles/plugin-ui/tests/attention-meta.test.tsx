// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      callback(
        [...targets].map(target => ({ target }) as ResizeObserverEntry),
        {} as ResizeObserver,
      )
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

  describe('keep: name', () => {
    const named = { ...widths, keep: 'name' } as const
    it('drops the age first, as by default', () => {
      expect(attentionMetaStep({ ...named, available: 166 })).toBe('full')
      expect(attentionMetaStep({ ...named, available: 142 })).toBe('no-age')
    })
    it('then drops the kind with its separator, keeping the name whole', () => {
      expect(attentionMetaStep({ ...named, available: 141 })).toBe('no-kind')
      expect(attentionMetaStep({ ...named, available: 82 })).toBe('no-kind')
    })
    it('then lets the name truncate to its eight-character floor', () => {
      expect(attentionMetaStep({ ...named, available: 70 })).toBe('no-kind')
    })
    it('then leaves the mark alone', () => {
      expect(attentionMetaStep({ ...named, available: 69 })).toBe('mark')
    })
    it('without a kind, truncates and then drops the name', () => {
      expect(attentionMetaStep({ ...named, kind: 0, age: 0, available: 82 })).toBe('full')
      expect(attentionMetaStep({ ...named, kind: 0, age: 0, available: 70 })).toBe('no-age')
      expect(attentionMetaStep({ ...named, kind: 0, age: 0, available: 69 })).toBe('no-name')
    })
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

  it('draws a kind mark 4px before the kind, hidden from assistive tech, and measures it with the kind (council round 18)', () => {
    const view = render(<AttentionMeta project="billing-api" kind="Working" age="2m" kindMark={<svg data-glyph="working" />} />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(shown(root)).toBe('mark name sep kind sep age')
    const kind = root.querySelector<HTMLElement>(':scope > [data-attention-meta-part="kind"]')!
    expect(kind.className.split(' ')).toEqual(expect.arrayContaining(['dshx:inline-flex', 'dshx:items-center', 'dshx:gap-1']))
    const glyph = kind.querySelector('[data-attention-meta-part="kind-mark"]')!
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect(glyph.querySelector('[data-glyph="working"]')).not.toBeNull()
    expect(glyph.nextElementSibling?.textContent).toBe('Working')
    // The measure copy carries it too, so the drop steps count its width.
    expect(root.querySelector('[data-measure-part="kind"] [data-glyph="working"]')).not.toBeNull()
  })

  it('lets a wider kind mark move the drop step', () => {
    // 166px fits "billing-api · Approval · 2m" exactly; a 12px mark in the kind pushes the age out.
    available = 166
    const bare = render(<AttentionMeta project="billing-api" kind="Approval" age="2m" />)
    expect(bare.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!.dataset['step']).toBe('full')
    cleanup()
    const marked = render(<AttentionMeta project="billing-api" kind="Approval" age="2m" kindMark={<span>●●</span>} />)
    expect(marked.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!.dataset['step']).toBe('no-age')
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

  it('in rail mode hangs the mark in a 20px seat before the name, and keeps the seat without a project', () => {
    const view = render(<AttentionMeta markSeat="rail" project="web-app" kind="Question" mark={{ tone: 2, 'data-thread-project-mark': 'web-app' }} />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(root.dataset['markSeat']).toBe('rail')
    const seat = root.querySelector<HTMLElement>(':scope > [data-attention-meta-part="rail"]')!
    expect(root.firstElementChild).toBe(seat)
    expect(seat.className).toContain('dshx:w-[var(--attention-meta-rail-seat,20px)]')
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

  it('with keep="name" drops the kind before the name, then leaves the mark alone, keeping both words for assistive tech', () => {
    // In the rail: seat 16, "billing-api" 66, "· Approval" 60.
    const view = render(<AttentionMeta markSeat="rail" keep="name" project="billing-api" kind={ATTENTION_KIND_LABEL.approval} />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    expect(root.dataset['step']).toBe('full')
    expect(shown(root)).toBe('rail name sep kind')
    resize(100)
    expect(root.dataset['step']).toBe('no-kind')
    expect(shown(root)).toBe('rail name')
    expect(root.querySelector('[data-attention-meta-part="name"]')?.textContent).toBe('billing-api')
    expect([...root.querySelectorAll('.dshx\\:sr-only')].map(node => node.textContent)).toContain(', Approval')
    resize(69)
    expect(root.dataset['step']).toBe('mark')
    expect(shown(root)).toBe('rail')
    expect(root.querySelector('[data-attention-meta-part="mark"]')).not.toBeNull()
    expect([...root.querySelectorAll('.dshx\\:sr-only')].map(node => node.textContent)).toEqual(['billing-api, ', 'Approval'])
  })

  it('is the 12/16 muted meta step, and takes its width from its parent', () => {
    const view = render(<AttentionMeta project="docs-site" kind="Approval" />)
    const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
    for (const name of ['dshx:text-xs/4', 'dshx:text-muted-foreground', 'dshx:flex-1', 'dshx:min-w-0']) expect(root.className).toContain(name)
  })

  describe('the rail seat in a tinted, bordered row (council round 15 A1)', () => {
    /** The widest dense mark: "WA" in Geist 11px semibold with 2px each side draws 20.94px (Chrome and WebKit). */
    const WIDEST_DENSE_MARK = 21
    /** The seat's width as its class resolves it: `--attention-meta-rail-seat` from the kit sheet, else its fallback. */
    const seatWidth = (seat: HTMLElement): number => {
      if (seat.className.includes('dshx:w-[var(--attention-meta-rail-seat,')) return sheetSeat
      const spacing = /dshx:w-(\d+)(?:\s|$)/.exec(seat.className)?.[1]
      return spacing === undefined ? Number.NaN : Number(spacing) * 4
    }
    const sheet = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    const sheetSeat = Number(/--attention-meta-rail-seat:\s*(\d+)px/.exec(sheet)?.[1] ?? Number.NaN)

    it('declares the seat once in the kit sheet, 20px', () => {
      expect(sheetSeat).toBe(20)
    })

    it('keeps a "WA" mark whole: its left edge is at or right of the line\'s left edge, and nothing on the line clips it', () => {
      const view = render(
        <div data-row="" style={{ border: '1px solid', background: 'oklch(0.96 0.02 25)' }}>
          <AttentionMeta markSeat="rail" project="web-app" kind={ATTENTION_KIND_LABEL.failed} mark={{ tone: 2 }} />
        </div>,
      )
      const root = view.container.querySelector<HTMLElement>('[data-slot="attention-meta"]')!
      const seat = root.querySelector<HTMLElement>(':scope > [data-attention-meta-part="rail"]')!
      expect(seat.querySelector('[data-slot="project-mark"]')?.textContent).toBe('WA')
      // The seat starts at the line's left edge and centres the mark; safe centring (`justify-center-safe`) starts a mark
      // wider than the seat at the seat's edge instead of spilling it left.
      expect(root.firstElementChild).toBe(seat)
      const centred = (seatWidth(seat) - WIDEST_DENSE_MARK) / 2
      const markLeft = seat.className.includes('dshx:justify-center-safe') ? Math.max(0, centred) : centred
      expect(markLeft).toBeGreaterThanOrEqual(0)
      expect(seat.className).toContain('dshx:justify-center-safe')
      // Only the text parts clip; the line and the seat never cut the mark.
      expect(root.className).not.toContain('overflow-hidden')
      expect(seat.className).not.toContain('overflow-hidden')
      // The measuring layer is clipped by its own box, so it never widens a scroll container.
      const layer = root.querySelector<HTMLElement>('[data-attention-meta-measure]')!
      expect(layer.parentElement?.className).toContain('dshx:overflow-hidden')
    })
  })
})
