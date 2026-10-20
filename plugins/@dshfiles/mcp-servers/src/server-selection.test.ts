import { describe, expect, it } from 'vitest'

import type { ServerView } from './api.js'
import { ServerSelectionModel } from './server-selection.js'

const server = (input: { readonly id: string; readonly enabled: boolean }): ServerView => ({
  id: input.id,
  name: input.id,
  serverName: input.id,
  enabled: input.enabled,
  transport: 'stdio',
  commandLine: `echo ${input.id}`,
  cwd: '/tmp',
  credentialReferences: [],
  configuration: 'ready',
  clientLifecycle: 'inactive',
  localProcess: 'not-configured',
  connectionHealth: 'not-reported',
  registeredToolCount: 0,
  oauth: 'not-used',
})

const servers = [server({ id: 'one', enabled: true }), server({ id: 'two', enabled: false }), server({ id: 'three', enabled: true })]

describe('server selection', () => {
  it('keeps the panel order and drops ids the snapshot no longer lists', () => {
    expect(ServerSelectionModel.selected({ servers, ids: ['three', 'gone', 'one'] }).map(item => item.id)).toEqual(['one', 'three'])
  })

  it('targets only the selected servers an enable or disable would change', () => {
    expect(ServerSelectionModel.targets({ servers, ids: ['one', 'two'], enabled: true }).map(item => item.id)).toEqual(['two'])
    expect(ServerSelectionModel.targets({ servers, ids: ['one', 'two', 'three'], enabled: false }).map(item => item.id)).toEqual(['one', 'three'])
  })
})
