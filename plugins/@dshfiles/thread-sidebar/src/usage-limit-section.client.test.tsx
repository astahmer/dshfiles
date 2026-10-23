// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSidebarLocaleKey } from './locales.js'
import type { QuotaContinuation } from './usage-limit-rows.js'
import { UsageLimitSection } from './usage-limit-section.js'

const NOW = 1_000_000_000

const continuation = (patch: Partial<QuotaContinuation> = {}): QuotaContinuation => ({
  continuationId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'blocked',
  accountId: 'codex_work',
  failedAt: NOW - 60_000,
  resetAt: NOW + 90 * 60_000,
  autoRetry: false,
  snoozedUntil: null,
  state: 'waiting',
  scheduled: false,
  ready: false,
  ...patch,
})

const labels = new Map<ThreadSidebarLocaleKey, string>([
  ['threadSidebarUsageLimit', 'Usage limit'],
  ['threadSidebarUsageLimitResume', 'Resume this thread'],
  ['threadSidebarUsageLimitResumeAll', 'Resume all'],
  ['threadSidebarUsageLimitReady', 'Ready to resume'],
  ['threadSidebarUsageLimitUnknown', 'Reset time unknown'],
  ['threadSidebarUsageLimitScheduled', 'Retry scheduled'],
  ['threadSidebarUsageLimitAutoRetryOn', 'Auto-retry on'],
  ['threadSidebarUsageLimitOptions', 'Usage limit options'],
  ['threadSidebarUsageLimitSnoozeHour', 'Snooze 1 hour'],
  ['threadSidebarUsageLimitSnoozeFourHours', 'Snooze 4 hours'],
  ['threadSidebarUsageLimitSnoozeDay', 'Snooze 1 day'],
  ['threadSidebarUsageLimitSnoozeOff', 'Unsnooze'],
  ['threadSidebarUsageLimitAutoRetry', 'Retry automatically'],
  ['threadSidebarUsageLimitRecovery', 'Recovery'],
  ['threadSidebarUsageLimitDismiss', 'Dismiss'],
])

const translate = (key: ThreadSidebarLocaleKey, params?: Readonly<Record<string, string | number>>): string => {
  const template = labels.get(key) ?? key
  if (key === 'threadSidebarUsageLimitResets') return `Resets in ${String(params?.time ?? '')}`
  if (key === 'threadSidebarUsageLimitSnoozed') return `Snoozed for ${String(params?.time ?? '')}`
  return template
}

const fill = (input: {
  readonly continuations: readonly QuotaContinuation[]
  readonly titles?: readonly string[]
  readonly busy?: readonly string[]
  readonly selectedSessionId?: string | undefined
}) => {
  const onResume = vi.fn()
  const onResumeAll = vi.fn()
  const onDismiss = vi.fn()
  const open = vi.fn()
  const titles = input.titles ?? input.continuations.map((_, index) => `Blocked ${String(index + 1)}`)
  render(
    <UsageLimitSection
      busyIds={new Set(input.busy ?? [])}
      now={NOW}
      onAutoRetry={vi.fn()}
      onResume={onResume}
      onResumeAll={onResumeAll}
      onDismiss={onDismiss}
      onSnooze={vi.fn()}
      open={open}
      selectedSessionId={input.selectedSessionId}
      resumeAllBusy={false}
      rows={input.continuations.map((item, index) => ({
        continuation: item,
        session: { id: item.sessionId, displayTitle: titles[index] ?? 'Blocked' },
      }))}
      translate={translate}
      withThreadMenu={(thread, row) => (
        <div data-thread-menu={thread.id} key={thread.id}>
          {row}
        </div>
      )}
    />,
  )
  return { onResume, onResumeAll, onDismiss, open }
}

afterEach(cleanup)

describe('usage limit section', () => {
  it('renders nothing while no recovery is pending', () => {
    const { container } = render(
      <UsageLimitSection
        busyIds={new Set()}
        now={NOW}
        onAutoRetry={vi.fn()}
        onResume={vi.fn()}
        onResumeAll={vi.fn()}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        open={vi.fn()}
        resumeAllBusy={false}
        rows={[]}
        translate={translate}
        withThreadMenu={(_thread, row) => row}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('puts every row inside its own thread menu, so a right click offers the thread actions', () => {
    fill({ continuations: [continuation(), continuation({ continuationId: 'bb', sessionId: 'other' })], titles: ['First', 'Second'] })

    expect(screen.getByText('First').closest('[data-thread-menu]')?.getAttribute('data-thread-menu')).toBe('blocked')
    expect(screen.getByText('Second').closest('[data-thread-menu]')?.getAttribute('data-thread-menu')).toBe('other')
  })

  it('names each blocked thread with its reset countdown and size', () => {
    fill({ continuations: [continuation(), continuation({ continuationId: 'bb', sessionId: 'other', ready: true })], titles: ['First', 'Second'] })

    expect(screen.getByRole('region', { name: 'Usage limit' })).toBeDefined()
    expect(screen.getByText('(2)')).toBeDefined()
    expect(screen.getByText('First')).toBeDefined()
    expect(screen.getByText('Resets in 1h 30m')).toBeDefined()
    expect(screen.getByText('Ready to resume')).toBeDefined()
  })

  it('marks selected recovery rows as keyboard-navigable active threads', () => {
    fill({ continuations: [continuation()], selectedSessionId: 'blocked' })

    const button = screen.getByText('Blocked 1').closest('button')
    expect(button?.dataset.threadMainAction).toBe('')
    expect(button?.dataset.threadId).toBe('blocked')
    expect(button?.getAttribute('aria-current')).toBe('page')
  })

  it('reads a snooze, an unknown reset, and the auto-retry switch off the record', () => {
    fill({
      continuations: [
        continuation({ snoozedUntil: NOW + 3_600_000 }),
        continuation({ continuationId: 'bb', sessionId: 'other', resetAt: null }),
        continuation({ continuationId: 'cc', sessionId: 'third', autoRetry: true, scheduled: true }),
      ],
      titles: ['Snoozed', 'Unknown', 'Auto'],
    })

    expect(screen.getByText('Snoozed for 1h')).toBeDefined()
    expect(screen.getByText('Reset time unknown')).toBeDefined()
    expect(screen.getByText('Auto-retry on')).toBeDefined()
    expect(screen.getByText('Retry scheduled')).toBeDefined()
  })

  it('resumes one thread, resumes all of them, and opens the thread behind a row', () => {
    const { onResume, onResumeAll, open } = fill({ continuations: [continuation(), continuation({ continuationId: 'bb', sessionId: 'other' })] })

    screen.getAllByRole('button', { name: 'Resume this thread' })[0]?.click()
    expect(onResume).toHaveBeenCalledWith({ continuationId: '11111111-1111-4111-8111-111111111111', sessionId: 'blocked' })

    screen.getByRole('button', { name: 'Resume all' }).click()
    expect(onResumeAll).toHaveBeenCalledTimes(1)

    screen.getByText('Blocked 1').closest('button')?.click()
    expect(open).toHaveBeenCalledWith('blocked')
  })

  it('dismisses one blocked thread without resuming it, and leads with a primary Resume all', () => {
    const { onDismiss, onResume } = fill({ continuations: [continuation()] })

    expect(screen.getByRole('button', { name: 'Resume all' }).getAttribute('data-variant')).toBe('default')
    screen.getByRole('button', { name: 'Dismiss' }).click()
    expect(onDismiss).toHaveBeenCalledWith({ continuationId: '11111111-1111-4111-8111-111111111111' })
    expect(onResume).not.toHaveBeenCalled()
  })

  it('disables the row actions while its own recovery is in flight', () => {
    fill({ continuations: [continuation()], busy: ['11111111-1111-4111-8111-111111111111'] })

    expect(screen.getByRole('button', { name: 'Resume this thread' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Usage limit options' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Dismiss' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Resume all' }).hasAttribute('disabled')).toBe(true)
  })
})
