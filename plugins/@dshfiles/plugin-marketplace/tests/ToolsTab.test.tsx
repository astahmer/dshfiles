// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import type { RegistryListing } from '@dshfiles/dshx/api'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/tools-locales.js'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@dshfiles/dshx/client', () => ({
  defineLocale: (namespace: string, dictionaries: { readonly en: typeof en }) => ({ namespace, dictionaries }),
  useApi: () => ({ list: mocks.list }),
}))

import { ToolsTab, type ToolsTabProps } from '../src/tools-tab.js'

const t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  (new Map(Object.entries(en)).get(key) ?? key).replace(/\{([^}]+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))

const listing: RegistryListing = {
  apis: [
    {
      owner: '@dshfiles/jj-integration',
      id: 'jj-threads',
      version: 1,
      methods: [
        { name: 'threadStatus', description: 'Show this thread’s jj workspace.', tool: 'jj_thread_status' },
        { name: 'discard', description: 'Discard a thread.' },
      ],
    },
  ],
  tools: [
    { name: 'jj_thread_status', description: 'Show this thread’s jj workspace.', source: 'api', owner: '@dshfiles/jj-integration' },
    { name: 'mcp__github__search', description: 'Search GitHub.', source: 'mcp' },
    { name: 'memory_search', description: 'Search memory.', source: 'tool' },
  ],
  skills: [{ name: 'verify-dsh', description: 'Launch a scratch DSH.', provider: 'filesystem', modelInvocable: true }],
  toolScope: { sessionId: 'session-1' },
}

const renderTab = () =>
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {/* SAFETY: the tab reads only `t` from its slot props. */}
      <ToolsTab {...({ t } as ToolsTabProps)} />
    </PluginQueryProvider>,
  )

afterEach(() => {
  cleanup()
  mocks.list.mockReset()
})

describe('Tools tab', () => {
  it('lists agent tools by source, plugin API methods with their agent exposure, and skills', async () => {
    mocks.list.mockResolvedValue(listing)
    renderTab()
    expect(await screen.findByText('Agent tools (3)')).toBeTruthy()
    expect(screen.getByText('Plugin API methods (2)')).toBeTruthy()
    expect(screen.getByText('Skills (1)')).toBeTruthy()
    expect(screen.getByText('Tools as the agent of Session session-1 sees them.')).toBeTruthy()
    expect(screen.getByText('MCP')).toBeTruthy()
    expect(screen.getByText('jj-threads.threadStatus')).toBeTruthy()
    expect(screen.getAllByText('agent tool')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Search tools'), { target: { value: 'github' } })
    expect(screen.getByText('Agent tools (1)')).toBeTruthy()
    expect(screen.getByText('Plugin API methods (0)')).toBeTruthy()
  })

  it('says the catalog is unavailable when no dshx Host serves it', async () => {
    mocks.list.mockRejectedValue(new Error('not loaded'))
    renderTab()
    expect(await screen.findByText(en.unavailable)).toBeTruthy()
  })
})
