import type { ISessions, SessionSummary, SessionWorkspaceRestorePreview, SessionWorkspaceRestoreReceipt } from '@deepseek-ai/dsh-api-session-controller/client'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { workspaceRestoreMachine } from './workspace-restore-machine.js'

type RestoreClient = Pick<ISessions, 'prepareWorkspaceRestore' | 'confirmWorkspaceRestore' | 'workspaceRestoreStatus'>

const sessionId = 'session-1' as SessionSummary['id']
const workspacePath = '/repo'

const preview = (overrides: Partial<SessionWorkspaceRestorePreview> = {}): SessionWorkspaceRestorePreview =>
  ({
    previewId: 'preview-1',
    action: 'restore',
    workspacePath,
    currentCommitId: 'a'.repeat(40),
    targetCommitId: 'b'.repeat(40),
    changedPaths: [],
    changedPathsTruncated: false,
    ...overrides,
  }) as SessionWorkspaceRestorePreview

const receipt = { operationId: 'op-1', state: 'applied', canRetry: false, canRollback: true } as unknown as SessionWorkspaceRestoreReceipt

const startRestore = (client: Partial<RestoreClient>) => {
  const signals: AbortSignal[] = []
  const restored: string[] = []
  const fullClient = {
    prepareWorkspaceRestore: async (_params, signal) => {
      if (signal !== undefined) signals.push(signal)
      return client.prepareWorkspaceRestore === undefined ? { ok: true, value: preview() } : client.prepareWorkspaceRestore(_params, signal)
    },
    confirmWorkspaceRestore: client.confirmWorkspaceRestore ?? (async () => ({ ok: true, value: receipt })),
    workspaceRestoreStatus: client.workspaceRestoreStatus ?? (async () => ({ ok: true, value: null })),
  } satisfies RestoreClient
  const actor = createActor(workspaceRestoreMachine, { input: { client: fullClient, workspacePath, targetCommitId: 'b'.repeat(40) } })
  actor.on('restored', event => restored.push(event.type))
  actor.start()
  return { actor, signals, restored }
}

describe('workspaceRestoreMachine', () => {
  it('ignores prepare until a Session is chosen', () => {
    const { actor } = startRestore({})
    actor.send({ type: 'prepare', action: 'restore' })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  it('walks select → prepare → confirm → receipt and announces the restore', async () => {
    const { actor, restored } = startRestore({})
    actor.send({ type: 'session.select', sessionId })
    actor.send({ type: 'prepare', action: 'restore' })
    expect(actor.getSnapshot().hasTag('busy')).toBe(true)
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    expect(actor.getSnapshot().context.preview?.previewId).toBe('preview-1')

    actor.send({ type: 'confirm' })
    const done = await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(done.context.preview).toBeNull()
    expect(done.context.receipt?.operationId).toBe('op-1')
    expect(restored).toEqual(['restored'])
  })

  it('rejects a preview for another workspace', async () => {
    const { actor } = startRestore({ prepareWorkspaceRestore: async () => ({ ok: true, value: preview({ workspacePath: '/elsewhere' }) }) })
    actor.send({ type: 'session.select', sessionId })
    actor.send({ type: 'prepare', action: 'restore' })
    const done = await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.error !== null)
    expect(done.context.error).toBe('The selected Session belongs to /elsewhere; this repository is /repo.')
    expect(done.context.preview).toBeNull()
  })

  it('keeps the preview open when confirm fails', async () => {
    const { actor, restored } = startRestore({
      confirmWorkspaceRestore: async () => ({ ok: false, error: { message: 'Workspace moved' } }) as Awaited<ReturnType<RestoreClient['confirmWorkspaceRestore']>>,
    })
    actor.send({ type: 'session.select', sessionId })
    actor.send({ type: 'prepare', action: 'restore' })
    await waitFor(actor, snapshot => snapshot.matches('previewing'))
    actor.send({ type: 'confirm' })
    const failed = await waitFor(actor, snapshot => snapshot.context.error !== null)
    expect(failed.value).toBe('previewing')
    expect(failed.context.error).toBe('Workspace moved')
    expect(restored).toEqual([])
  })

  it('aborts the in-flight prepare when the target changes', async () => {
    const { actor, signals } = startRestore({ prepareWorkspaceRestore: () => new Promise(() => {}) })
    actor.send({ type: 'session.select', sessionId })
    actor.send({ type: 'prepare', action: 'restore' })
    await Promise.resolve()
    actor.send({ type: 'target.change', workspacePath, targetCommitId: null })
    expect(signals[0]?.aborted).toBe(true)
    expect(actor.getSnapshot().value).toBe('idle')
    actor.send({ type: 'prepare', action: 'restore' })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  it('announces only an existing receipt from status inspection', async () => {
    const { actor, restored } = startRestore({})
    actor.send({ type: 'session.select', sessionId })
    actor.send({ type: 'inspect' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(restored).toEqual([])
  })
})
