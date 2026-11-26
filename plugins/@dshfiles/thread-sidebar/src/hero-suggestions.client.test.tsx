// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxThreadSignal } from './thread-status.js'

const signal = (severity: InboxThreadSignal['severity']): InboxThreadSignal => ({ itemId: `item-${severity}`, severity, reason: 'reason', verb: undefined, openedAt: 0 })

vi.mock('./inbox-signals.js', () => ({
  useInboxThreadSignals: () => ({
    signals: new Map<string, InboxThreadSignal>([
      ['a', signal('blocking')],
      ['b', signal('blocking')],
      ['c', signal('failed')],
    ]),
  }),
}))

const { HeroSuggestionCards } = await import('./hero-suggestions.js')

const session = (id: string) => ({ id, title: `Thread ${id}`, displayTitle: `Thread ${id}`, blank: false, running: true, updatedAt: 0, cwd: '/work', parentId: undefined })
const state = { ids: ['a', 'b', 'c'], byId: { a: session('a'), b: session('b'), c: session('c') } }

afterEach(cleanup)

describe('the New thread Inbox chip', () => {
  it('counts what waits and what failed with StatusCount badges, not a sentence (council round 12 C4)', () => {
    const view = render(
      <HeroSuggestionCards
        heroSessionId={undefined}
        // SAFETY: the cards read only `ids` and these `byId` fields; the test store holds exactly those.
        useSessions={((select: (value: typeof state) => typeof state) => select(state)) as never}
        actions={{ open: vi.fn(), review: vi.fn(() => true), openInbox: vi.fn() }}
        now={() => 0}
      />,
    )
    const chip = view.container.querySelector<HTMLElement>('[data-hero-card="inbox"]')
    expect(chip).not.toBeNull()
    const counts = [...(chip?.querySelectorAll<HTMLElement>('[data-slot="status-count"]') ?? [])]
    expect(counts.map(count => count.getAttribute('data-status'))).toEqual(['needs-you', 'failed'])
    expect(counts.map(count => count.textContent?.trim().charAt(0))).toEqual(['2', '1'])
    // The sentence is the chip's accessible name only: no visible "waiting on you" text.
    expect(chip?.getAttribute('aria-label')).toBe('Inbox, 2 waiting on you · 1 failed')
    const visible = [...(chip?.querySelectorAll<HTMLElement>('span') ?? [])].filter(span => span.children.length === 0 && !span.className.includes('sr-only'))
    expect(visible.some(span => span.textContent?.includes('waiting on you'))).toBe(false)
    // The 16px icon rule reaches only the chip's own icon, not the badges' glyphs.
    expect(chip?.className).toContain('dshx:[&>svg]:size-4')
    expect(chip?.className).not.toContain('dshx:[&_svg]:size-4')
  })
})
