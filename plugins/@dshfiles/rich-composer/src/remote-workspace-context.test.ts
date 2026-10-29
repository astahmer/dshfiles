import { describe, expect, it } from 'vitest'
import { confirmedRemoteWorkspaceCwd } from './remote-workspace-context.ts'

describe('confirmedRemoteWorkspaceCwd', () => {
  it('uses a nonempty cwd only for confirmed remote Sessions', () => {
    expect(confirmedRemoteWorkspaceCwd({ ownership: 'remote', cwd: '/srv/project' })).toBe('/srv/project')
  })

  it('keeps unconfirmed, unknown, and empty-cwd Sessions without a remote Workspace', () => {
    expect(confirmedRemoteWorkspaceCwd({ ownership: 'unconfirmed', cwd: '/srv/project' })).toBeUndefined()
    expect(confirmedRemoteWorkspaceCwd({ ownership: undefined, cwd: '/srv/project' })).toBeUndefined()
    expect(confirmedRemoteWorkspaceCwd({ ownership: 'remote', cwd: '' })).toBeUndefined()
  })
})
