// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkingStatusItem } from './working-status-item.js'
import { WorkingThreadsProjection } from './working-threads.js'

type ActiveQuestion = NonNullable<NonNullable<SessionSummary['projectionValues']>['userQuestions']>['active'][number]
// SAFETY: the item only counts the active questions; it never reads one.
const QUESTION = {} as ActiveQuestion

const session = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: SessionId(id),
  displayTitle: id,
  updatedAt: 1,
  running: true,
  blank: false,
  retainedBy: {},
  ...overrides,
})

/** Three threads run a turn; one of them waits for the user's answer, another for an approval only the thread list sees. */
const sessions = (): SessionListState => {
  const rows = [session('held'), session('asks-you', { projectionValues: { userQuestions: { active: [QUESTION], settled: [] } } }), session('awaits-approval')]
  return { ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])), phase: 'ready', projectionsBySession: {} }
}

const mount = (): void => {
  const state = sessions()
  render(<WorkingStatusItem compact={false} useSessions={select => select(state)} label={count => `${String(count)} working`} />)
}

afterEach(() => {
  act(() => WorkingThreadsProjection.publish(null))
  cleanup()
})

describe('the status strip working item', () => {
  it('shows the count the thread list groups under Working, not every thread with a running turn', () => {
    document.title = 'DSH'
    mount()
    act(() => WorkingThreadsProjection.publish(1))
    expect(screen.getByTestId('status-item-working').textContent).toBe('1 working')
    expect(document.title).toBe('⟳ 1 · DSH')
  })

  it('without a mounted thread list, counts running top-level threads and still leaves out one that asks a question', () => {
    mount()
    // The collapsed sidebar must not read "3 working" where the list read "Working (2)" a moment before.
    expect(screen.getByTestId('status-item-working').textContent).toBe('2 working')
  })

  it('hides when the list says nothing works', () => {
    mount()
    act(() => WorkingThreadsProjection.publish(0))
    expect(screen.queryByTestId('status-item-working')).toBeNull()
  })
})
