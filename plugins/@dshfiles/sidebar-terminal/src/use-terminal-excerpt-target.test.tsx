// @vitest-environment jsdom
import { act, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalExcerpt } from './native/client/excerpt.ts'
import { registerTerminalExcerptTarget, terminalExcerptTargetAt } from './native/client/excerpt-targets.ts'
import { useTerminalExcerptTarget } from './native/client/use-terminal-excerpt-target.ts'

const container = document.createElement('div')
let root: Root

function Screen({ selection, attach }: { readonly selection?: TerminalExcerpt; readonly attach: (excerpt: TerminalExcerpt) => void }): ReactNode {
  const screen = useRef<HTMLDivElement>(null)
  const current = useRef(selection)
  current.current = selection
  const onAttach = useRef(attach)
  onAttach.current = attach
  useTerminalExcerptTarget({ register: registerTerminalExcerptTarget, screen, selection: current, attach: onAttach })
  return <div ref={screen} data-screen />
}

const screenNode = (): HTMLElement => {
  const node = container.querySelector('[data-screen]')
  if (!(node instanceof HTMLElement)) throw new Error('the terminal screen did not render')
  return node
}

const render = (props: { readonly selection?: TerminalExcerpt; readonly attach: (excerpt: TerminalExcerpt) => void }): void => {
  act(() => {
    root.render(<Screen {...props} />)
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

it('exposes the mounted selection to the excerpt shortcut', () => {
  const attach = vi.fn()
  render({ selection: { text: 'first\nsecond', label: 'Terminal 3-4' }, attach })
  const target = terminalExcerptTargetAt(screenNode())
  expect(target?.selected()).toBe(true)
  target?.attach()
  expect(attach).toHaveBeenCalledExactlyOnceWith({ text: 'first\nsecond', label: 'Terminal 3-4' })
})

it('reports no selection while the terminal has none', () => {
  render({ attach: vi.fn() })
  expect(terminalExcerptTargetAt(screenNode())?.selected()).toBe(false)
})

it('stops listening when the screen unmounts', () => {
  render({ selection: { text: 'quoted', label: 'Terminal 7' }, attach: vi.fn() })
  const node = screenNode()
  expect(terminalExcerptTargetAt(node)).toBeDefined()
  act(() => {
    root.unmount()
  })
  expect(terminalExcerptTargetAt(node)).toBeUndefined()
})
