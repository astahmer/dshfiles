// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  versions: vi.fn(async () => ({ '@dshfiles/btw': '0.1.0', '@deepseek-ai/dsh-tool-fs': '0.2.0-rc.2' })),
  mcpList: vi.fn(async () => ({
    servers: [
      {
        id: 'gh',
        name: 'GitHub',
        serverName: 'github',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://api.githubcopilot.com/mcp/',
        credentialReferences: [],
        configuration: 'ready',
        clientLifecycle: 'loaded',
        localProcess: 'not-configured',
        connectionHealth: 'not-reported',
        registeredToolCount: 1,
        oauth: 'signed-in',
      },
    ],
  })),
  startBlock: vi.fn(async () => ({ project: '/repo', text: 'Memory: past threads have digests and notes.\nNotes:\n- n:1 [feedback] Use jj.' })),
  notes: vi.fn(async () => [{ type: 'feedback' }, { type: 'feedback' }, { type: 'project' }]),
}))

vi.mock('@dshfiles/dshx/client', () => ({
  defineLocale: (namespace: string) => ({ namespace }),
  useApi: (contract: { readonly id: string }) => {
    if (contract.id === 'registry') return { list: mocks.list }
    if (contract.id === 'agent-toolkit') return { versions: mocks.versions }
    if (contract.id === 'mcp-servers') return { list: mocks.mcpList }
    return { startBlock: mocks.startBlock, notes: mocks.notes }
  },
}))

import { AgentToolkitPanel } from './toolkit-panel.js'

const english = new Map(
  Object.entries({
    tools: 'Tools ({count})',
    plugins: 'Plugins ({count})',
    mcp: 'MCP servers ({count})',
    skills: 'Skills ({count})',
    apis: 'Plugin API methods ({count})',
    mcpToolCount: '{count} tools',
    openSettings: 'Open the settings of {plugin}',
    memoryBlock: 'Start block for {project}',
    filterMcp: 'MCP',
  }),
)
const t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  (english.get(key) ?? key).replace(/\{([^}]+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))

const listing = {
  apis: [
    {
      owner: '@dshfiles/memory',
      id: 'dshfiles-memory',
      version: 1,
      methods: [{ name: 'note', description: 'Write a note.', tool: 'memory_note' }, { name: 'usage' }],
    },
  ],
  tools: [
    { name: 'read', description: 'Read a file.', source: 'tool', readOnly: true, enabled: true },
    { name: 'memory_note', description: 'Write a note.', source: 'api', owner: '@dshfiles/memory', readOnly: false, enabled: true },
    { name: 'ask_parent_question', description: 'Ask the parent.', source: 'plugin', owner: '@dshfiles/agent-questions', readOnly: false, enabled: false },
    { name: 'mcp__github__search', description: 'Search GitHub.', source: 'mcp', readOnly: false, enabled: true },
  ],
  toolScope: { sessionId: 'thread-1' },
  skills: [
    {
      name: 'verify-dsh',
      description: 'Launch a scratch DSH.',
      provider: 'filesystem',
      source: 'project-agents',
      modelInvocable: true,
      userInvocable: true,
      path: '/repo/.agents/skills/verify-dsh/SKILL.md',
    },
    {
      name: 'caveman',
      description: 'Talk terse.',
      provider: 'filesystem',
      source: 'user-agents',
      modelInvocable: false,
      userInvocable: true,
      path: '/home/me/.agents/skills/caveman/SKILL.md',
    },
  ],
}

const renderPanel = (overrides: { readonly openSettings?: (entryId: string) => void } = {}) =>
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentToolkitPanel
        threads={[{ id: 'thread-1', title: 'Ship it', cwd: '/repo' }]}
        threadId="thread-1"
        selectThread={() => undefined}
        listPlugins={async () => [
          { entryId: 'tool-fs', moduleName: '@deepseek-ai/dsh-tool-fs', enabled: true, fiberPhase: 'active' },
          { entryId: 'dshfiles-btw', moduleName: '@dshfiles/btw', title: 'btw', enabled: true, fiberPhase: 'active' },
        ]}
        openSettings={overrides.openSettings ?? (() => undefined)}
        openMemoryPanel={() => undefined}
        t={t}
      />
    </PluginQueryProvider>,
  )

afterEach(() => {
  cleanup()
  mocks.list.mockReset()
})

describe('Agent toolkit page', () => {
  it('shows the thread’s tools, plugin APIs, plugins, MCP servers, skills and memory', async () => {
    mocks.list.mockResolvedValue(listing)
    const openSettings = vi.fn()
    renderPanel({ openSettings })
    expect(await screen.findByText('Tools (4)')).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledWith({ sessionId: 'thread-1', cwd: '/repo' }, expect.anything())
    const tools = screen.getByRole('region', { name: 'Tools (4)' })
    expect(within(tools).getAllByText('readOnly')).toHaveLength(1)
    expect(within(tools).getByText('restricted')).toBeTruthy()
    expect(within(tools).getByText('sourceMemory')).toBeTruthy()

    const apis = screen.getByRole('region', { name: 'Plugin API methods (2)' })
    expect(within(apis).getByText('dshfiles-memory.note')).toBeTruthy()
    expect(within(apis).getAllByText('agentTool')).toHaveLength(1)

    expect(await screen.findByText('0.1.0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open the settings of @dshfiles/btw' }))
    expect(openSettings).toHaveBeenCalledWith('dshfiles-btw')

    expect(await screen.findByText('1 tools')).toBeTruthy()
    expect(screen.getByText('search')).toBeTruthy()
    const skills = screen.getByRole('region', { name: 'Skills (2)' })
    expect(within(skills).getByText('skillProjectAgents')).toBeTruthy()
    expect(within(skills).getByText('skillUserAgents')).toBeTruthy()
    expect(within(skills).getAllByText('filesystem')).toHaveLength(2)
    expect(screen.queryByTitle('/repo/.agents/skills/verify-dsh/SKILL.md')).toBeNull()
    expect(screen.queryByTitle('/home/me/.agents/skills/caveman/SKILL.md')).toBeNull()
    expect(await screen.findByText('feedback · 2')).toBeTruthy()
    expect(screen.getByText('Start block for /repo')).toBeTruthy()
  })

  it('narrows to one source and its section', async () => {
    mocks.list.mockResolvedValue(listing)
    renderPanel()
    await screen.findByText('Tools (4)')
    fireEvent.click(screen.getByRole('radio', { name: 'MCP' }))
    expect(screen.getByText('Tools (1)')).toBeTruthy()
    expect(screen.queryByText(/^Plugins/)).toBeNull()
    expect(screen.getByText('MCP servers (1)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('searchLabel'), { target: { value: 'nothing-like-this' } })
    expect(screen.getByText('Tools (0)')).toBeTruthy()
  })

  it('says the catalog is unavailable when no dshx Host serves it', async () => {
    mocks.list.mockRejectedValue(new Error('not loaded'))
    renderPanel()
    expect(await screen.findByText('unavailable')).toBeTruthy()
  })
})
