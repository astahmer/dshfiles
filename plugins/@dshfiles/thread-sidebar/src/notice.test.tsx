import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { afterEach, test, vi } from 'vitest'
import {
  ARCHIVED_OPEN_NOTICE_DURATION_MS,
  archivedOpenFailureNotice,
  failedResumeNotice,
  INITIAL_SIDEBAR_NOTICE_QUEUE_STATE,
  MAX_PENDING_SIDEBAR_NOTICES,
  scheduleSuccessNoticeDismissal,
  SidebarNoticeMessage,
  sidebarNoticeQueueReducer,
  SUCCESS_NOTICE_DURATION_MS,
  type SidebarNotice,
} from './sidebar-notice.js'

afterEach(() => {
  vi.useRealTimers()
})

const createNoticeState = (initialNotice: SidebarNotice | null) => {
  let currentNotice = initialNotice
  const update = (updateNotice: (current: SidebarNotice | null) => SidebarNotice | null): void => {
    currentNotice = updateNotice(currentNotice)
  }

  return {
    get current() {
      return currentNotice
    },
    update,
  }
}

test('notice message uses the visible alert column and stays on one line', () => {
  const html = renderToString(<SidebarNoticeMessage message="Thread link copied." />)
  assert.match(html, /data-slot="alert-description"/)
  assert.match(html, /dshx:col-start-2/)
  assert.match(html, /dshx:whitespace-nowrap/)
  assert.match(html, /Thread link copied\./)
})

test('partial resume notices open the first failed thread so its current state can be checked', () => {
  const opened: string[] = []
  const notice = failedResumeNotice({
    message: 'Resume sent to 3 threads; 1 could not be resumed.',
    actionLabel: 'Open a failed thread',
    failedSessionIds: ['session-failed', 'session-failed-too'],
    openThread: sessionId => opened.push(sessionId),
  })

  assert.equal(notice.tone, 'warning')
  assert.equal(notice.message, 'Resume sent to 3 threads; 1 could not be resumed.')
  assert.equal(notice.actionLabel, 'Open a failed thread')
  notice.onAction?.()
  assert.deepEqual(opened, ['session-failed'])
})

test('partial resume notices have no open action when there is no failed thread', () => {
  const notice = failedResumeNotice({
    message: 'Resume sent.',
    actionLabel: 'Open a failed thread',
    failedSessionIds: [],
    openThread: () => assert.fail('did not expect an open action'),
  })

  assert.equal(notice.actionLabel, undefined)
  assert.equal(notice.onAction, undefined)
})

test('success notices dismiss after three seconds', () => {
  vi.useFakeTimers()
  const successNotice: SidebarNotice = { tone: 'success', message: 'Thread link copied.' }
  const state = createNoticeState(successNotice)
  const dispose = scheduleSuccessNoticeDismissal(successNotice, state.update)

  vi.advanceTimersByTime(SUCCESS_NOTICE_DURATION_MS - 1)
  assert.equal(state.current, successNotice)
  vi.advanceTimersByTime(1)
  assert.equal(state.current, null)
  dispose?.()
})

test('undo notices stay visible for their requested duration', () => {
  vi.useFakeTimers()
  const undoNotice: SidebarNotice = { tone: 'success', message: 'Thread archived.', durationMs: 2_000 }
  const state = createNoticeState(undoNotice)
  const dispose = scheduleSuccessNoticeDismissal(undoNotice, state.update)

  vi.advanceTimersByTime(1_999)
  assert.equal(state.current, undoNotice)
  vi.advanceTimersByTime(1)
  assert.equal(state.current, null)
  dispose?.()
})

test('a configured partial-archive notice also expires after its selected duration', () => {
  vi.useFakeTimers()
  const partialArchiveNotice: SidebarNotice = { tone: 'danger', message: 'One thread failed.', durationMs: 1_250 }
  const state = createNoticeState(partialArchiveNotice)
  const dispose = scheduleSuccessNoticeDismissal(partialArchiveNotice, state.update)

  vi.advanceTimersByTime(1_249)
  assert.equal(state.current, partialArchiveNotice)
  vi.advanceTimersByTime(1)
  assert.equal(state.current, null)
  dispose?.()
})

test('a success timeout does not dismiss a replacement notice', () => {
  vi.useFakeTimers()
  const successNotice: SidebarNotice = { tone: 'success', message: 'Thread link copied.' }
  const replacementNotice: SidebarNotice = { tone: 'danger', message: 'Clipboard failed.' }
  const state = createNoticeState(successNotice)
  const dispose = scheduleSuccessNoticeDismissal(successNotice, state.update)

  state.update(() => replacementNotice)
  vi.advanceTimersByTime(SUCCESS_NOTICE_DURATION_MS)
  assert.equal(state.current, replacementNotice)
  dispose?.()
})

test('the archived-open recovery notice dismisses after its own duration', () => {
  vi.useFakeTimers()
  const recoveryNotice = archivedOpenFailureNotice({
    message: 'Thread is archived.',
    actionLabel: 'Restore and open',
    onAction: () => {},
  })
  const state = createNoticeState(null)
  state.update(() => recoveryNotice)
  const dispose = scheduleSuccessNoticeDismissal(recoveryNotice, state.update)

  vi.advanceTimersByTime(ARCHIVED_OPEN_NOTICE_DURATION_MS - 1)
  assert.equal(state.current, recoveryNotice)
  vi.advanceTimersByTime(1)
  assert.equal(state.current, null)
  dispose?.()
})

test('in-app notice bursts remain queued and display in arrival order', () => {
  const firstNotice: SidebarNotice = { tone: 'warning', message: 'Question from one.' }
  const secondNotice: SidebarNotice = { tone: 'success', message: 'Turn finished for two.', durationMs: 5_000 }
  const firstState = sidebarNoticeQueueReducer(INITIAL_SIDEBAR_NOTICE_QUEUE_STATE, { type: 'enqueue-notification', notice: firstNotice })
  const burstState = sidebarNoticeQueueReducer(firstState, { type: 'enqueue-notification', notice: secondNotice })

  assert.equal(burstState.current, firstNotice)
  assert.deepEqual(burstState.pending, [secondNotice])

  const nextState = sidebarNoticeQueueReducer(burstState, { type: 'update', update: () => null })
  assert.equal(nextState.current, secondNotice)
  assert.deepEqual(nextState.pending, [])
})

test('replacing a visible in-app notice preserves it ahead of later queued notices', () => {
  const firstNotice: SidebarNotice = { tone: 'warning', message: 'Question from one.' }
  const secondNotice: SidebarNotice = { tone: 'success', message: 'Turn finished for two.' }
  const replacementNotice: SidebarNotice = { tone: 'danger', message: 'Another action failed.' }
  const firstState = sidebarNoticeQueueReducer(INITIAL_SIDEBAR_NOTICE_QUEUE_STATE, { type: 'enqueue-notification', notice: firstNotice })
  const burstState = sidebarNoticeQueueReducer(firstState, { type: 'enqueue-notification', notice: secondNotice })
  const replacedState = sidebarNoticeQueueReducer(burstState, { type: 'set', notice: replacementNotice })

  assert.equal(replacedState.current, replacementNotice)
  assert.deepEqual(replacedState.pending, [firstNotice, secondNotice])
  const nextState = sidebarNoticeQueueReducer(replacedState, { type: 'set', notice: null })
  assert.equal(nextState.current, firstNotice)
  assert.deepEqual(nextState.pending, [secondNotice])
})

test('pending notice queue stays bounded', () => {
  const notices = Array.from(
    { length: MAX_PENDING_SIDEBAR_NOTICES + 2 },
    (_, index) => ({ tone: 'success', message: `Notice ${index}` }) satisfies SidebarNotice,
  )
  const state = notices.reduce(
    (current, notice) => sidebarNoticeQueueReducer(current, { type: 'enqueue-notification', notice }),
    INITIAL_SIDEBAR_NOTICE_QUEUE_STATE,
  )

  assert.equal(state.pending.length, MAX_PENDING_SIDEBAR_NOTICES)
  assert.equal(state.pending[0]?.message, 'Notice 2')
})

test('failure notices stay visible', () => {
  vi.useFakeTimers()
  const failureNotice: SidebarNotice = { tone: 'danger', message: 'Clipboard failed.' }
  const state = createNoticeState(failureNotice)

  assert.equal(scheduleSuccessNoticeDismissal(failureNotice, state.update), undefined)
  vi.advanceTimersByTime(SUCCESS_NOTICE_DURATION_MS)
  assert.equal(state.current, failureNotice)
  assert.equal(vi.getTimerCount(), 0)
})
