// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdReaderAboveInsert } from '../src/native/chat/TurnProcessNodeView.tsx'

/** Size observations wait here until the test delivers them, as the browser does after the next layout. */
let deliver: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout', 'clearTimeout'] })
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      private observed = false
      constructor(private readonly onResize: ResizeObserverCallback) {
        const entries: ResizeObserverEntry[] = []
        deliver = () => {
          if (this.observed) this.onResize(entries, this)
        }
      }
      observe(): void {
        this.observed = true
      }
      unobserve(): void {}
      disconnect(): void {
        this.observed = false
      }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** A scrollport holding the Turn's flow: its input, the item of the "Worked for" control that just mounted, its answer. */
const transcript = (options: { readonly following?: boolean; readonly rowTop: number }) => {
  document.body.innerHTML = `
    <div data-conversation-scroll id="scroller">
      <div ${options.following === true ? 'data-chat-following-tail' : ''}>
        <div data-chat-flow-kind="user"></div>
        <div id="item" data-chat-flow-kind="turn-process" style="margin-top: 16px"><button id="row">Worked for 13s</button></div>
        <div data-chat-flow-kind="assistant-step"></div>
      </div>
    </div>`
  const element = (id: string): HTMLElement => {
    const found = document.getElementById(id)
    if (found === null) throw new Error(`no #${id}`)
    return found
  }
  const scroller = element('scroller')
  const item = element('item')
  // The item takes its 24px row once the seat shows it, possibly a commit after the control mounted.
  let shown = false
  const box = (top: number, height: number): DOMRect => DOMRect.fromRect({ x: 0, y: top, width: 600, height })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === scroller) return box(0, 800)
    if (this === item) return box(options.rowTop, shown ? 24 : 0)
    return box(0, 0)
  })
  let scrollTop = 600
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value } })
  return { scroller, row: element('row'), show: () => { shown = true } }
}

describe('"Worked for" appearing at turn end (round three F16)', () => {
  it('keeps the text being read still: the offset takes the row and its gap once the row takes space', () => {
    const { scroller, row, show } = transcript({ rowTop: -200 })
    holdReaderAboveInsert(row)
    // The seat still hides the row: nothing moved, nothing to add.
    deliver()
    expect(scroller.scrollTop).toBe(600)
    show()
    deliver()
    expect(scroller.scrollTop).toBe(640)
  })

  it('compensates a row inserted in the upper half of the view, above the text being read', () => {
    const { scroller, row, show } = transcript({ rowTop: 120 })
    holdReaderAboveInsert(row)
    show()
    deliver()
    expect(scroller.scrollTop).toBe(640)
  })

  it('holds native anchoring off until then, and never adds what the browser already corrected', () => {
    const { scroller, row, show } = transcript({ rowTop: -200 })
    holdReaderAboveInsert(row)
    expect(scroller.style.overflowAnchor).toBe('none')
    // A browser that anchored anyway already moved the offset by the full insertion.
    scroller.scrollTop = 640
    show()
    deliver()
    expect(scroller.scrollTop).toBe(640)
    vi.advanceTimersToNextFrame()
    expect(scroller.style.overflowAnchor).toBe('')
  })

  it('leaves a reader at the tail to the follow, and a row in the lower half where it lands', () => {
    const following = transcript({ following: true, rowTop: -200 })
    holdReaderAboveInsert(following.row)
    following.show()
    deliver()
    expect(following.scroller.scrollTop).toBe(600)
    expect(following.scroller.style.overflowAnchor).toBe('')
    vi.restoreAllMocks()
    const below = transcript({ rowTop: 600 })
    holdReaderAboveInsert(below.row)
    below.show()
    deliver()
    expect(below.scroller.scrollTop).toBe(600)
  })

  it('stops watching and gives anchoring back when the row never takes space', () => {
    const { scroller, row } = transcript({ rowTop: -200 })
    holdReaderAboveInsert(row)
    vi.advanceTimersByTime(2_000)
    vi.advanceTimersToNextFrame()
    expect(scroller.style.overflowAnchor).toBe('')
  })
})
