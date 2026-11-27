// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LAZY_VIEW_QUIET_MS, lazyView } from './lazy-view.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const Panel = (props: { readonly name: string }) => <p>panel {props.name}</p>

test('shows nothing for the quiet window, then one quiet loading line, then the view with its props', async () => {
  const load = deferred<typeof Panel>()
  const View = lazyView(() => load.promise, { label: 'History' })
  const { container } = render(<View name="graph" />)
  expect(container.textContent).toBe('')
  act(() => vi.advanceTimersByTime(LAZY_VIEW_QUIET_MS - 1))
  expect(container.textContent).toBe('')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status').textContent).toBe('Loading History…')
  await act(async () => load.resolve(Panel))
  expect(container.textContent).toBe('panel graph')
})

test('a view inside a sentence names its own loading line', () => {
  const View = lazyView(() => new Promise<typeof Panel>(() => undefined), { label: 'Diff', loading: 'Loading the diff…' })
  render(<View name="hunk" />)
  act(() => vi.advanceTimersByTime(LAZY_VIEW_QUIET_MS))
  expect(screen.getByRole('status').textContent).toBe('Loading the diff…')
})

test('renders at once, with no loading state, once the view has loaded', async () => {
  const View = lazyView(async () => Panel, { label: 'Backlog' })
  await act(async () => View.preload())
  const { container } = render(<View name="ready" />)
  expect(container.textContent).toBe('panel ready')
})

test('a chunk that failed to load offers Retry, which loads it again', async () => {
  const load = vi.fn<() => Promise<typeof Panel>>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Panel)
  const View = lazyView(load, { label: 'Usage' })
  const { container } = render(<View name="charts" />)
  await act(async () => vi.advanceTimersByTime(LAZY_VIEW_QUIET_MS))
  expect(container.querySelector('[data-slot="load-error"]')).not.toBeNull()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))
  expect(load).toHaveBeenCalledTimes(2)
  expect(container.textContent).toBe('panel charts')
})
