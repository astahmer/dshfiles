import { SessionId } from '@deepseek-ai/dsh-session/types'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { McpCommandLineModel } from './command-line.js'
import { httpDraftSchema, stdioDraftSchema, type StoredServer } from './api.js'
import { McpCatalogModel } from './catalog.js'
import { redactText, redactingLogger } from './redaction.js'
import { McpServerStateModel } from './server-state.js'
import { createQuickPanelContribution, SessionQuickPanels } from './quick-panel.js'

type StoredStdioServer = Extract<StoredServer, { readonly transport: 'stdio' }>

const acceptsDraft = (value: unknown): boolean => {
  const schema = typeof value === 'object' && value !== null && 'transport' in value && value.transport === 'stdio' ? stdioDraftSchema : httpDraftSchema
  return Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'
}

const server = (overrides: Partial<StoredStdioServer> = {}): StoredStdioServer => ({
  id: 'one',
  name: 'Local tools',
  serverName: 'local-tools',
  enabled: true,
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  cwd: '',
  envRefs: { API_TOKEN: 'LOCAL_TOOLS_TOKEN' },
  ...overrides,
})

describe('MCP manager state', () => {
  it('creates, edits, toggles, and removes only the addressed server', () => {
    const first = server()
    const second = server({ id: 'two', name: 'Other', serverName: 'other', envRefs: {} })
    const created = McpServerStateModel.saveServer({ current: [first], candidate: second })
    expect(created).toEqual([first, second])
    const edited = McpServerStateModel.saveServer({ current: created, candidate: { ...second, name: 'Edited' } })
    expect(edited.map(row => row.name)).toEqual(['Local tools', 'Edited'])
    const disabled = McpServerStateModel.setServerEnabled({ current: edited, id: 'one', enabled: false })
    expect(disabled[0]?.enabled).toBe(false)
    expect(McpServerStateModel.removeServer({ current: disabled, id: 'two' })).toEqual([disabled[0]])
  })

  it('rejects duplicate native tool namespaces', () => {
    expect(() => McpServerStateModel.saveServer({ current: [server()], candidate: server({ id: 'two' }) })).toThrow(/unique/)
  })

  it('does not serialize unknown runtime fields or credential values to the client view', () => {
    const secret = 'never-render-this-value'
    const runtimeObject: StoredServer = Object.assign(server(), { secretValue: secret })
    const view = McpServerStateModel.publicServerView({
      server: runtimeObject,
      availability: new Map([['LOCAL_TOOLS_TOKEN', true]]),
      clientLifecycle: 'loaded',
      registeredToolCount: 3,
    })
    expect(view.credentialReferences).toEqual([{ target: 'environment:API_TOKEN', reference: 'LOCAL_TOOLS_TOKEN', configured: true }])
    expect(JSON.stringify(view)).not.toContain(secret)
    expect(view.connectionHealth).toBe('not-reported')
    expect(view.clientLifecycle).toBe('loaded')
    expect(view.registeredToolCount).toBe(3)
  })

  it('rejects secret values where only credential references are allowed', () => {
    expect(
      acceptsDraft({
        id: '',
        name: 'Remote',
        serverName: 'remote',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headerRefs: { Authorization: 'REMOTE_TOKEN' },
        token: 'secret',
      }),
    ).toBe(false)
  })

  it('accepts only an explicit absolute-cwd local runner with credential references', () => {
    const valid = {
      id: '',
      name: 'Remote tunnel',
      serverName: 'remote-tunnel',
      enabled: true,
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headerRefs: { Authorization: 'REMOTE_TOKEN' },
      startCommand: { commandLine: 'npx -y @example/tunnel', cwd: '/opt/tunnel', envRefs: { ACCESS_TOKEN: 'TUNNEL_TOKEN' } },
    }
    expect(acceptsDraft(valid)).toBe(true)
    expect(
      acceptsDraft({
        ...valid,
        startCommand: { ...valid.startCommand, cwd: 'relative/path' },
      }),
    ).toBe(false)
    expect(acceptsDraft({ ...valid, startCommand: null, credential: 'plaintext' })).toBe(false)
  })

  it('rejects credential-bearing URL userinfo, query strings, and fragments', () => {
    for (const url of ['https://user:password@example.com/mcp', 'https://example.com/mcp?access_token=secret', 'https://example.com/mcp#token=secret']) {
      expect(
        acceptsDraft({
          id: '',
          name: 'Remote',
          serverName: 'remote',
          enabled: true,
          transport: 'streamable-http',
          url,
          headerRefs: {},
        }),
      ).toBe(false)
    }
  })

  it('accepts plain HTTP only on a loopback host, like the OAuth endpoints', () => {
    const draft = (url: string) =>
      acceptsDraft({ id: '', name: 'Local', serverName: 'local', enabled: true, transport: 'streamable-http', url, headerRefs: {} })
    expect(draft('http://127.0.0.1:4100/mcp')).toBe(true)
    expect(draft('http://localhost:4100/mcp')).toBe(true)
    expect(draft('http://example.com/mcp')).toBe(false)
    expect(draft('http://127.0.0.1.example.com/mcp')).toBe(false)
  })
})

describe('catalog search', () => {
  it('filters curated providers by name, category, and description', () => {
    expect(McpCatalogModel.filterProviders({ rows: McpCatalogModel.providers, query: 'project management' }).map(row => row.name)).toEqual(['Linear'])
    expect(McpCatalogModel.filterProviders({ rows: McpCatalogModel.providers, query: '' }).length).toBe(McpCatalogModel.providers.length)
  })
})

describe('native composer quick panel', () => {
  it('registers a native action that opens only the addressed session panel', () => {
    const panels = new SessionQuickPanels()
    const translate = (key: string) => key
    const command = createQuickPanelContribution(panels, translate)
    expect(command.name).toBe('mcp-servers')
    expect(command.ui.kind).toBe('action')
    if (command.ui.kind !== 'action') throw new Error('Expected the native action command.')

    const session = { sessionId: SessionId('active-session') }
    command.ui.run(session)

    expect(panels.forSession('active-session').getSnapshot()).toBe(true)
    expect(panels.forSession('other-session').getSnapshot()).toBe(false)
  })
})

describe('local command parsing', () => {
  it('preserves quoted spaces and round-trips arguments without shell evaluation', () => {
    const argv = McpCommandLineModel.parseCommandLine('npx -y "@example/mcp server" --label \'two words\'')
    expect(argv).toEqual(['npx', '-y', '@example/mcp server', '--label', 'two words'])
    expect(McpCommandLineModel.parseCommandLine(McpCommandLineModel.formatCommandLine(argv))).toEqual(argv)
    expect(McpCommandLineModel.parseCommandLine('node $(touch /tmp/not-run)')).toEqual(['node', '$(touch', '/tmp/not-run)'])
  })

  it('rejects incomplete quotes and escapes', () => {
    expect(() => McpCommandLineModel.parseCommandLine('node "unfinished')).toThrow(/quote/)
    expect(() => McpCommandLineModel.parseCommandLine('node trailing\\')).toThrow(/escape/)
  })

  it('rejects common inline credential arguments while allowing normal arguments', () => {
    expect(McpCommandLineModel.hasInlineCredential(McpCommandLineModel.parseCommandLine('node server.js --api-key=do-not-store'))).toBe(true)
    expect(McpCommandLineModel.hasInlineCredential(McpCommandLineModel.parseCommandLine('node server.js --token value'))).toBe(true)
    expect(McpCommandLineModel.hasInlineCredential(McpCommandLineModel.parseCommandLine('node server.js --port 3000'))).toBe(false)
  })

  it('detects tilde paths that no shell will expand', () => {
    expect(McpCommandLineModel.hasUnexpandedTilde(McpCommandLineModel.parseCommandLine('node ~/dev/dadabase/dist/mcp/stdio.js'))).toBe(true)
    expect(McpCommandLineModel.hasUnexpandedTilde(McpCommandLineModel.parseCommandLine('node ~'))).toBe(true)
    expect(McpCommandLineModel.hasUnexpandedTilde(McpCommandLineModel.parseCommandLine('node /home/user/dev/dadabase/dist/mcp/stdio.js'))).toBe(false)
    expect(McpCommandLineModel.hasUnexpandedTilde(McpCommandLineModel.parseCommandLine('node server.js --home /srv/~/data'))).toBe(false)
  })
})

const recordingWarn = () => {
  const calls: unknown[][] = []
  const warn = (...args: unknown[]): void => {
    calls.push(args)
  }
  return { calls, warn }
}

describe('native-client log redaction', () => {
  it('redacts literal and URL-encoded credential values before calling the Host logger', () => {
    const secret = 'sensitive value/with+symbols'
    const recorded = recordingWarn()
    const logger = redactingLogger({ warn: recorded.warn } as never, [secret])
    logger.warn(`remote returned ${secret} and ${encodeURIComponent(secret)}`)
    expect(recorded.calls).toEqual([['remote returned [REDACTED] and [REDACTED]']])
    expect(redactText('key=sensitive value/with+symbols', [secret])).toBe('key=[REDACTED]')
  })

  it('redacts a start failure logged as an Error, including its cause', () => {
    const secret = 'token-123'
    const recorded = recordingWarn()
    const logger = redactingLogger({ warn: recorded.warn } as never, [secret])
    logger.warn('MCP server %s: native client failed to start: %s', 'one', new Error(`401 for ${secret}`, { cause: new Error(secret) }))
    const logged = recorded.calls[0]?.[2]
    expect(logged).toBeInstanceOf(Error)
    expect(String(logged)).not.toContain(secret)
    expect(String(logged instanceof Error ? logged.cause : undefined)).not.toContain(secret)
  })
  it('redacts through a named logger and keeps the rest of the Host logger reachable', () => {
    const secret = 'token-123'
    const recorded = recordingWarn()
    const exporters = new Map()
    const service = Object.assign((name?: string) => ({ name, warn: recorded.warn }), { warn: recordingWarn().warn, exporters })
    const logger = redactingLogger(service as never, [secret])
    logger('mcp').warn(`refused ${secret}`)
    expect(recorded.calls).toEqual([['refused [REDACTED]']])
    expect(logger('mcp').name).toBe('mcp')
    expect(logger.exporters).toBe(exporters)
  })
})
