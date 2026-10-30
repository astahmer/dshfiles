// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'

import { BacklogFocusModel } from './backlog-focus.js'
import { usePanelRequests } from './use-panel-requests.js'

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))

it('keeps requests until a visible legacy panel claims them once, without navigating other occurrences', async () => {
  const received: string[] = []
  const Panel = (props: { name: string; draftKey: string; visible: boolean }) => {
    usePanelRequests({
      draftKey: props.draftKey,
      visible: props.visible,
      onFocus: id => received.push(`${props.name}:item:${id}`),
      onCapture: request => received.push(`${props.name}:capture:${request.text}`),
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <>
        <Panel name="hidden" draftKey="feed" visible={false} />
        <Panel name="repeat" draftKey="panel/repeat" visible />
      </>,
    ),
  )
  await act(async () => {
    BacklogFocusModel.request(42)
    BacklogFocusModel.requestCapture('new thought')
  })
  expect(received).toEqual([])
  expect(BacklogFocusModel.read()).toBe(42)
  expect(BacklogFocusModel.readCapture()?.text).toBe('new thought')
  await act(async () =>
    root.render(
      <>
        <Panel name="hidden" draftKey="feed" visible={false} />
        <Panel name="repeat" draftKey="panel/repeat" visible />
        <Panel name="main" draftKey="feed" visible />
        <Panel name="other legacy" draftKey="feed" visible />
      </>,
    ),
  )
  expect(received).toEqual(['main:item:42', 'main:capture:new thought'])
  expect(BacklogFocusModel.read()).toBeNull()
  expect(BacklogFocusModel.readCapture()).toBeNull()
  await act(async () => root.unmount())
})
