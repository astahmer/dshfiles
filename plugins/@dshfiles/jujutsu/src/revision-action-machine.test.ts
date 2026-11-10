import { createActor, waitFor, type InputFrom } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { previewSchema, type Mutation, type Revision } from './api.js'
import { revisionActionMachine } from './revision-action-machine.js'
import { SchemaHelpers } from './schema-helpers.js'

const rebase: Mutation = { kind: 'rebase', sourceId: 'a'.repeat(40), destinationId: 'b'.repeat(40) }
const rebasePresentation = { kind: 'rebase', sourceId: rebase.sourceId, destinationId: rebase.destinationId } as const
const bookmarkMove: Mutation = { kind: 'bookmark-move', bookmark: 'feature', destinationId: 'b'.repeat(40) }
const bookmarkPresentation = {
  kind: 'bookmark-move',
  bookmark: 'feature',
  sourceId: 'a'.repeat(40),
  destinationId: 'b'.repeat(40),
} as const
const preview = SchemaHelpers.decode(previewSchema, {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'rebase',
  title: 'Rebase',
  summary: 'Rebase a onto b',
  detail: 'jj rebase',
  expiresAt: 0,
})

type Client = InputFrom<typeof revisionActionMachine>['client']

const revision = (commitId: string): Revision => ({
  commitId,
  parents: [],
  changeId: commitId,
  shortestChangeId: commitId,
  description: commitId,
  author: 'Person',
  authorTime: '2026-10-15T12:00:00Z',
  bookmarks: [],
  localBookmarks: [],
  remoteBookmarksText: '',
  tags: [],
  workspaces: [],
  workingCopy: false,
  mine: true,
  immutable: false,
  divergent: false,
  empty: false,
  conflict: false,
  evolved: false,
  changeOffset: 0,
})

const startActions = (client: Partial<Client> = {}) => {
  const signals: AbortSignal[] = []
  const settled: string[] = []
  const actor = createActor(revisionActionMachine, {
    input: {
      client: {
        prepare:
          client.prepare ??
          (async (_input, options) => {
            signals.push(options.signal)
            return preview
          }),
        confirm: client.confirm ?? (async () => ({ message: 'done', output: 'Rebased 1 commit', workspacePath: null })),
      },
    },
  })
  actor.on('settled', event => settled.push(event.repoId))
  actor.start()
  return { actor, signals, settled }
}

describe('revisionActionMachine', () => {
  it('tracks the drag and returns to idle on drag end (Escape or a drop outside)', () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'revision', sourceId: 'a' } })
    actor.send({ type: 'drag.enter', targetId: 'b' })
    expect(actor.getSnapshot().context).toMatchObject({ dragOrigin: { kind: 'revision', sourceId: 'a' }, dropTarget: 'b' })
    actor.send({ type: 'drag.end' })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(actor.getSnapshot().context).toMatchObject({ dragOrigin: null, dropTarget: null })
  })

  it('ignores a drop that maps to no action', () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'revision', sourceId: 'a' } })
    actor.send({ type: 'drop', repoId: 'repo', action: null, targetId: 'b', presentation: null, error: null })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  it('retains a visible rejection when a branch drop is invalid', () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'revision', sourceId: 'a' } })
    actor.send({
      type: 'drop',
      repoId: 'repo',
      action: null,
      targetId: 'descendant',
      presentation: null,
      error: 'A branch cannot be rebased onto one of its own revisions.',
    })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(actor.getSnapshot().context.error).toBe('A branch cannot be rebased onto one of its own revisions.')
  })

  it('clears only the matching drop target when the pointer leaves a row', () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'revision', sourceId: 'a' } })
    actor.send({ type: 'drag.enter', targetId: 'b' })
    actor.send({ type: 'drag.enter', targetId: 'c' })
    actor.send({ type: 'drag.leave', targetId: 'b' })
    expect(actor.getSnapshot().context.dropTarget).toBe('c')
    actor.send({ type: 'drag.leave', targetId: 'c' })
    expect(actor.getSnapshot().context.dropTarget).toBeNull()
  })

  it('prepares a dropped bookmark with its origin for contextual preview', async () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'bookmark', sourceId: 'a', bookmark: 'feature' } })
    actor.send({
      type: 'drop',
      repoId: 'repo',
      action: bookmarkMove,
      targetId: bookmarkMove.destinationId,
      presentation: bookmarkPresentation,
      error: null,
    })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    expect(actor.getSnapshot().context).toMatchObject({
      action: bookmarkMove,
      dropPresentation: bookmarkPresentation,
      dropTarget: bookmarkMove.destinationId,
      dragOrigin: null,
    })
  })

  it('walks drop → preview → confirm and refreshes the repository', async () => {
    const { actor, settled } = startActions()
    actor.send({ type: 'drag.start', origin: { kind: 'revision', sourceId: 'a' } })
    actor.send({ type: 'drop', repoId: 'repo', action: rebase, targetId: rebase.destinationId, presentation: rebasePresentation, error: null })
    expect(actor.getSnapshot().context.dragOrigin).toBeNull()
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    expect(actor.getSnapshot().context.dropPresentation).toEqual(rebasePresentation)
    actor.send({ type: 'confirm' })
    const done = await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(done.context.preview).toBeNull()
    expect(done.context.result?.output).toBe('Rebased 1 commit')
    expect(settled).toEqual(['repo'])
  })

  it('cancels the preview without running it', async () => {
    const { actor, settled } = startActions()
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(settled).toEqual([])
  })

  it('dismisses an action failure without changing the idle state', async () => {
    const { actor } = startActions({
      prepare: async () => {
        throw new Error('Revision is no longer visible. Refresh and try again.')
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.context.error !== null)
    actor.send({ type: 'dismissError' })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(actor.getSnapshot().context.error).toBeNull()
  })

  it('clears a stale revision failure when the repository refreshes', async () => {
    const { actor } = startActions({
      prepare: async () => {
        throw new Error('Revision is no longer visible. Refresh and try again.')
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.context.error !== null)
    actor.send({ type: 'repository.refresh' })
    expect(actor.getSnapshot().context.error).toBeNull()
  })

  it('keeps unrelated action failures visible after refreshing', async () => {
    const { actor } = startActions({
      prepare: async () => {
        throw new Error('Working copy changed')
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.context.error !== null)
    actor.send({ type: 'repository.refresh' })
    expect(actor.getSnapshot().context.error).toBe('Working copy changed')
  })

  it('reports a failed confirm and still refreshes', async () => {
    const { actor, settled } = startActions({
      confirm: async () => {
        throw new Error('Working copy changed')
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'confirm' })
    const failed = await waitFor(actor, snapshot => snapshot.context.error !== null)
    expect(failed.value).toBe('idle')
    expect(failed.context.error).toBe('Working copy changed')
    expect(settled).toEqual(['repo'])
  })

  it('names the action when an old Host sends only its generic failure', async () => {
    const { actor } = startActions({
      prepare: async () => {
        throw Object.assign(new Error('API handler failed. See Host diagnostics.'), { name: 'ApiError', kind: 'remote', remoteCode: 'internal' })
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    const failed = await waitFor(actor, snapshot => snapshot.context.error !== null)
    expect(failed.context.error).toBe('Could not prepare this action.')
  })

  it('aborts an in-flight prepare on reset', async () => {
    const signals: AbortSignal[] = []
    const { actor } = startActions({
      prepare: (_input, options) => {
        signals.push(options.signal)
        return new Promise(() => {})
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await Promise.resolve()
    actor.send({ type: 'reset' })
    expect(signals[0]?.aborted).toBe(true)
    expect(actor.getSnapshot().value).toBe('idle')
  })

  it('owns the provisioned path and the removal and move surfaces that used to sit beside it', async () => {
    const { actor } = startActions({
      confirm: async () => ({ message: 'done', output: 'Created workspace', workspacePath: '/work/dshfiles-threads/topic' }),
    })

    actor.send({ type: 'workspace.removal.open', commitId: 'c1', name: 'topic' })
    expect(actor.getSnapshot().context.workspaceRemoval).toEqual({ commitId: 'c1', name: 'topic' })
    actor.send({ type: 'workspace.removal.close' })
    expect(actor.getSnapshot().context.workspaceRemoval).toBeNull()

    actor.send({ type: 'move.start', revision: revision('c2') })
    expect(actor.getSnapshot().context.moveSource?.commitId).toBe('c2')
    actor.send({ type: 'move.end' })
    expect(actor.getSnapshot().context.moveSource).toBeNull()

    actor.send({ type: 'prepare', repoId: 'repo', action: rebase, presentation: null })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'confirm' })
    const done = await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(done.context.provisionedPath).toBe('/work/dshfiles-threads/topic')

    actor.send({ type: 'workspace.provisioned.clear' })
    expect(actor.getSnapshot().context.provisionedPath).toBeNull()

    actor.send({ type: 'workspace.removal.open', commitId: 'c1', name: 'topic' })
    actor.send({ type: 'reset' })
    expect(actor.getSnapshot().context).toMatchObject({ provisionedPath: null, workspaceRemoval: null, moveSource: null })
  })
})
