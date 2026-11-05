// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registryList: vi.fn(async () => ({
    apis: [],
    tools: [],
    skills: [
      { name: 'plugin-ui', description: '', provider: '', source: 'project-agents', modelInvocable: true },
      { name: 'antislop', description: '', provider: '', source: 'user-agents', modelInvocable: true },
    ],
  })),
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
  writeClipboard: vi.fn(async () => true),
}))

vi.mock('@dshfiles/dshx/client', () => ({
  useApi: (contract: { readonly id: string }) => (contract.id === 'registry' ? { list: mocks.registryList } : { list: mocks.mcpList }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: mocks.writeClipboard }))

const { CapabilitiesHubPanel } = await import('./hub-panel.js')

afterEach(cleanup)

const renderPanel = (hasPanel: (panelId: string) => boolean = () => true) => {
  const openPanel = vi.fn()
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CapabilitiesHubPanel countPlugins={async () => ({ total: 40, enabled: 38 })} hasPanel={hasPanel} openPanel={openPanel} />
    </PluginQueryProvider>,
  )
  return { openPanel }
}

describe('CapabilitiesHubPanel', () => {
  it('shows each kind with its count and trust label, and opens its own manager', async () => {
    const { openPanel } = renderPanel()
    const page = screen.getByRole('main', { name: 'Capabilities hub' })
    const skills = within(page).getByRole('region', { name: 'Skills' })
    expect(await within(skills).findByText('2 installed: 1 project, 1 your home')).toBeTruthy()
    expect(within(skills).getByText('Agent instructions')).toBeTruthy()
    const mcp = within(page).getByRole('region', { name: 'MCP servers' })
    expect(await within(mcp).findByText('1 configured, 1 enabled')).toBeTruthy()
    expect(within(mcp).getByText('Tools and credentials')).toBeTruthy()
    const plugins = within(page).getByRole('region', { name: 'DSH plugins' })
    expect(await within(plugins).findByText('40 loaded, 38 enabled')).toBeTruthy()
    expect(within(plugins).getByText('Executable code')).toBeTruthy()

    fireEvent.click(within(mcp).getByRole('button', { name: 'Open MCP servers' }))
    fireEvent.click(within(plugins).getByRole('button', { name: 'Open Plugins' }))
    fireEvent.click(within(skills).getByRole('button', { name: 'Open Agent toolkit' }))
    expect(openPanel.mock.calls).toEqual([['mcp-servers'], ['plugins'], ['dshfiles-agent-toolkit']])
  })

  it('links out to skills.sh and copies the telemetry-off command without running it', async () => {
    renderPanel()
    const link = screen.getByRole('link', { name: 'Open skills.sh' })
    expect(link.getAttribute('href')).toBe('https://skills.sh')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Copy install command' }))
    expect(mocks.writeClipboard).toHaveBeenCalledWith(expect.stringMatching(/^DISABLE_TELEMETRY=1 npx skills@\d/u))
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('keeps a missing manager visible with the fix instead of a dead button', () => {
    renderPanel(panelId => panelId !== 'dshfiles-agent-toolkit')
    const skills = screen.getByRole('region', { name: 'Skills' })
    expect(within(skills).getByRole('button', { name: 'Open Agent toolkit' }).hasAttribute('disabled')).toBe(true)
    expect(within(skills).getByText(/Add @dshfiles\/agent-toolkit to the profile and restart DSH/u)).toBeTruthy()
  })
})
