// @vitest-environment jsdom
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelThread } from './api.ts'
import { MemoryFocusModel } from './memory-focus.ts'
import { MemoryPanel } from './memory-panel.tsx'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const thread = (id: string, project: string): PanelThread => ({
  id,
  project,
  title: `Thread ${id}`,
  decision: 'decided',
  digest: `Digest ${id}\nbody`,
  source: 'trail',
  updatedAt: 1,
  createdAt: 1,
  digestedAt: 1,
  digested: true,
  events: 1,
  lastSeq: 1,
  citations: 0,
})

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<object>()),
  useRegistry: () => [],
  useApi: () => ({
    projects: async () => [
      { project: '/one', notes: 0, threads: 1 },
      { project: '/two', notes: 0, threads: 1 },
    ],
    usage: async () => {
      throw new Error('no usage in this test')
    },
    threads: async (input: { readonly project: string }) =>
      [thread('in-one', '/one'), thread('in-two', '/two')].filter(item => input.project === '' || item.project === input.project),
    notes: async () => [],
    citations: async () => [],
    threadDetail: async () => ({ createdAt: 1, messages: 2 }),
    preview: async () => ({ summary: '' }),
  }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: vi.fn(), MarkdownText: (props: { readonly text?: string }) => props.text ?? null }))

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

const stubPointerApis = (): void => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}

describe('memory panel focus', () => {
  it('keeps the focused thread selected when the focus also clears a project filter', async () => {
    stubPointerApis()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    act(() =>
      root?.render(
        <PluginQueryProvider client={client}>
          <MemoryPanel openThread={() => {}} projectPaths={['/one', '/two']} />
        </PluginQueryProvider>,
      ),
    )
    const threadsTab = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent === 'Threads')
    act(() => void threadsTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    const projectTrigger = container.querySelector('[aria-label="Memory project"]')
    act(() => void projectTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    const optionOne = await vi.waitFor(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(item => item.textContent?.startsWith('one'))
      if (option === undefined) throw new Error('project options are not open')
      return option
    })
    act(() => void optionOne.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Memory project"]')?.textContent).toContain('one'))
    act(() => MemoryFocusModel.request({ id: 't:in-two' }))
    await vi.waitFor(() => expect(container.querySelector('aside[aria-label="Thread detail"]')?.textContent).toContain('Thread in-two'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.querySelector('aside[aria-label="Thread detail"]')?.textContent).toContain('Thread in-two')
  })
})
