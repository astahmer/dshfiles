import { describe, expect, it } from 'vitest'
import { RepositoryWorkspace, type WorkspacePackage } from '../src/repository/workspace.js'

const workspacePackage = (name: string, manifest: Omit<WorkspacePackage['manifest'], 'name'> = {}): WorkspacePackage => ({
  name,
  directory: `/repo/${name}`,
  manifest: { name, ...manifest },
})

describe('RepositoryWorkspace.cycles', () => {
  it('reports a cycle closed through a peer dependency', () => {
    const cycles = RepositoryWorkspace.cycles([
      workspacePackage('@dshfiles/usage', { dependencies: { '@dshfiles/ai-accounts': 'workspace:*' } }),
      workspacePackage('@dshfiles/ai-accounts', { peerDependencies: { '@dshfiles/usage': 'workspace:*' } }),
    ])
    expect(cycles).toEqual([['@dshfiles/ai-accounts', '@dshfiles/usage']])
  })

  it('ignores a one-way chain and external dependencies', () => {
    const cycles = RepositoryWorkspace.cycles([
      workspacePackage('@dshfiles/usage', { dependencies: { '@dshfiles/ai-accounts': 'workspace:*', zod: 'catalog:' } }),
      workspacePackage('@dshfiles/ai-accounts', { devDependencies: { '@dshfiles/dshx': 'workspace:*' } }),
      workspacePackage('@dshfiles/dshx'),
    ])
    expect(cycles).toEqual([])
  })
})
