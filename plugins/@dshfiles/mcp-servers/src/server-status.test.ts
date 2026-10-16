import { describe, expect, it } from 'vitest'
import type { ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { McpServerStatusModel } from './server-status.js'

const translate: McpServersTranslate = key => key

const serverView = (
  input: {
    readonly enabled?: boolean
    readonly configuration?: ServerView['configuration']
    readonly clientLifecycle?: ServerView['clientLifecycle']
    readonly localProcess?: ServerView['localProcess']
  } = {},
): ServerView => ({
  id: 'one',
  name: 'Build tools',
  serverName: 'build-tools',
  enabled: input.enabled ?? true,
  transport: 'stdio',
  commandLine: 'node server.js',
  cwd: '/srv',
  credentialReferences: [{ target: 'environment:API_TOKEN', reference: 'BUILD_TOKEN', configured: true }],
  configuration: input.configuration ?? 'ready',
  clientLifecycle: input.clientLifecycle ?? 'loaded',
  localProcess: input.localProcess ?? 'running',
  connectionHealth: 'not-reported',
  registeredToolCount: 3,
  oauth: 'not-used',
})

describe('MCP server status model', () => {
  it('maps lifecycle and local process states to labels and a status dot', () => {
    const running = serverView()
    expect(McpServerStatusModel.lifecycleText({ server: running, t: translate })).toBe('clientLoaded')
    expect(McpServerStatusModel.lifecycleDotClassName(running)).toBe('dshx:bg-success')
    expect(McpServerStatusModel.localProcessText({ server: running, t: translate })).toBe('localProcess: localRunning')

    const inactive = serverView({ clientLifecycle: 'inactive', localProcess: 'not-configured' })
    expect(McpServerStatusModel.lifecycleText({ server: inactive, t: translate })).toBe('clientStopped')
    expect(McpServerStatusModel.lifecycleDotClassName(inactive)).toBe('dshx:bg-muted-foreground/50')
    expect(McpServerStatusModel.localProcessText({ server: inactive, t: translate })).toBeUndefined()
  })

  it('distinguishes active clients and blocks unsafe connection toggles', () => {
    expect(McpServerStatusModel.isClientActive(serverView({ clientLifecycle: 'loaded' }))).toBe(true)
    expect(McpServerStatusModel.isClientActive(serverView({ clientLifecycle: 'starting' }))).toBe(true)
    expect(McpServerStatusModel.isClientActive(serverView({ clientLifecycle: 'inactive' }))).toBe(false)
    expect(McpServerStatusModel.isConnectionToggleBlocked(serverView({ enabled: false, clientLifecycle: 'loaded' }))).toBe(false)
    expect(McpServerStatusModel.isConnectionToggleBlocked(serverView({ enabled: false, clientLifecycle: 'starting' }))).toBe(true)
    expect(McpServerStatusModel.isConnectionToggleBlocked(serverView({ clientLifecycle: 'inactive', configuration: 'needs-credentials' }))).toBe(true)
    expect(McpServerStatusModel.isConnectionToggleBlocked(serverView({ clientLifecycle: 'inactive' }))).toBe(false)
  })

  it('summarizes references and searches names case-insensitively', () => {
    const server = serverView()
    expect(McpServerStatusModel.credentialReferenceSummary(server)).toBe('environment:API_TOKEN → BUILD_TOKEN (set)')
    expect(McpServerStatusModel.matchesServerSearch({ server, search: ' BUILD ' })).toBe(true)
    expect(McpServerStatusModel.matchesServerSearch({ server, search: 'other' })).toBe(false)
    expect(McpServerStatusModel.matchesServerSearch({ server, search: '  ' })).toBe(true)
  })
})
