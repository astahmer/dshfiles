// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'

import { BacklogFocusModel } from './backlog-focus.js'
import { usePanelRequests } from './use-panel-requests.js'

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))

it('opens the item in the Backlog page that is on screen, including a Workbench occurrence of it', async () => {
  const received: string[] = []
  const Panel = (props: { readonly name: string; readonly visible: boolean }) => {
    usePanelRequests({
      visible: props.visible,
      onFocus: id => received.push(`${props.name}:item:${id}`),
      onCapture: request => received.push(`${props.name}:capture:${request.text}`),
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Panel name="hidden" visible={false} />))
  await act(async () => {
    BacklogFocusModel.request(7)
    BacklogFocusModel.requestCapture('workbench capture')
  })
  expect(received).toEqual([])
  await act(async () => root.render(<Panel name="workbench" visible />))
  expect(received).toEqual(['workbench:item:7', 'workbench:capture:workbench capture'])
  expect(BacklogFocusModel.read()).toBeNull()
  expect(BacklogFocusModel.readCapture()).toBeNull()
  await act(async () => root.unmount())
})

it('keeps requests until a visible page claims them once, without another visible page taking them', async () => {
  const received: string[] = []
  const Panel = (props: { readonly name: string; readonly visible: boolean }) => {
    usePanelRequests({
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
        <Panel name="hidden" visible={false} />
        <Panel name="repeat" visible={false} />
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
  await act(async () => root.render(<Panel name="main" visible />))
  expect(received).toEqual(['main:item:42', 'main:capture:new thought'])
  expect(BacklogFocusModel.read()).toBeNull()
  expect(BacklogFocusModel.readCapture()).toBeNull()
  await act(async () => root.unmount())
})
