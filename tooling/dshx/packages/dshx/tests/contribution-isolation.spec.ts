// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { BrowserBroker } from '../src/client/broker.js'
import { IsolationModel } from '../src/client/isolation.js'

const nodeRequire = createRequire(import.meta.url)
const { createRoot } = nodeRequire('react-dom/client') as { createRoot(container: Element): { render(node: unknown): void; unmount(): void } }
const { act } = nodeRequire('react') as { act(callback: () => void): void }

afterEach(() => {
  BrowserBroker.reset()
  vi.restoreAllMocks()
})

describe('contribution isolation', () => {
  it('renders nothing for a contribution that throws, keeps its siblings and records the failure', () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = () => {
      throw new Error('render broke')
    }
    const Steady = () => createElement('span', null, 'steady')
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(
          'div',
          null,
          createElement(IsolationModel.isolate(Broken, { owner: '@test/owner', id: 'broken' })),
          createElement(IsolationModel.isolate(Steady, { owner: '@test/owner', id: 'steady' })),
        ),
      ),
    )
    expect(container.innerHTML).toBe('<div><span>steady</span></div>')
    expect(BrowserBroker.failures.get()).toEqual([expect.objectContaining({ owner: '@test/owner', kind: 'component', id: 'broken', message: 'render broke' })])
    act(() => root.unmount())
  })

  it('returns the same wrapper for the same component', () => {
    const Component = () => null
    expect(IsolationModel.isolate(Component, { owner: '@test/owner', id: 'a' })).toBe(IsolationModel.isolate(Component, { owner: '@test/owner', id: 'a' }))
  })
})
