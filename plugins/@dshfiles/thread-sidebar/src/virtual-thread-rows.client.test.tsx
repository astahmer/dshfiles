// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useRef } from 'react'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { ThreadSelectionModel, type ThreadSelectionState } from './thread-selection.js'
import { VirtualThreadRows } from './virtual-thread-rows.js'

const ROW_HEIGHT = 30
const VIEWPORT_HEIGHT = 300
const ids = Array.from({ length: 200 }, (_, index) => `s${index}`)

let selection: ThreadSelectionState = ThreadSelectionModel.empty()

const List = (props: { readonly pinned?: string }): JSX.Element => {
  const scroller = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={scroller}
      data-testid="scroller"
      onKeyDown={event =>
        ThreadListNavigationModel.navigate({
          event: event.nativeEvent,
          list: event.currentTarget,
          selection,
          onSelectionChange: next => {
            selection = next
          },
          onLookahead: () => undefined,
        })
      }
    >
      <section>
        <VirtualThreadRows
          entries={ids}
          keyOf={id => id}
          threadIdOf={id => id}
          render={id => (
            <article data-thread-id={id}>
              <button type="button" data-thread-main-action="" data-thread-id={id}>
                {id}
              </button>
            </article>
          )}
          scrollElement={scroller}
          pinnedThreadIds={[props.pinned]}
          revealThreadId={undefined}
          estimateSize={ROW_HEIGHT}
          enabled
        />
      </section>
    </div>
  )
}

const mountedIds = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('button[data-thread-main-action]')).map(button => button.dataset.threadId ?? '')

const activeThreadId = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.threadId : undefined)

beforeEach(() => {
  selection = ThreadSelectionModel.empty()
  let scrollTop = 0
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'scroller' ? VIEWPORT_HEIGHT : ROW_HEIGHT
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'scroller' ? scrollTop : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) {
    if (this.dataset.testid !== 'scroller') return
    scrollTop = Math.max(0, Math.min(value, ids.length * ROW_HEIGHT - VIEWPORT_HEIGHT))
    this.dispatchEvent(new Event('scroll'))
  })
  // Like a browser: the list moves up inside the viewport as the viewport scrolls.
  const rect = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-virtual-thread-rows') ? new DOMRect(0, -scrollTop, 240, ids.length * ROW_HEIGHT) : rect.call(this)
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(ids.length * ROW_HEIGHT)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('mounts only the rows near the viewport of a long section', () => {
  const view = render(<List />)
  const mounted = mountedIds(view.container)
  expect(mounted[0]).toBe('s0')
  expect(mounted.length).toBeGreaterThan(VIEWPORT_HEIGHT / ROW_HEIGHT)
  expect(mounted.length).toBeLessThan(30)
  expect(view.container.querySelector('[role="listitem"]')?.getAttribute('aria-setsize')).toBe('200')
})

test('keeps a pinned off-screen row mounted', () => {
  const view = render(<List pinned="s150" />)
  expect(mountedIds(view.container)).toEqual(expect.arrayContaining(['s149', 's150', 's151']))
})

test('End reaches the last row although it was not mounted', async () => {
  const view = render(<List />)
  expect(mountedIds(view.container)).not.toContain('s199')
  const first = view.container.querySelector<HTMLButtonElement>('button[data-thread-id="s0"]')
  act(() => first?.focus())
  fireEvent.keyDown(first ?? document.body, { key: 'End' })
  await waitFor(() => expect(activeThreadId()).toBe('s199'))
})

test('ArrowDown from the last row in view reaches the next one', () => {
  const view = render(<List />)
  const last = view.container.querySelector<HTMLButtonElement>(`button[data-thread-id="s${VIEWPORT_HEIGHT / ROW_HEIGHT - 1}"]`)
  act(() => last?.focus())
  fireEvent.keyDown(last ?? document.body, { key: 'ArrowDown' })
  expect(activeThreadId()).toBe(`s${VIEWPORT_HEIGHT / ROW_HEIGHT}`)
})

test('select all covers rows that are not mounted', () => {
  const view = render(<List />)
  const first = view.container.querySelector<HTMLButtonElement>('button[data-thread-id="s0"]')
  act(() => first?.focus())
  fireEvent.keyDown(first ?? document.body, { key: 'a', metaKey: true })
  expect(selection.sessionIds).toHaveLength(200)
})
