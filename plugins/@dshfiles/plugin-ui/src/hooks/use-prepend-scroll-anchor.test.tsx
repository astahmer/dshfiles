// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, test } from 'vitest'
import { usePrependScrollAnchor } from './use-prepend-scroll-anchor.js'

const Probe = (props: { readonly pageCount: number; readonly scope: string }): JSX.Element => {
  const root = useRef<HTMLDivElement>(null)
  const capture = usePrependScrollAnchor({ pageCount: props.pageCount, root, scope: props.scope })
  return (
    <div ref={root} data-testid="scroll-root">
      <button onClick={capture}>Capture</button>
    </div>
  )
}

afterEach(cleanup)

test('keeps the visible content in place when an older page is prepended', () => {
  let height = 1000
  const view = render(<Probe pageCount={1} scope="topic-a" />)
  const root = view.getByTestId('scroll-root')
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => height })
  root.scrollTop = 180

  fireEvent.click(view.getByRole('button', { name: 'Capture' }))
  height = 1450
  act(() => view.rerender(<Probe pageCount={2} scope="topic-a" />))

  expect(root.scrollTop).toBe(630)
})

test('drops a pending anchor when the list scope changes', () => {
  let height = 1000
  const view = render(<Probe pageCount={2} scope="topic-a" />)
  const root = view.getByTestId('scroll-root')
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => height })
  root.scrollTop = 180

  fireEvent.click(view.getByRole('button', { name: 'Capture' }))
  height = 1450
  act(() => view.rerender(<Probe pageCount={3} scope="topic-b" />))

  expect(root.scrollTop).toBe(180)
})
