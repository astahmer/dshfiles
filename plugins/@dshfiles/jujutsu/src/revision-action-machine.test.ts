import { createActor, waitFor, type InputFrom } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { previewSchema, type Mutation } from './api.js'
import { revisionActionMachine } from './revision-action-machine.js'

const rebase: Mutation = { kind: 'rebase', sourceId: 'a'.repeat(40), destinationId: 'b'.repeat(40) }
const preview = previewSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'rebase',
  title: 'Rebase',
  summary: 'Rebase a onto b',
  detail: 'jj rebase',
  expiresAt: 0,
})

type Client = InputFrom<typeof revisionActionMachine>['client']

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
    actor.send({ type: 'drag.start', sourceId: 'a' })
    actor.send({ type: 'drag.enter', targetId: 'b' })
    expect(actor.getSnapshot().context).toMatchObject({ dragSource: 'a', dropTarget: 'b' })
    actor.send({ type: 'drag.end' })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(actor.getSnapshot().context).toMatchObject({ dragSource: null, dropTarget: null })
  })

  it('ignores a drop that maps to no action', () => {
    const { actor } = startActions()
    actor.send({ type: 'drag.start', sourceId: 'a' })
    actor.send({ type: 'drop', repoId: 'repo', action: null })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  it('walks drop → preview → confirm and refreshes the repository', async () => {
    const { actor, settled } = startActions()
    actor.send({ type: 'drag.start', sourceId: 'a' })
    actor.send({ type: 'drop', repoId: 'repo', action: rebase })
    expect(actor.getSnapshot().context.dragSource).toBeNull()
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'confirm' })
    const done = await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(done.context.preview).toBeNull()
    expect(done.context.result?.output).toBe('Rebased 1 commit')
    expect(settled).toEqual(['repo'])
  })

  it('cancels the preview without running it', async () => {
    const { actor, settled } = startActions()
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().value).toBe('idle')
    expect(settled).toEqual([])
  })

  it('reports a failed confirm and still refreshes', async () => {
    const { actor, settled } = startActions({
      confirm: async () => {
        throw new Error('Working copy changed')
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'confirm' })
    const failed = await waitFor(actor, snapshot => snapshot.context.error !== null)
    expect(failed.value).toBe('idle')
    expect(failed.context.error).toBe('Working copy changed')
    expect(settled).toEqual(['repo'])
  })

  it('aborts an in-flight prepare on reset', async () => {
    const signals: AbortSignal[] = []
    const { actor } = startActions({
      prepare: (_input, options) => {
        signals.push(options.signal)
        return new Promise(() => {})
      },
    })
    actor.send({ type: 'prepare', repoId: 'repo', action: rebase })
    await Promise.resolve()
    actor.send({ type: 'reset' })
    expect(signals[0]?.aborted).toBe(true)
    expect(actor.getSnapshot().value).toBe('idle')
  })
})
