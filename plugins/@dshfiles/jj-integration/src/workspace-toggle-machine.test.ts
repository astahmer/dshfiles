import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DestinationView } from './api.js'
import { deferWorkspaceSubmit, type WorkspaceComposer } from './workspace-submit.js'
import { WorkspaceToggle, workspaceToggleMachine, type SpareWorkspace, type WorkspaceToggleClient } from './workspace-toggle-machine.js'

const startToggle = (overrides: Partial<WorkspaceToggleClient> = {}) => {
  const calls: string[] = []
  const spares = new Map<string, SpareWorkspace>()
  let gate: () => void = () => undefined
  const provisioned = new Promise<void>(resolve => (gate = resolve))
  const client: WorkspaceToggleClient = {
    provision: async input => {
      calls.push(`provision ${input.isolate ? 'isolate' : 'shared'} ${input.name ?? '-'}`)
      await provisioned
      return { workspaceId: `ws-${input.name ?? 'project'}` }
    },
    listed: async () => undefined,
    open: async workspaceId => void calls.push(`open ${workspaceId}`),
    findSpare: key => spares.get(key),
    keepSpare: (key, spare) => void spares.set(key, spare),
    consumeSpare: (key, spare) => {
      if (spares.get(key)?.workspaceId === spare.workspaceId) spares.delete(key)
    },
    generateName: () => 'thread-abc123',
    preparationTimeoutReason: () => 'Destination lookup timed out.',
    ...overrides,
  }
  const actor = createActor(workspaceToggleMachine, { input: { client } }).start()
  const switched: string[] = []
  actor.on('switched', event => switched.push(event.workspaceId))
  return { actor, calls, spares, switched, release: () => gate() }
}

afterEach(() => vi.useRealTimers())

type TestComposerState = {
  readonly draft: string
  readonly attachmentIds: readonly string[]
  readonly phase: 'plain'
}

const composerWithDraft = (draft: string) => {
  let state: TestComposerState = { draft, attachmentIds: [], phase: 'plain' }
  const submissions: { readonly mode: 'queue'; readonly source: 'click' | 'enter' }[] = []
  const notices: string[] = []
  return {
    input: {
      state: { getSnapshot: () => state },
      submit: (mode: 'queue', source: 'click' | 'enter') => submissions.push({ mode, source }),
      notify: (_level: 'info' | 'error', text: string) => notices.push(text),
    },
    submissions,
    notices,
    edit: (nextDraft: string) => {
      state = { ...state, draft: nextDraft }
    },
  }
}

describe('workspaceToggleMachine', () => {
  it('shows the client-chosen name while the Host creates the workspace without blocking the composer', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    expect(toggle.actor.getSnapshot().context.pending).toEqual({ isolate: true, name: 'thread-abc123', spare: null })
    expect(toggle.calls).toEqual(['provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('omits a missing bookmark from the workspace API payload', async () => {
    const payloads: unknown[] = []
    const toggle = startToggle({
      provision: async input => {
        payloads.push(input)
        return { workspaceId: 'ws-thread-abc123' }
      },
    })
    const request = WorkspaceToggle.defaultDestinationMove({
      destination: { vcs: 'jj', isolated: false, projectWorkspaceId: 'project', bookmark: null, bookmarks: [], isolateByDefault: true },
      workspaceId: 'project',
    })
    if (request === null) throw new Error('Expected the new thread to move into an isolated workspace.')
    toggle.actor.send({ type: 'toggle', request })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(payloads).toStrictEqual([{ workspaceId: 'project', isolate: true, name: 'thread-abc123' }])
  })

  it('keeps the left thread workspace as a spare and reuses it instead of creating another one', async () => {
    const toggle = startToggle()
    toggle.release()
    const leaving = { workspaceId: 'ws-thread-abc123', name: 'thread-abc123' }
    toggle.actor.send({ type: 'toggle', request: { isolate: false, projectWorkspaceId: 'project', leaving, leavingBase: 'main' } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.spares.get(WorkspaceToggle.spareKey('project', 'main'))).toEqual(leaving)
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
    expect(toggle.switched).toEqual(['project', 'ws-thread-abc123'])
  })

  it('does not reuse the inherited thread workspace even when it is also the stored spare', async () => {
    const toggle = startToggle()
    toggle.release()
    const key = WorkspaceToggle.spareKey('project', 'main')
    toggle.spares.set(key, { workspaceId: 'ws-old', name: 'thread-old' })
    toggle.actor.send({
      type: 'toggle',
      request: {
        isolate: true,
        base: 'main',
        projectWorkspaceId: 'project',
        leaving: null,
        leavingBase: null,
        excludeSpareWorkspaceId: 'ws-old',
      },
    })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.spares.get(key)).toEqual({ workspaceId: 'ws-old', name: 'thread-old' })
  })

  it('retries without unsupported fields on a Host that does not know the name yet', async () => {
    const payloads: unknown[] = []
    const toggle = startToggle({
      provision: async input => {
        payloads.push(input)
        if (input.name !== undefined) throw new Error('Unrecognized key: "name"')
        return { workspaceId: 'ws-host-named' }
      },
    })
    toggle.actor.send({
      type: 'toggle',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(payloads).toStrictEqual([
      { workspaceId: 'project', isolate: true, base: 'main', name: 'thread-abc123' },
      { workspaceId: 'project', isolate: true, base: 'main' },
    ])
    expect(toggle.switched).toEqual(['ws-host-named'])
  })

  it('reports a failed provision without blocking the composer', async () => {
    const toggle = startToggle({ provision: async () => Promise.reject(new Error('jj workspace add failed')) })
    toggle.actor.send({ type: 'toggle', request: { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.actor.getSnapshot().context).toMatchObject({ pending: null, error: 'jj workspace add failed' })
  })

  it('moves a new thread to its default workspace in the background without blocking its composer', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'project', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)
    expect(toggle.actor.getSnapshot().context.pending?.name).toBe('thread-abc123')
    expect(toggle.calls).toEqual([])
    toggle.actor.send({
      type: 'resolved',
      visitId: 's1',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    expect(toggle.calls).toEqual(['provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
  })

  it('settles the fresh Session DSH opens in the workspace the switch created', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 'session:project', workspaceId: 'project', isolateByDefault: true })
    toggle.actor.send({
      type: 'resolved',
      visitId: 'session:project',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    // DSH backs the moved thread with a fresh blank Session, so the client reports the new workspace under a new visit.
    toggle.actor.send({ type: 'arrive', visitId: 'session:thread', workspaceId: 'ws-thread-abc123', isolateByDefault: true })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual(['provision isolate thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('creates a fresh workspace when a new thread inherits another thread workspace', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'ws-shared', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)
    expect(WorkspaceToggle.eagerDestinationMove({ workspaceId: 'ws-shared', projectWorkspaceId: 'project', bookmark: 'main' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
      excludeSpareWorkspaceId: 'ws-shared',
    })
    expect(toggle.calls).toEqual([])

    const request = WorkspaceToggle.defaultDestinationMove({
      destination: { vcs: 'jj', isolated: true, projectWorkspaceId: 'project', bookmark: 'main', bookmarks: ['main'], isolateByDefault: true },
      workspaceId: 'ws-shared',
    })
    toggle.actor.send({ type: 'resolved', visitId: 's1', request })
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('reuses the spare workspace for a new thread instead of provisioning one', async () => {
    const toggle = startToggle()
    toggle.spares.set(WorkspaceToggle.spareKey('project', 'main'), { workspaceId: 'ws-spare', name: 'thread-5pa4e0' })
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'project', isolateByDefault: true })
    toggle.actor.send({
      type: 'resolved',
      visitId: 's1',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    expect(toggle.actor.getSnapshot().context.pending?.name).toBe('thread-5pa4e0')
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
    expect(toggle.switched).toEqual(['ws-spare'])
    expect(toggle.spares.has(WorkspaceToggle.spareKey('project', 'main'))).toBe(false)
  })

  it('does not assign a claimed spare workspace to a second new thread', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.spares.set(WorkspaceToggle.spareKey('project', 'main'), { workspaceId: 'ws-spare', name: 'thread-5pa4e0' })
    const request = { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null }

    for (const visitId of ['s1', 's2']) {
      toggle.actor.send({ type: 'arrive', visitId, workspaceId: 'project', isolateByDefault: true })
      toggle.actor.send({ type: 'resolved', visitId, request })
      await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    }

    expect(toggle.calls.filter(call => call.startsWith('provision'))).toHaveLength(1)
    expect(toggle.switched).toEqual(['ws-spare', 'ws-thread-abc123'])
  })

  it('settles a new thread already at its default destination without blocking Send', () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'ws-thread', isolateByDefault: true })
    toggle.actor.send({ type: 'resolved', visitId: 's1', request: null })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual([])
  })

  it('keeps a manual isolation in the workspace its switch opened', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.actor.send({
      type: 'toggle',
      visitId: 'session:project',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.switched).toEqual(['ws-thread-abc123'])

    // The switch makes DSH open a fresh blank Session in the new workspace, so the client reports that workspace
    // under a new visit id; defaultDestinationMove would send it back to the project checkout.
    toggle.actor.send({ type: 'arrive', visitId: 'session:thread', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    toggle.actor.send({
      type: 'resolved',
      visitId: 'session:thread',
      request: { isolate: false, projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('moves a later blank Session out of a workspace the toggle opened for an earlier visit', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.actor.send({
      type: 'toggle',
      visitId: 'session:0',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    // The Session the switch created continues that visit and stays.
    toggle.actor.send({ type: 'arrive', visitId: 'session:created', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)

    // A blank Session a later visit opens there is not a continuation, so it returns to the project checkout.
    toggle.actor.send({ type: 'arrive', visitId: 'session:1', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    toggle.actor.send({
      type: 'resolved',
      visitId: 'session:1',
      request: { isolate: false, projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.switched).toEqual(['ws-thread-abc123', 'project'])
    expect(toggle.actor.getSnapshot().context).toMatchObject({ opened: 'project' })
  })

  it('never moves a thread again once the user toggled it', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'project', isolateByDefault: false })
    toggle.actor.send({ type: 'toggle', visitId: 's1', request: { isolate: false, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    toggle.actor.send({ type: 'resolved', visitId: 's1', request: { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
  })

  it('provisions nothing when a reload shows a blank thread in the workspace it already owns', async () => {
    // A reload starts a fresh actor with no memory of the switch that put the thread there; the Host still describes
    // that workspace as isolated and unshared, which is the destination itself.
    const toggle = startToggle()
    const request = WorkspaceToggle.defaultDestinationMove({
      destination: {
        vcs: 'jj',
        isolated: true,
        ownedByAnotherSession: false,
        projectWorkspaceId: 'project',
        bookmark: 'main',
        bookmarks: ['main'],
        isolateByDefault: true,
      },
      workspaceId: 'ws-own',
    })
    toggle.actor.send({ type: 'arrive', visitId: 'session:reloaded', workspaceId: 'ws-own', isolateByDefault: true })
    toggle.actor.send({ type: 'resolved', visitId: 'session:reloaded', request })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual([])
    expect(toggle.switched).toEqual([])
  })
})

describe('deferWorkspaceSubmit', () => {
  it('holds only a requested send and submits it in the newly selected workspace', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    const sourceComposer = composerWithDraft('')
    sourceComposer.edit('send after setup')
    expect(sourceComposer.input.state.getSnapshot().draft).toBe('send after setup')
    const targetComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const target: WorkspaceComposer = {
      sessionId: SessionId('target'),
      workspaceId: 'ws-thread-abc123',
      blank: true,
      input: targetComposer.input,
    }
    const blockCalls: string[] = []
    const blocks: Pick<ComposerBlocks, 'set'> = {
      set: (_sessionId, block) => blockCalls.push(block?.reason ?? 'released'),
    }
    expect(blockCalls).toEqual([])

    const pending = deferWorkspaceSubmit({
      actor: toggle.actor,
      source,
      submitSource: 'enter',
      current: () => target,
      blocks,
      reason: 'Preparing thread-abc123…',
      failureMessage: 'Workspace setup failed.',
      changedMessage: 'The draft changed.',
      signal: new AbortController().signal,
    })
    expect(blockCalls).toEqual(['Preparing thread-abc123…'])
    expect(sourceComposer.submissions).toEqual([])
    toggle.release()
    await expect(pending).resolves.toBe('sent')
    expect(targetComposer.submissions).toEqual([{ mode: 'queue', source: 'enter' }])
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
  })

  it('leaves the draft unsent and releases the composer when provisioning fails', async () => {
    const toggle = startToggle({ provision: async () => Promise.reject(new Error('jj workspace add failed')) })
    toggle.actor.send({ type: 'toggle', request: { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const blockCalls: string[] = []
    const blocks: Pick<ComposerBlocks, 'set'> = {
      set: (_sessionId, block) => blockCalls.push(block?.reason ?? 'released'),
    }

    await expect(
      deferWorkspaceSubmit({
        actor: toggle.actor,
        source,
        submitSource: 'click',
        current: () => source,
        blocks,
        reason: 'Preparing thread-abc123…',
        failureMessage: 'Workspace setup failed.',
        changedMessage: 'The draft changed.',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('failed')
    expect(sourceComposer.submissions).toEqual([])
    expect(sourceComposer.notices).toEqual(['Workspace setup failed.'])
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
  })

  it('leaves the draft unsent when destination lookup times out', async () => {
    vi.useFakeTimers()
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'project', isolateByDefault: true })
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const blockCalls: string[] = []
    const blocks: Pick<ComposerBlocks, 'set'> = {
      set: (_sessionId, block) => blockCalls.push(block?.reason ?? 'released'),
    }
    const pending = deferWorkspaceSubmit({
      actor: toggle.actor,
      source,
      submitSource: 'enter',
      current: () => source,
      blocks,
      reason: 'Preparing thread-abc123…',
      failureMessage: 'Workspace setup failed.',
      changedMessage: 'The draft changed.',
      signal: new AbortController().signal,
    })

    await vi.advanceTimersByTimeAsync(15_000)
    await expect(pending).resolves.toBe('failed')
    expect(toggle.actor.getSnapshot().context.error).toBe('Destination lookup timed out.')
    expect(sourceComposer.submissions).toEqual([])
    expect(sourceComposer.notices).toEqual(['Workspace setup failed.'])
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
    toggle.actor.send({ type: 'arrive', visitId: 's2', workspaceId: 'project', isolateByDefault: false })
    expect(toggle.actor.getSnapshot().context.error).toBeNull()
  })

  it('cancels the deferred send and releases the composer on Escape', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const blockCalls: string[] = []
    const blocks: Pick<ComposerBlocks, 'set'> = {
      set: (_sessionId, block) => blockCalls.push(block?.reason ?? 'released'),
    }
    const controller = new AbortController()
    const pending = deferWorkspaceSubmit({
      actor: toggle.actor,
      source,
      submitSource: 'enter',
      current: () => source,
      blocks,
      reason: 'Preparing thread-abc123…',
      failureMessage: 'Workspace setup failed.',
      changedMessage: 'The draft changed.',
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).resolves.toBe('cancelled')
    expect(sourceComposer.submissions).toEqual([])
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
    toggle.release()
    toggle.actor.stop()
  })
})

describe('defaultDestinationMove', () => {
  const destination = (overrides: Partial<DestinationView>): DestinationView => ({
    vcs: 'jj',
    isolated: false,
    projectWorkspaceId: 'project',
    bookmark: 'main',
    bookmarks: ['main'],
    isolateByDefault: true,
    ...overrides,
  })

  it('isolates a new thread from the project checkout when isolation is the default', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({}), workspaceId: 'project' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
  })

  it('does not reuse the inherited thread workspace when isolation is the default', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ isolated: true }), workspaceId: 'ws-other' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
      excludeSpareWorkspaceId: 'ws-other',
    })
  })

  it('returns a new thread to the project checkout when isolation is off', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ isolated: true, isolateByDefault: false }), workspaceId: 'ws-other' })).toEqual({
      isolate: false,
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ isolateByDefault: false }), workspaceId: 'project' })).toBeNull()
  })

  it('keeps a new thread outside jj unchanged', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ vcs: 'none' }), workspaceId: 'project' })).toBeNull()
  })

  it('keeps a blank thread that already owns its isolated thread workspace', () => {
    expect(
      WorkspaceToggle.defaultDestinationMove({
        destination: destination({ isolated: true, ownedByAnotherSession: false }),
        workspaceId: 'ws-own',
      }),
    ).toBeNull()
  })

  it('moves a blank thread on a Host that predates the ownership field', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ isolated: true }), workspaceId: 'ws-own' })).not.toBeNull()
  })

  it('moves a blank thread out of a thread workspace another Session shares', () => {
    expect(
      WorkspaceToggle.defaultDestinationMove({
        destination: destination({ isolated: true, ownedByAnotherSession: true }),
        workspaceId: 'ws-shared',
      }),
    ).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
      excludeSpareWorkspaceId: 'ws-shared',
    })
  })
})

describe('eagerDestinationMove', () => {
  it('isolates before the Host answers and excludes an inherited thread workspace from spare reuse', () => {
    expect(WorkspaceToggle.eagerDestinationMove({ workspaceId: 'project', projectWorkspaceId: 'project', bookmark: 'main' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
    expect(WorkspaceToggle.eagerDestinationMove({ workspaceId: 'ws-other', projectWorkspaceId: 'project', bookmark: 'main' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
      excludeSpareWorkspaceId: 'ws-other',
    })
  })
})
