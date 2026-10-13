import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { hasInlineCredential, hasUnexpandedTilde, parseCommandLine, formatCommandLine } from './command-line.js'
import { serverDraftSchema, type StoredServer } from './api.js'
import { PROVIDERS, filterProviders, searchOfficialRegistry } from './catalog.js'
import { ManagedLocalCommand } from './local-process.js'
import { ClientReconciler } from './reconcile.js'
import { redactText, redactingLogger } from './redaction.js'
import { publicServerView, removeServer, saveServer, setServerEnabled } from './server-state.js'
import { createQuickPanelContribution, SessionQuickPanels } from './quick-panel.js'

type StoredStdioServer = Extract<StoredServer, { readonly transport: 'stdio' }>

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
    const created = saveServer([first], second)
    expect(created).toEqual([first, second])
    const edited = saveServer(created, { ...second, name: 'Edited' })
    expect(edited.map(row => row.name)).toEqual(['Local tools', 'Edited'])
    const disabled = setServerEnabled(edited, 'one', false)
    expect(disabled[0]?.enabled).toBe(false)
    expect(removeServer(disabled, 'two')).toEqual([disabled[0]])
  })

  it('rejects duplicate native tool namespaces', () => {
    expect(() => saveServer([server()], server({ id: 'two' }))).toThrow(/unique/)
  })

  it('does not serialize unknown runtime fields or credential values to the client view', () => {
    const secret = 'never-render-this-value'
    const runtimeObject: StoredServer = Object.assign(server(), { secretValue: secret })
    const view = publicServerView(runtimeObject, new Map([['LOCAL_TOOLS_TOKEN', true]]), 'loaded', 3)
    expect(view.credentialReferences).toEqual([{ target: 'environment:API_TOKEN', reference: 'LOCAL_TOOLS_TOKEN', configured: true }])
    expect(JSON.stringify(view)).not.toContain(secret)
    expect(view.connectionHealth).toBe('not-reported')
    expect(view.clientLifecycle).toBe('loaded')
    expect(view.registeredToolCount).toBe(3)
  })

  it('rejects secret values where only credential references are allowed', () => {
    expect(
      serverDraftSchema.safeParse({
        id: '',
        name: 'Remote',
        serverName: 'remote',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headerRefs: { Authorization: 'REMOTE_TOKEN' },
        token: 'secret',
      }).success,
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
    expect(serverDraftSchema.safeParse(valid).success).toBe(true)
    expect(
      serverDraftSchema.safeParse({
        ...valid,
        startCommand: { ...valid.startCommand, cwd: 'relative/path' },
      }).success,
    ).toBe(false)
    expect(serverDraftSchema.safeParse({ ...valid, startCommand: null, credential: 'plaintext' }).success).toBe(false)
  })

  it('rejects credential-bearing URL userinfo, query strings, and fragments', () => {
    for (const url of ['https://user:password@example.com/mcp', 'https://example.com/mcp?access_token=secret', 'https://example.com/mcp#token=secret']) {
      expect(
        serverDraftSchema.safeParse({
          id: '',
          name: 'Remote',
          serverName: 'remote',
          enabled: true,
          transport: 'streamable-http',
          url,
          headerRefs: {},
        }).success,
      ).toBe(false)
    }
  })
})

describe('catalog search', () => {
  it('filters curated providers by name, category, and description', () => {
    expect(filterProviders(PROVIDERS, 'project management').map(row => row.name)).toEqual(['Linear'])
    expect(filterProviders(PROVIDERS, '').length).toBe(PROVIDERS.length)
  })

  it('queries the official Registry and maps only safe streamable HTTP endpoints', async () => {
    let requestUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response(
        JSON.stringify({
          servers: [
            {
              server: {
                name: 'io.example/weather',
                title: 'Weather',
                description: 'Forecast tools',
                version: '1.2.0',
                _meta: { 'com.example': { category: ['weather', 'development'], documentationUrl: 'https://docs.example.com/weather' } },
                remotes: [
                  { type: 'streamable-http', url: 'https://api.example.com/mcp?token=do-not-return' },
                  { type: 'streamable-http', url: 'https://api.example.com/mcp' },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const rows = await searchOfficialRegistry('weather')
      expect(rows).toEqual([
        {
          name: 'io.example/weather',
          title: 'Weather',
          category: 'weather',
          description: 'Forecast tools',
          version: '1.2.0',
          endpoint: 'https://api.example.com/mcp',
          docsUrl: 'https://docs.example.com/weather',
        },
      ])
      const request = new URL(requestUrl)
      expect(request.searchParams.get('search')).toBe('weather')
      expect(request.searchParams.get('version')).toBe('latest')
      expect(request.searchParams.get('limit')).toBe('20')
      expect(JSON.stringify(rows)).not.toContain('do-not-return')
    } finally {
      vi.unstubAllGlobals()
    }
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
    const argv = parseCommandLine('npx -y "@example/mcp server" --label \'two words\'')
    expect(argv).toEqual(['npx', '-y', '@example/mcp server', '--label', 'two words'])
    expect(parseCommandLine(formatCommandLine(argv))).toEqual(argv)
    expect(parseCommandLine('node $(touch /tmp/not-run)')).toEqual(['node', '$(touch', '/tmp/not-run)'])
  })

  it('rejects incomplete quotes and escapes', () => {
    expect(() => parseCommandLine('node "unfinished')).toThrow(/quote/)
    expect(() => parseCommandLine('node trailing\\')).toThrow(/escape/)
  })

  it('rejects common inline credential arguments while allowing normal arguments', () => {
    expect(hasInlineCredential(parseCommandLine('node server.js --api-key=do-not-store'))).toBe(true)
    expect(hasInlineCredential(parseCommandLine('node server.js --token value'))).toBe(true)
    expect(hasInlineCredential(parseCommandLine('node server.js --port 3000'))).toBe(false)
  })

  it('detects tilde paths that no shell will expand', () => {
    expect(hasUnexpandedTilde(parseCommandLine('node ~/dev/dadabase/dist/mcp/stdio.js'))).toBe(true)
    expect(hasUnexpandedTilde(parseCommandLine('node ~'))).toBe(true)
    expect(hasUnexpandedTilde(parseCommandLine('node /home/user/dev/dadabase/dist/mcp/stdio.js'))).toBe(false)
    expect(hasUnexpandedTilde(parseCommandLine('node server.js --home /srv/~/data'))).toBe(false)
  })
})

describe('native-client log redaction', () => {
  it('redacts literal and URL-encoded credential values before calling the Host logger', () => {
    const secret = 'sensitive value/with+symbols'
    const warn = vi.fn()
    const logger = redactingLogger({ warn } as never, [secret])
    logger.warn(`remote returned ${secret} and ${encodeURIComponent(secret)}`)
    expect(warn).toHaveBeenCalledWith('remote returned [REDACTED] and [REDACTED]')
    expect(redactText('key=sensitive value/with+symbols', [secret])).toBe('key=[REDACTED]')
  })

  it('redacts a start failure logged as an Error, including its cause', () => {
    const secret = 'token-123'
    const warn = vi.fn()
    const logger = redactingLogger({ warn } as never, [secret])
    logger.warn('MCP server %s: native client failed to start: %s', 'one', new Error(`401 for ${secret}`, { cause: new Error(secret) }))
    const logged = warn.mock.calls[0]?.[2]
    expect(logged).toBeInstanceOf(Error)
    expect(String(logged)).not.toContain(secret)
    expect(String(logged instanceof Error ? logged.cause : undefined)).not.toContain(secret)
  })
})

describe('managed local HTTP process', () => {
  it('resolves argv through the Host subprocess seam and waits for owned-range cleanup', async () => {
    const stdout = { on: vi.fn(), resume: vi.fn() }
    const stderr = { on: vi.fn(), resume: vi.fn() }
    const handle = {
      stdout,
      stderr,
      done: new Promise(() => undefined),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
    const subprocess = {
      resolveExecutable: vi.fn(async () => '/resolved/npx'),
      spawn: vi.fn(() => handle),
    }
    const managed = await ManagedLocalCommand.start(
      subprocess as never,
      {
        command: 'npx',
        args: ['-y', '@example/tunnel'],
        cwd: '/opt/tunnel',
      },
      { ACCESS_TOKEN: 'secret-never-render' },
    )

    expect(subprocess.spawn).toHaveBeenCalledWith({
      argv: ['/resolved/npx', '-y', '@example/tunnel'],
      cwd: '/opt/tunnel',
      env: { ACCESS_TOKEN: 'secret-never-render' },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 5_000,
    })
    expect(stdout.resume).toHaveBeenCalledOnce()
    expect(stderr.resume).toHaveBeenCalledOnce()
    managed.markRunning()
    expect(managed.status).toBe('running')
    await managed.stop()
    expect(handle.terminate).toHaveBeenCalledOnce()
    expect(handle.waitForExit).toHaveBeenCalledOnce()
    expect(managed.status).toBe('stopped')
  })

  it('reports an early process exit without retaining the outcome error text', async () => {
    let rejectDone: (reason: Error) => void = () => undefined
    const handle = {
      done: new Promise((_resolve, reject) => {
        rejectDone = reject
      }),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
    const subprocess = {
      resolveExecutable: vi.fn(async () => '/resolved/runner'),
      spawn: vi.fn(() => handle),
    }
    const managed = await ManagedLocalCommand.start(subprocess as never, { command: 'runner', args: [], cwd: '/tmp' }, {})
    rejectDone(new Error('private transport secret'))
    await Promise.resolve()
    expect(managed.status).toBe('exited')
    expect(JSON.stringify(managed)).not.toContain('private transport secret')
  })
})

describe('native client lifecycle reconciliation', () => {
  it('starts once, replaces edits, stops disabled servers, and removes deleted servers', async () => {
    const started: string[] = []
    const stopped: string[] = []
    const reconciler = new ClientReconciler(async target => {
      started.push(`${target.id}:${target.fingerprint}`)
      return () => {
        stopped.push(`${target.id}:${target.fingerprint}`)
      }
    })
    const initial = { id: 'one', enabled: true, ready: true, fingerprint: 'a' }
    await reconciler.update([initial])
    await reconciler.update([initial])
    expect(started).toEqual(['one:a'])
    await reconciler.update([{ ...initial, fingerprint: 'b' }])
    expect(stopped).toEqual(['one:a'])
    await reconciler.update([{ ...initial, enabled: false, fingerprint: 'b' }])
    expect(stopped).toEqual(['one:a', 'one:b'])
    await reconciler.update([])
    expect(started).toEqual(['one:a', 'one:b'])
    await reconciler.dispose()
  })

  it('tracks a manual disconnect separately and reconnects by restarting the native fiber', async () => {
    const started: string[] = []
    const stopped: string[] = []
    const reconciler = new ClientReconciler(async target => {
      started.push(target.id)
      return () => {
        stopped.push(target.id)
      }
    })
    const configured = { id: 'one', enabled: true, ready: true, fingerprint: 'ref-only-config' }
    await reconciler.update([configured])
    expect(reconciler.state('one')).toBe('loaded')
    await reconciler.update([{ ...configured, suspended: true }])
    expect(reconciler.state('one')).toBe('manually-disconnected')
    expect(stopped).toEqual(['one'])
    await reconciler.restart('one', [configured])
    expect(reconciler.state('one')).toBe('loaded')
    expect(started).toEqual(['one', 'one'])
    await reconciler.update([{ ...configured, enabled: false }])
    expect(reconciler.state('one')).toBe('inactive')
    await reconciler.dispose()
  })

  it('reports native child activation failures without exposing error text', async () => {
    const reconciler = new ClientReconciler(async () => {
      throw new Error('sensitive transport detail')
    })
    await reconciler.update([{ id: 'one', enabled: true, ready: true, fingerprint: 'safe' }])
    expect(reconciler.state('one')).toBe('start-failed')
    await reconciler.dispose()
  })
})
