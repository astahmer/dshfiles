// @vitest-environment jsdom
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadRow, type ThreadRowProps } from './client.js'
import { rowProps, rowSession, rowStatus, VisibleObserver } from './thread-row.test-support.js'
import type { ThreadStatus } from './thread-status.js'

interface FakeAnimation {
  readonly keyframes: Keyframe[]
  readonly options: KeyframeAnimationOptions
  onfinish: (() => void) | null
  readonly cancel: () => void
}

let animations: FakeAnimation[] = []
let reduced = false

beforeEach(() => {
  animations = []
  reduced = false
  vi.stubGlobal('IntersectionObserver', VisibleObserver)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // jsdom has no Web Animations API: record what the row asks for.
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation {
      const animation: FakeAnimation = { keyframes, options, onfinish: null, cancel: () => {} }
      animations.push(animation)
      return animation
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'animate')
})

const row = (status: ThreadStatus['status'], overrides: Partial<ThreadRowProps> = {}): JSX.Element => (
  <ThreadRow {...rowProps({ session: rowSession({ running: status === 'working' }), workStatus: rowStatus({ status }), ...overrides })} />
)

const tintOf = (container: HTMLElement): string | null => container.querySelector('[data-row-tint]')?.getAttribute('data-row-tint') ?? null

describe('a row that changes state on screen', () => {
  it('holds the new state colour at 12% for the hold time, then fades it, when a turn finishes', async () => {
    const view = render(<TooltipProvider>{row('working')}</TooltipProvider>)
    expect(tintOf(view.container)).toBeNull()
    await act(async () => view.rerender(<TooltipProvider>{row('ready')}</TooltipProvider>))
    expect(tintOf(view.container)).toBe('ready')
    expect(view.container.querySelector('[data-row-tint]')?.className).toContain('dshx:bg-status-ready/12')
    expect(animations).toHaveLength(1)
    const [animation] = animations
    // 1200ms hold + 280ms fade (jsdom reads no tokens, so the kit's defaults apply).
    expect(animation?.options.duration).toBe(1480)
    expect(animation?.keyframes.map(frame => frame.opacity)).toEqual([1, 1, 0])
    expect(animation?.keyframes[1]?.offset).toBeCloseTo(1200 / 1480)
    // Ready rows read bold, beside the green dot.
    expect(view.container.querySelector('[data-thread-head] .dshx\\:font-semibold')?.textContent).toBe('Refactor pricing rounding')
    await act(async () => animation?.onfinish?.())
    expect(tintOf(view.container)).toBeNull()
  })

  it('tints Needs you and Failed in their own colours', async () => {
    const view = render(<TooltipProvider>{row('working')}</TooltipProvider>)
    await act(async () => view.rerender(<TooltipProvider>{row('needs-you')}</TooltipProvider>))
    expect(view.container.querySelector('[data-row-tint]')?.className).toContain('dshx:bg-status-needs-you/12')
    await act(async () => view.rerender(<TooltipProvider>{row('failed')}</TooltipProvider>))
    expect(view.container.querySelector('[data-row-tint]')?.className).toContain('dshx:bg-status-failed/12')
  })

  it('stays plain on a change into Working, Idle or Done', async () => {
    const view = render(<TooltipProvider>{row('ready')}</TooltipProvider>)
    await act(async () => view.rerender(<TooltipProvider>{row('working')}</TooltipProvider>))
    await act(async () => view.rerender(<TooltipProvider>{row('done')}</TooltipProvider>))
    expect(tintOf(view.container)).toBeNull()
    expect(animations).toHaveLength(0)
  })

  it('never tints on first mount, nor when a row scrolls back in after its state changed off screen', async () => {
    const first = render(<TooltipProvider>{row('ready')}</TooltipProvider>)
    expect(tintOf(first.container)).toBeNull()
    first.unmount()
    // A virtualised row that left while Working and mounts again Ready, in a later commit.
    const view = render(<TooltipProvider>{row('working')}</TooltipProvider>)
    view.unmount()
    await act(async () => {})
    const back = render(<TooltipProvider>{row('ready')}</TooltipProvider>)
    expect(tintOf(back.container)).toBeNull()
    expect(animations).toHaveLength(0)
  })

  it('tints a row that moved to its new status group in the same update', async () => {
    const grouped = (status: ThreadStatus['status']) => (
      <TooltipProvider>
        <section key={status}>{row(status)}</section>
      </TooltipProvider>
    )
    const view = render(grouped('working'))
    await act(async () => view.rerender(grouped('ready')))
    expect(tintOf(view.container)).toBe('ready')
  })

  it('skips the tint under reduced motion', async () => {
    reduced = true
    const view = render(<TooltipProvider>{row('working')}</TooltipProvider>)
    await act(async () => view.rerender(<TooltipProvider>{row('ready')}</TooltipProvider>))
    expect(tintOf(view.container)).toBeNull()
    expect(animations).toHaveLength(0)
  })
})
