import { describe, expect, it } from 'vitest'
import { MAX_REMOTE_BOOKMARKS, RemoteBaseModel } from './remote-base.js'

describe('remote base', () => {
  it('reads a jj remote bookmark only on a known remote', () => {
    expect(RemoteBaseModel.parseJj('main@origin', ['origin', 'upstream'])).toEqual({ name: 'main', remote: 'origin' })
    expect(RemoteBaseModel.parseJj('feature/x@upstream', ['origin', 'upstream'])).toEqual({ name: 'feature/x', remote: 'upstream' })
    expect(RemoteBaseModel.parseJj('main', ['origin'])).toBeUndefined()
    expect(RemoteBaseModel.parseJj('main@fork', ['origin'])).toBeUndefined()
    expect(RemoteBaseModel.parseJj('@origin', ['origin'])).toBeUndefined()
  })

  it("never treats jj's colocated git refs as a remote to fetch", () => {
    expect(RemoteBaseModel.parseJj('main@git', ['git', 'origin'])).toBeUndefined()
  })

  it('reads a git remote branch, the longest matching remote winning', () => {
    expect(RemoteBaseModel.parseGit('origin/main', ['origin'])).toEqual({ name: 'main', remote: 'origin' })
    expect(RemoteBaseModel.parseGit('team/fork/release/2.x', ['team', 'team/fork'])).toEqual({ name: 'release/2.x', remote: 'team/fork' })
    expect(RemoteBaseModel.parseGit('feature/x', ['origin'])).toBeUndefined()
    expect(RemoteBaseModel.parseGit('origin/HEAD', ['origin'])).toBeUndefined()
    expect(RemoteBaseModel.parseGit('origin/', ['origin'])).toBeUndefined()
  })

  it('names exactly one remote bookmark in a revset, quoting its name', () => {
    expect(RemoteBaseModel.jjRevset({ name: 'fix/a"b', remote: 'origin' })).toBe('remote_bookmarks(exact:"fix/a\\"b", remote=exact:"origin")')
  })

  it("lists the project's main branch first on every remote, then the rest, capped", () => {
    const refs = [
      { name: 'feature', remote: 'origin' },
      { name: 'main', remote: 'upstream' },
      { name: 'main', remote: 'origin' },
      { name: 'feature', remote: 'origin' },
    ]
    expect(RemoteBaseModel.ordered({ refs, preferred: 'main', format: RemoteBaseModel.formatJj })).toEqual(['main@upstream', 'main@origin', 'feature@origin'])
    expect(RemoteBaseModel.ordered({ refs, preferred: 'main', format: RemoteBaseModel.formatGit })).toEqual(['upstream/main', 'origin/main', 'origin/feature'])
    const many = Array.from({ length: MAX_REMOTE_BOOKMARKS + 5 }, (_, index) => ({ name: `b${String(index)}`, remote: 'origin' }))
    expect(RemoteBaseModel.ordered({ refs: many, preferred: 'main', format: RemoteBaseModel.formatJj })).toHaveLength(MAX_REMOTE_BOOKMARKS)
  })
})
