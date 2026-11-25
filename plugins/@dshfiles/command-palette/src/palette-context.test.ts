import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it } from 'vitest'
import { PaletteContext } from './palette-context.js'

// SAFETY: the context reads only these summary fields; the rest of a Host summary does not matter here.
const session = (fields: { readonly id: string; readonly [field: string]: unknown }): SessionSummary =>
  ({ displayTitle: fields.id, cwd: '/repo', blank: false, retainedBy: {}, ...fields }) as unknown as SessionSummary

const workspace = (id: string, sessionIds: readonly string[]) => ({
  // SAFETY: a workspace id is a branded string.
  workspaceId: id as WorkspaceId,
  title: `Project ${id}`,
  sessionIds: sessionIds as SessionSummary['id'][],
})

describe('palette action context', () => {
  it('names the thread on screen, its parent’s project, and its pinned and archived state', () => {
    const context = PaletteContext.of({
      sessions: [session({ id: 'parent' }), session({ id: 'child', parentId: 'parent', retainedBy: { mainView: 1 }, displayTitle: 'Fix auth' })],
      workspaceItems: [workspace('w1', ['parent'])],
      archivedSessionIds: [],
      pinnedSessionIds: ['child'],
      themePreference: 'dark',
    })
    expect(context).toEqual({
      thread: { id: 'child', title: 'Fix auth', cwd: '/repo', workspaceId: 'w1', pinned: true, archived: false },
      workspace: { id: 'w1', title: 'Project w1' },
      workspaces: [{ id: 'w1', title: 'Project w1' }],
      themePreference: 'dark',
    })
  })

  it('has no thread on the New-thread screen', () => {
    const context = PaletteContext.of({
      sessions: [session({ id: 'draft', blank: true, retainedBy: { mainView: 1 } })],
      workspaceItems: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      themePreference: 'system',
    })
    expect(context.thread).toBeNull()
  })
})
