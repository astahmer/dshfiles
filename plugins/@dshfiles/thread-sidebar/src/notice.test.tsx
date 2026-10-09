import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { afterEach, test, vi } from 'vitest'
import { scheduleSuccessNoticeDismissal, SidebarNoticeMessage, SUCCESS_NOTICE_DURATION_MS, type SidebarNotice } from './sidebar-notice.js'

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

test('failure notices stay visible', () => {
  vi.useFakeTimers()
  const failureNotice: SidebarNotice = { tone: 'danger', message: 'Clipboard failed.' }
  const state = createNoticeState(failureNotice)

  assert.equal(scheduleSuccessNoticeDismissal(failureNotice, state.update), undefined)
  vi.advanceTimersByTime(SUCCESS_NOTICE_DURATION_MS)
  assert.equal(state.current, failureNotice)
  assert.equal(vi.getTimerCount(), 0)
})
