import { describe, expect, it } from 'vitest'
import { blankServerForm, parseServerForm, serverFormFromView, serverFormSchema } from './server-form.js'
import { publicServerView } from './server-state.js'

const issueFields = (values: Parameters<typeof parseServerForm>[0]): readonly (string | undefined)[] => {
  const parsed = parseServerForm(values)
  return parsed.success ? [] : parsed.issues.map(issue => issue.field)
}

describe('server editor form', () => {
  it('starts a catalog entry as an enabled HTTP draft with a derived tool namespace', () => {
    const values = blankServerForm({ name: 'Figma Dev Mode', endpoint: 'https://mcp.figma.com/mcp' })
    expect(values).toMatchObject({ transport: 'streamable-http', enabled: true, serverName: 'figma-dev-mode', url: 'https://mcp.figma.com/mcp' })
    expect(blankServerForm().serverName).toBe('mcp-server')
  })

  it('builds the API draft of the active transport only', () => {
    const values = { ...blankServerForm({ name: 'Remote', endpoint: 'https://example.com/mcp' }), commandLine: '', headerRefs: '{"Authorization":"REMOTE_TOKEN"}' }
    expect(parseServerForm(values)).toEqual({
      success: true,
      draft: {
        id: '',
        name: 'Remote',
        serverName: 'remote',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headerRefs: { Authorization: 'REMOTE_TOKEN' },
        startCommand: null,
      },
    })
    const stdio = parseServerForm({ ...values, transport: 'stdio', url: '', commandLine: 'node server.js', envRefs: '{"API_TOKEN":"LOCAL_TOKEN"}' })
    expect(stdio.success && stdio.draft).toMatchObject({ transport: 'stdio', commandLine: 'node server.js', envRefs: { API_TOKEN: 'LOCAL_TOKEN' } })
  })

  it('attributes invalid reference JSON and API schema failures to the field that caused them', () => {
    const values = { ...blankServerForm({ name: 'Remote', endpoint: 'http://example.com/mcp' }), headerRefs: '{ not json', localStart: true, startCwd: 'relative' }
    expect(issueFields(values)).toEqual(expect.arrayContaining(['headerRefs', 'url', 'startCommandLine', 'startCwd']))
    expect(issueFields({ ...blankServerForm({ name: 'Remote', endpoint: 'https://example.com/mcp' }), headerRefs: '{"Authorization": 42}' })).toEqual(['headerRefs'])
    expect(serverFormSchema.safeParse(values).error?.issues.map(issue => issue.path[0])).toContain('headerRefs')
  })

  it('edits a saved server through reference names only, never resolved values', () => {
    const secret = 'resolved-secret-value'
    const view = publicServerView(
      Object.assign(
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
      new Map([['REMOTE_TOKEN', true]]),
    )
    const values = serverFormFromView(view)
    expect(values).toMatchObject({ id: 'one', enabled: false, localStart: true, startCwd: '/srv' })
    expect(JSON.parse(values.headerRefs)).toEqual({ Authorization: 'REMOTE_TOKEN' })
    expect(JSON.parse(values.startEnvRefs)).toEqual({ ACCESS_TOKEN: 'PROXY_TOKEN' })
    expect(JSON.stringify(values)).not.toContain(secret)
  })
})
