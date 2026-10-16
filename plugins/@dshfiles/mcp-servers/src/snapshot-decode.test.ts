import { describe, expect, it } from 'vitest'
import { Config } from './host.js'
import { decodeSnapshot } from './api.js'
import { McpCatalogModel } from './catalog.js'

describe('client snapshot decode', () => {
  it('fills fields an older Host does not send yet', () => {
    const oldShape = {
      servers: [
        {
          id: 'one',
          name: 'Remote',
          serverName: 'remote',
          enabled: true,
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
          credentialReferences: [],
          configuration: 'ready',
          clientLifecycle: 'loaded',
          localProcess: 'not-configured',
          connectionHealth: 'not-reported',
          registeredToolCount: 2,
        },
      ],
      providers: [{ id: 'figma', name: 'Figma', category: 'Design', description: 'Design files.', docsUrl: 'https://example.com/docs' }],
      connectionHealth: 'not-reported',
    }
    const snapshot = decodeSnapshot(oldShape)
    expect(snapshot.servers[0]?.oauth).toBe('not-used')
    expect(snapshot.registrySearch).toBe(true)
    expect(snapshot.providers.map(provider => provider.id)).toEqual(McpCatalogModel.providers.map(provider => provider.id))
    expect(snapshot.providers.every(provider => McpCatalogModel.endpointKey(provider.url).length > 0)).toBe(true)
  })

  it('yields an empty snapshot for a missing payload', () => {
    expect(decodeSnapshot(undefined)).toMatchObject({ servers: [], registrySearch: true })
  })

  it('gives a snapshot from an older Host the default preferences', () => {
    expect(decodeSnapshot({ servers: [] }).preferences).toEqual({
      connectOnStartup: true,
      toolCallTimeoutSeconds: 30,
      registrySearch: true,
      oauthClientName: 'DSH MCP servers',
    })
  })
})

describe('preferences stored in the Loader row', () => {
  it('keeps saved values and resets only a field that is out of range', () => {
    const row = Config.parse({
      servers: [],
      preferences: { connectOnStartup: false, toolCallTimeoutSeconds: 9_999, registrySearch: false, oauthClientName: 'Mine' },
    })
    expect(row.preferences).toEqual({ connectOnStartup: false, toolCallTimeoutSeconds: 30, registrySearch: false, oauthClientName: 'Mine' })
  })
})
