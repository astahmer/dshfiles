import { describe, expect, it } from 'vitest'
import { McpServerFormModel, type ServerFormValues } from './server-form.js'
import { McpServerStateModel } from './server-state.js'

const issueFields = (values: Parameters<typeof McpServerFormModel.parseServerForm>[0]): readonly (string | undefined)[] => {
  const parsed = McpServerFormModel.parseServerForm(values)
  return parsed.success ? [] : parsed.issues.map(issue => issue.field)
}

describe('server editor form', () => {
  it('starts a catalog entry as an enabled HTTP draft with a derived tool namespace', () => {
    const values = McpServerFormModel.blankServerForm({ name: 'Figma Dev Mode', endpoint: 'https://mcp.figma.com/mcp' })
    expect(values).toMatchObject({ transport: 'streamable-http', enabled: true, serverName: 'figma-dev-mode', url: 'https://mcp.figma.com/mcp' })
    expect(McpServerFormModel.blankServerForm().serverName).toBe('mcp-server')
  })

  it('builds the API draft of the active transport only', () => {
    const values = {
      ...McpServerFormModel.blankServerForm({ name: 'Remote', endpoint: 'https://example.com/mcp' }),
      commandLine: '',
      headerRefs: '{"Authorization":"REMOTE_TOKEN"}',
    }
    expect(McpServerFormModel.parseServerForm(values)).toEqual({
      success: true,
      draft: {
        id: '',
        name: 'Remote',
        serverName: 'remote',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headerRefs: { Authorization: 'REMOTE_TOKEN' },
        auth: 'none',
        startCommand: null,
      },
    })
    const stdio = McpServerFormModel.parseServerForm({
      ...values,
      transport: 'stdio',
      url: '',
      commandLine: 'node server.js',
      envRefs: '{"API_TOKEN":"LOCAL_TOKEN"}',
    })
    expect(stdio.success && stdio.draft).toMatchObject({ transport: 'stdio', commandLine: 'node server.js', envRefs: { API_TOKEN: 'LOCAL_TOKEN' } })
  })

  it('attributes invalid reference JSON and API schema failures to the field that caused them', () => {
    const values = {
      ...McpServerFormModel.blankServerForm({ name: 'Remote', endpoint: 'http://example.com/mcp' }),
      headerRefs: '{ not json',
      localStart: true,
      startCwd: 'relative',
    }
    expect(issueFields(values)).toEqual(expect.arrayContaining(['headerRefs', 'url', 'startCommandLine', 'startCwd']))
    expect(
      issueFields({ ...McpServerFormModel.blankServerForm({ name: 'Remote', endpoint: 'https://example.com/mcp' }), headerRefs: '{"Authorization": 42}' }),
    ).toEqual(['headerRefs'])
    expect(McpServerFormModel.serverFormSchema.safeParse(values).error?.issues.map(issue => issue.path[0])).toContain('headerRefs')
  })

  it('edits a saved server through reference names only, never resolved values', () => {
    const secret = 'resolved-secret-value'
    const view = McpServerStateModel.publicServerView({
      server: Object.assign(
        {
          id: 'one',
          name: 'Remote',
          serverName: 'remote',
          enabled: false,
          transport: 'streamable-http' as const,
          url: 'https://example.com/mcp',
          headerRefs: { Authorization: 'REMOTE_TOKEN' },
          startCommand: { command: 'npx', args: ['proxy'], cwd: '/srv', envRefs: { ACCESS_TOKEN: 'PROXY_TOKEN' } },
        },
        { resolvedValue: secret },
      ),
      availability: new Map([['REMOTE_TOKEN', true]]),
    })
    const values = McpServerFormModel.serverFormFromView(view)
    expect(values).toMatchObject({ id: 'one', enabled: false, localStart: true, startCwd: '/srv' })
    expect(JSON.parse(values.headerRefs)).toEqual({ Authorization: 'REMOTE_TOKEN' })
    expect(JSON.parse(values.startEnvRefs)).toEqual({ ACCESS_TOKEN: 'PROXY_TOKEN' })
    expect(JSON.stringify(values)).not.toContain(secret)
  })

  it('rejects a tilde command path the Host would pass through literally', () => {
    const values: ServerFormValues = {
      ...McpServerFormModel.blankServerForm({ name: 'Dadabase' }),
      transport: 'stdio',
      commandLine: 'node ~/dev/dadabase/dist/mcp/stdio.js',
    }
    expect(issueFields(values)).toContain('commandLine')
    expect(McpServerFormModel.serverFormSchema.safeParse(values).error?.issues.some(issue => issue.path[0] === 'commandLine')).toBe(true)
    expect(issueFields({ ...values, commandLine: 'node /home/user/dev/dadabase/dist/mcp/stdio.js' })).not.toContain('commandLine')
    expect(issueFields({ ...values, commandLine: 'node server.js --home ~/data' })).toContain('commandLine')
  })

  it('reports incomplete quoting as a field issue instead of throwing', () => {
    const values: ServerFormValues = { ...McpServerFormModel.blankServerForm({ name: 'Local' }), transport: 'stdio', commandLine: 'node "unfinished' }
    expect(issueFields(values)).toContain('commandLine')
  })

  it('flags a local command that would inherit the Host working directory', () => {
    expect(McpServerFormModel.inheritsHostWorkingDirectory({ ...McpServerFormModel.blankServerForm(), transport: 'stdio' })).toBe(true)
    expect(McpServerFormModel.inheritsHostWorkingDirectory({ ...McpServerFormModel.blankServerForm(), transport: 'stdio', cwd: '   ' })).toBe(true)
    expect(
      McpServerFormModel.inheritsHostWorkingDirectory({ ...McpServerFormModel.blankServerForm(), transport: 'stdio', cwd: '/home/user/dev/dadabase' }),
    ).toBe(false)
    expect(McpServerFormModel.inheritsHostWorkingDirectory(McpServerFormModel.blankServerForm())).toBe(false)
  })
})

describe('catalog drafts and OAuth', () => {
  it('derives a tool namespace that no configured server uses', () => {
    expect(McpServerFormModel.uniqueServerName({ title: 'Linear', taken: [] })).toBe('linear')
    expect(McpServerFormModel.uniqueServerName({ title: 'Linear', taken: ['linear', 'linear-2'] })).toBe('linear-3')
    expect(McpServerFormModel.uniqueServerName({ title: 'A'.repeat(40), taken: ['a'.repeat(32)] })).toBe(`${'a'.repeat(30)}-2`)
  })

  it('adds a hosted provider as an OAuth HTTP server in one step', () => {
    expect(McpServerFormModel.catalogServerDraft({ name: 'Notion', url: 'https://mcp.notion.com/mcp', oauth: true, taken: ['notion'] })).toEqual({
      id: '',
      name: 'Notion',
      serverName: 'notion-2',
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.notion.com/mcp',
      headerRefs: {},
      auth: 'oauth',
      startCommand: null,
    })
  })

  it('round-trips OAuth sign-in through the editor and reports the sign-in state', () => {
    const stored = {
      id: 'remote',
      name: 'Remote',
      serverName: 'remote',
      enabled: true,
      transport: 'streamable-http' as const,
      url: 'https://example.com/mcp',
      headerRefs: {},
      auth: 'oauth' as const,
    }
    const pending = McpServerStateModel.publicServerView({
      server: stored,
      availability: new Map(),
      clientLifecycle: 'inactive',
      localProcess: 'not-configured',
      signedIn: false,
    })
    expect(pending.oauth).toBe('needs-sign-in')
    expect(pending.configuration).toBe('needs-credentials')
    expect(
      McpServerStateModel.publicServerView({
        server: stored,
        availability: new Map(),
        clientLifecycle: 'loaded',
        registeredToolCount: 2,
        localProcess: 'not-configured',
        signedIn: true,
      }),
    ).toMatchObject({ oauth: 'signed-in', configuration: 'ready' })
    const values = McpServerFormModel.serverFormFromView(pending)
    expect(values.oauth).toBe(true)
    const parsed = McpServerFormModel.parseServerForm(values)
    expect(parsed.success && parsed.draft.transport === 'streamable-http' ? parsed.draft.auth : undefined).toBe('oauth')
  })
})
