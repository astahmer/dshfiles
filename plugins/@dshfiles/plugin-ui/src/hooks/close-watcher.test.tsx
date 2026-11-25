// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { closeWatcherAvailable, useCloseWatcher } from './close-watcher.js'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis, 'CloseWatcher')
})

const Layer = (props: { readonly open: boolean; readonly onClose: () => void }): JSX.Element => {
  useCloseWatcher(props.open, props.onClose)
  return <div />
}

const installFakeCloseWatcher = (): { readonly watchers: { oncancel: ((event: Event) => void) | null; destroy: () => void }[] } => {
  const watchers: { oncancel: ((event: Event) => void) | null; destroy: () => void }[] = []
  class FakeCloseWatcher {
    oncancel: ((event: Event) => void) | null = null
    readonly destroy = vi.fn()
    constructor() {
      watchers.push(this)
    }
  }
  Object.defineProperty(globalThis, 'CloseWatcher', { configurable: true, value: FakeCloseWatcher })
  return { watchers }
}

test('a system back gesture (cancel) closes the layer once and unmount destroys the watcher', () => {
  const { watchers } = installFakeCloseWatcher()
  const onClose = vi.fn()
  const view = render(<Layer open onClose={onClose} />)
  expect(watchers).toHaveLength(1)
  act(() => {
    watchers[0]?.oncancel?.(new Event('cancel', { cancelable: true }))
  })
  expect(onClose).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(watchers[0]?.destroy).toHaveBeenCalledTimes(1)
})

test('a closed layer installs nothing and browsers without the API keep their own handling', () => {
  installFakeCloseWatcher()
  const view = render(<Layer open={false} onClose={vi.fn()} />)
  expect(closeWatcherAvailable()).toBe(true)
  view.unmount()
  Reflect.deleteProperty(globalThis, 'CloseWatcher')
  expect(closeWatcherAvailable()).toBe(false)
  render(<Layer open onClose={vi.fn()} />)
})
