import { describe, expect, it } from 'vitest'
import { DevServerPoll } from './dev-server-poll.js'

describe('dev-server and preview poll policy', () => {
  it('polls the dev-server list, because a started port is not pushed', () => {
    expect(DevServerPoll.serversIntervalMs({ ownerMissing: false })).toBe(DevServerPoll.intervalMs)
  })

  it('stops polling when the Host has no preview API', () => {
    expect(DevServerPoll.serversIntervalMs({ ownerMissing: true })).toBe(false)
  })

  it('never polls the page list: pagesChanged owns it', () => {
    expect(DevServerPoll.pagesIntervalMs()).toBe(false)
  })

  it('keeps one key per thread and per read, so two mounted headers never share a cache entry', () => {
    expect(DevServerPoll.serversKey('session-a')).toEqual(['dshfiles-preview', 'servers', 'session-a'])
    expect(DevServerPoll.pagesKey('session-a')).toEqual(['dshfiles-preview', 'pages', 'session-a'])
    expect(DevServerPoll.serversKey('session-a')).not.toEqual(DevServerPoll.pagesKey('session-a'))
    expect(DevServerPoll.serversKey('session-a')).not.toEqual(DevServerPoll.serversKey('session-b'))
  })
})
