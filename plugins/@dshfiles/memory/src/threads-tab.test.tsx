// @vitest-environment jsdom
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelThread } from './api.ts'
import { ThreadsTab } from './threads-tab.tsx'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const thread = (id: string): PanelThread => ({
  id,
  project: '/repo',
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

const mocks = vi.hoisted(() => ({
  preview: vi.fn(async (input: { readonly id: string }) => ({ summary: `raw of ${input.id}` })),
}))

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<object>()),
  useRegistry: () => [],
  useApi: () => ({
    threads: async () => [thread('a'), thread('b')],
    notes: async () => [],
    citations: async () => [],
    threadDetail: async () => ({ createdAt: 1, messages: 2 }),
    preview: mocks.preview,
  }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: vi.fn(), MarkdownText: (props: { readonly text?: string }) => props.text ?? null }))

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('thread raw content', () => {
  it('reads the raw excerpt of the thread now selected, not the one read first', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const render = (selectedId: string) =>
      act(() =>
        root?.render(
          <PluginQueryProvider client={client}>
            <ThreadsTab project="/repo" openThread={() => {}} focusThreadId={undefined} selectedId={selectedId} onSelect={() => {}} openNote={() => {}} />
          </PluginQueryProvider>,
        ),
      )
    render('a')
    await vi.waitFor(() => expect(container.textContent).toContain('Raw content'))
    const rawTab = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent === 'Raw content')
    act(() => void rawTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    await vi.waitFor(() => expect(container.textContent).toContain('raw of t:a'))
    render('b')
    await vi.waitFor(() => expect(container.textContent).toContain('raw of t:b'))
    expect(container.textContent).not.toContain('raw of t:a')
  })
})
