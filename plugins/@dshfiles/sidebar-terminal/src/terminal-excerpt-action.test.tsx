import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { en } from './native/client/locales.ts'
import { TerminalExcerptAction, type TerminalExcerptActionProps } from './native/client/TerminalExcerptAction.tsx'

const excerpt = { text: 'first\nsecond', label: 'Terminal 3-4' }
const styles = { excerptAction: 'action', excerptFailed: 'failed' }
const container = document.createElement('div')
let root: Root

const render = (props: Partial<TerminalExcerptActionProps> = {}): void => {
  act(() => {
    root.render(
      <TerminalExcerptAction
        excerpt={excerpt}
        attach={() => {}}
        failed={false}
        label={en.addExcerpt}
        failedLabel={en.excerptFailed}
        styles={styles}
        {...props}
      />,
    )
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

it('shows no excerpt action until the terminal holds a selection', () => {
  render({ excerpt: undefined })
  expect(container.querySelector('button')).toBeNull()
})

it('attaches the selected excerpt on one activation', () => {
  const attach = vi.fn()
  render({ attach })
  const button = container.querySelector('button')
  expect(button?.textContent).toBe(en.addExcerpt)
  act(() => {
    button?.click()
  })
  expect(attach).toHaveBeenCalledExactlyOnceWith(excerpt)
})

it('keeps the selection when the click lands', () => {
  render()
  const kept = container.querySelector('button')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  expect(kept).toBe(false)
})

it('explains how to recover when the thread cannot take the excerpt', () => {
  render({ failed: true })
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.excerptFailed)
  expect(en.excerptFailed).toContain('Open this session and try again')
})
