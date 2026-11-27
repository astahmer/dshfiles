import { describe, expect, it } from 'vitest'
import { WorkspaceAttribution, WorkspacePaths, workspaceName } from './workspace-attribution.js'

describe('WorkspacePaths.projectPathOf', () => {
  const customLayout = WorkspacePaths.threadDirectoriesOf([{ repoRoot: '/dev/dshfiles', threadsDirectory: '/elsewhere/threads/dshfiles/' }])

  it('keeps the <repository>-threads layout without any reported directory', () => {
    expect(WorkspacePaths.projectPathOf({ path: '/dev/dshfiles-threads/thread-1b7a8c' })).toBe('/dev/dshfiles')
    expect(WorkspacePaths.projectPathOf({ path: '/dev/dshfiles/' })).toBe('/dev/dshfiles')
    expect(WorkspacePaths.projectPathOf({ path: '-threads/thread-1b7a8c' })).toBe('-threads/thread-1b7a8c')
  })

  it('resolves a thread workspace in a custom threads directory to the repository its provider reported', () => {
    expect(WorkspacePaths.projectPathOf({ path: '/elsewhere/threads/dshfiles/thread-1b7a8c', threadDirectories: customLayout })).toBe('/dev/dshfiles')
    expect(WorkspacePaths.isJjWorkspace({ path: '/elsewhere/threads/dshfiles/thread-1b7a8c', threadDirectories: customLayout })).toBe(true)
    expect(WorkspacePaths.projectPathOf({ path: '/dev/dshfiles-threads/thread-1b7a8c', threadDirectories: customLayout })).toBe('/dev/dshfiles')
    expect(WorkspacePaths.projectPathOf({ path: '/elsewhere/threads/nixfiles/thread-1b7a8c', threadDirectories: customLayout })).toBe(
      '/elsewhere/threads/nixfiles/thread-1b7a8c',
    )
  })

  it('treats a custom-directory workspace as a project when no provider answered', () => {
    expect(WorkspacePaths.isJjWorkspace({ path: '/elsewhere/threads/dshfiles/thread-1b7a8c' })).toBe(false)
    const rows = [{ path: '/dev/dshfiles' }, { path: '/elsewhere/threads/dshfiles/thread-1b7a8c' }, { path: '/dev/dshfiles-threads/thread-2c8b9d' }]
    expect(WorkspacePaths.projects({ rows }).map(row => row.path)).toEqual(['/dev/dshfiles', '/elsewhere/threads/dshfiles/thread-1b7a8c'])
    expect(WorkspacePaths.projects({ rows, threadDirectories: customLayout }).map(row => row.path)).toEqual(['/dev/dshfiles'])
  })
})

describe('workspaceName', () => {
  it('uses the final path segment on either platform', () => {
    expect(workspaceName('/repo-threads/thread-a')).toBe('thread-a')
    expect(workspaceName('C:\\repo-threads\\thread-a\\')).toBe('thread-a')
  })

  it('returns undefined for an empty path', () => {
    expect(workspaceName('')).toBeUndefined()
    expect(workspaceName('/')).toBeUndefined()
  })
})

describe('WorkspaceAttribution', () => {
  const project = {
    workspaceId: 'project',
    path: '/dev/dshfiles',
    sessionIds: ['in-project'],
  }
  const thread = {
    workspaceId: 'thread',
    path: '/dev/dshfiles-threads/thread-a',
    sessionIds: ['in-thread'],
  }
  const workspaces = [project, thread]

  it('attributes a registered thread workspace session, and one whose thread workspace was forgotten, to the project', () => {
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces,
        sessionId: 'in-thread',
      }),
    ).toBe('project')
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces,
        sessionId: 'in-project',
      }),
    ).toBe('project')
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces,
        sessionId: 'forgotten',
        cwd: '/dev/dshfiles-threads/thread-b',
      }),
    ).toBe('project')
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces,
        sessionId: 'elsewhere',
        cwd: '/tmp/other',
      }),
    ).toBeUndefined()
  })

  it('uses a reported custom threads directory', () => {
    const custom = [
      project,
      {
        workspaceId: 'custom',
        path: '/elsewhere/dshfiles/thread-c',
        sessionIds: ['in-custom'],
      },
    ]
    const threadDirectories = new Map([['/elsewhere/dshfiles', '/dev/dshfiles']])
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces: custom,
        sessionId: 'in-custom',
        threadDirectories,
      }),
    ).toBe('project')
    expect(
      WorkspaceAttribution.projectOfSession({
        workspaces: custom,
        sessionId: 'in-custom',
      }),
    ).toBe('custom')
  })
})
