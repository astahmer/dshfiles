import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DestinationView } from './api.js'
import { deferWorkspaceSubmit, deliverFirstSend, type WorkspaceComposer } from './workspace-submit.js'
import {
  defersIsolationToSend,
  WorkspaceToggle,
  workspaceToggleMachine,
  type DeferredMove,
  type SpareWorkspace,
  type ToggleRequest,
  type WorkspaceToggleClient,
} from './workspace-toggle-machine.js'

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

type Toggle = ReturnType<typeof startToggle>

const visitOf = (sessionId: string): string => `new-thread:${sessionId}`

const arriveAt = (
  toggle: Toggle,
  input: {
    readonly sessionId: string
    readonly workspaceId: string
    readonly isolateByDefault?: boolean | undefined
    readonly visitId?: string | undefined
  },
): void => {
  toggle.actor.send({
    type: 'arrive',
    visitId: input.visitId ?? visitOf(input.sessionId),
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    isolateByDefault: input.isolateByDefault ?? true,
  })
}

const resolveAt = (
  toggle: Toggle,
  input: {
    readonly sessionId: string
    readonly request: ToggleRequest | null
    readonly visitId?: string | undefined
  },
): void => {
  toggle.actor.send({ type: 'resolved', visitId: input.visitId ?? visitOf(input.sessionId), request: input.request })
}

const commit = (toggle: Toggle, sessionId: string): void => toggle.actor.send({ type: 'commit', sessionId })

const isolateRequest = (overrides: Partial<ToggleRequest> = {}): ToggleRequest => ({
  isolate: true,
  base: 'main',
  projectWorkspaceId: 'project',
  leaving: null,
  leavingBase: null,
  ...overrides,
})

const sharedRequest = (overrides: Partial<ToggleRequest> = {}): ToggleRequest => ({
  isolate: false,
  projectWorkspaceId: 'project',
  leaving: null,
  leavingBase: null,
  ...overrides,
})

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

const blocksRecorder = () => {
  const blockCalls: string[] = []
  const blocks: Pick<ComposerBlocks, 'set'> = {
    set: (_sessionId, block) => blockCalls.push(block?.reason ?? 'released'),
  }
  return { blockCalls, blocks }
}

describe('workspaceToggleMachine', () => {
  it('shows the client-chosen name while the Host creates the workspace without blocking the composer', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
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
    toggle.actor.send({ type: 'toggle', request: sharedRequest({ leaving, leavingBase: 'main' }) })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.spares.get(WorkspaceToggle.spareKey('project', 'main'))).toEqual(leaving)
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
    expect(toggle.switched).toEqual(['project', 'ws-thread-abc123'])
  })

  it('does not reuse the inherited thread workspace even when it is also the stored spare', async () => {
    const toggle = startToggle()
    toggle.release()
    const key = WorkspaceToggle.spareKey('project', 'main')
    toggle.spares.set(key, { workspaceId: 'ws-old', name: 'thread-old' })
    toggle.actor.send({ type: 'toggle', request: isolateRequest({ excludeSpareWorkspaceId: 'ws-old' }) })
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
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(payloads).toStrictEqual([
      { workspaceId: 'project', isolate: true, base: 'main', name: 'thread-abc123' },
      { workspaceId: 'project', isolate: true, base: 'main' },
    ])
    expect(toggle.switched).toEqual(['ws-host-named'])
  })

  it('reports a failed provision without blocking the composer', async () => {
    const toggle = startToggle({ provision: async () => Promise.reject(new Error('jj workspace add failed')) })
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.actor.getSnapshot().context).toMatchObject({ pending: null, error: 'jj workspace add failed' })
  })

  it('arriving provisions nothing and holds the move for the first send', () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.actor.getSnapshot().context.pending).toBeNull()
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([
      {
        sessionId: 's1',
        visitId: visitOf('s1'),
        workspaceId: 'project',
        name: 'thread-abc123',
        wantsIsolation: true,
        request: isolateRequest(),
      },
    ])
    expect(toggle.calls).toEqual([])
    expect(toggle.switched).toEqual([])
  })

  it('starts the deferred isolation on the first send and opens the workspace it created', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    expect(toggle.calls).toEqual([])

    commit(toggle, 's1')
    expect(toggle.actor.getSnapshot().matches('switching')).toBe(true)
    expect(toggle.actor.getSnapshot().context.pending).toEqual({ isolate: true, name: 'thread-abc123', spare: null })
    expect(toggle.calls).toEqual(['provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
  })

  it('waits for the destination before starting a committed first send', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    commit(toggle, 's1')

    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)
    expect(toggle.actor.getSnapshot().context.pending).toEqual({ isolate: true, name: 'thread-abc123', spare: null })
    expect(toggle.calls).toEqual([])

    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    expect(toggle.calls).toEqual(['provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('settles the fresh Session DSH opens in the workspace the switch created', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 'session:project', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 'session:project', request: isolateRequest() })
    commit(toggle, 'session:project')
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    // DSH backs the moved thread with a fresh blank Session, so the client reports the new workspace under a new visit.
    arriveAt(toggle, { sessionId: 'session:thread', workspaceId: 'ws-thread-abc123' })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual(['provision isolate thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('continues a switch with the blank Session DSH opens before the switch finishes', async () => {
    const calls: string[] = []
    let releaseOpen = (): void => undefined
    const openGate = new Promise<void>(resolve => (releaseOpen = resolve))
    const toggle = startToggle({
      open: async workspaceId => {
        calls.push(`open ${workspaceId}`)
        await openGate
      },
    })
    toggle.release()
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
    expect(toggle.actor.getSnapshot().matches('switching')).toBe(true)

    // DSH opens the fresh blank Session in the workspace the switch moved the thread to while `open` still runs.
    arriveAt(toggle, { sessionId: 'session:created', workspaceId: 'ws-thread-abc123' })
    releaseOpen()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.actor.getSnapshot().context.opened).toBeNull()
    expect(toggle.actor.getSnapshot().context.landed).toBe('ws-thread-abc123')
    expect(toggle.actor.getSnapshot().context.settled).toContain(visitOf('session:created'))
    expect(calls).toEqual(['open ws-thread-abc123'])

    // The next New thread in that workspace is not a continuation, so its isolation waits for its first send.
    arriveAt(toggle, { sessionId: 'session:next', workspaceId: 'ws-thread-abc123' })
    resolveAt(toggle, { sessionId: 'session:next', request: isolateRequest() })
    expect(toggle.actor.getSnapshot().context.deferred).toHaveLength(1)
  })

  it('creates a fresh workspace when a new thread inherits another thread workspace', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'ws-shared' })
    expect(toggle.calls).toEqual([])

    const request = WorkspaceToggle.defaultDestinationMove({
      destination: { vcs: 'jj', isolated: true, projectWorkspaceId: 'project', bookmark: 'main', bookmarks: ['main'], isolateByDefault: true },
      workspaceId: 'ws-shared',
      defaultBookmark: 'main',
    })
    expect(request).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
      excludeSpareWorkspaceId: 'ws-shared',
    })
    resolveAt(toggle, { sessionId: 's1', request })
    expect(toggle.calls).toEqual([])

    commit(toggle, 's1')
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('reuses the spare workspace for a new thread instead of provisioning one', async () => {
    const toggle = startToggle()
    toggle.spares.set(WorkspaceToggle.spareKey('project', 'main'), { workspaceId: 'ws-spare', name: 'thread-5pa4e0' })
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    commit(toggle, 's1')

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

    for (const sessionId of ['s1', 's2']) {
      arriveAt(toggle, { sessionId, workspaceId: 'project' })
      resolveAt(toggle, { sessionId, request: isolateRequest() })
    }
    commit(toggle, 's1')
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    commit(toggle, 's2')
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual(['provision isolate thread-abc123'])
    expect(toggle.switched).toEqual(['ws-spare', 'ws-thread-abc123'])
  })

  it('settles a new thread already at its default destination without blocking Send', () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'ws-thread' })
    resolveAt(toggle, { sessionId: 's1', request: null })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.calls).toEqual([])
  })

  it('keeps a manual isolation in the workspace its switch opened', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.actor.send({ type: 'toggle', visitId: 'session:project', request: isolateRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.switched).toEqual(['ws-thread-abc123'])

    // The switch makes DSH open a fresh blank Session in the new workspace, so the client reports that workspace
    // under a new visit id; defaultDestinationMove would send it back to the project checkout.
    arriveAt(toggle, { sessionId: 'session:thread', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    resolveAt(toggle, { sessionId: 'session:thread', request: sharedRequest() })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual(['provision isolate thread-abc123', 'open ws-thread-abc123'])
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('moves a later blank Session out of a workspace the toggle opened for an earlier visit', async () => {
    const toggle = startToggle()
    toggle.release()
    toggle.actor.send({ type: 'toggle', visitId: 'session:0', request: isolateRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    // The Session the switch created continues that visit and stays.
    arriveAt(toggle, { sessionId: 'session:created', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)

    // A blank Session a later visit opens there is not a continuation, so it returns to the project checkout.
    arriveAt(toggle, { sessionId: 'session:1', workspaceId: 'ws-thread-abc123', isolateByDefault: false })
    resolveAt(toggle, { sessionId: 'session:1', request: sharedRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.switched).toEqual(['ws-thread-abc123', 'project'])
    expect(toggle.actor.getSnapshot().context).toMatchObject({ opened: 'project' })
  })

  it('never moves a thread again once the user toggled it', async () => {
    const toggle = startToggle()
    toggle.release()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project', isolateByDefault: false })
    toggle.actor.send({ type: 'toggle', visitId: visitOf('s1'), request: sharedRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
  })

  it('a manual toggle wins over the move the arrival deferred', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    expect(toggle.actor.getSnapshot().context.deferred).toHaveLength(1)

    toggle.actor.send({ type: 'toggle', visitId: visitOf('s1'), request: sharedRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])

    // The settled visit keeps both the committed move and a late destination from starting anything.
    commit(toggle, 's1')
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
    expect(toggle.switched).toEqual(['project'])
  })

  it('drops the deferred move when its Session stops being blank', () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })

    toggle.actor.send({ type: 'cancel', sessionId: 's1' })
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    commit(toggle, 's1')
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.calls).toEqual([])
    expect(toggle.switched).toEqual([])
  })

  it('stops waiting for a destination when the Session that committed it goes away', () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    commit(toggle, 's1')
    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)

    toggle.actor.send({ type: 'cancel', sessionId: 's1' })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.calls).toEqual([])
  })

  it('keeps one deferred move per Session and never crosses two New threads', async () => {
    let generated = 0
    const toggle = startToggle({ generateName: () => `thread-${String(++generated).padStart(2, '0')}` })
    toggle.release()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    arriveAt(toggle, { sessionId: 's2', workspaceId: 'project' })
    const s1Name = toggle.actor.getSnapshot().context.deferred.find(move => move.sessionId === 's1')?.name
    resolveAt(toggle, { sessionId: 's1', request: isolateRequest() })
    resolveAt(toggle, { sessionId: 's2', request: isolateRequest({ base: 'release' }) })

    // Re-reporting an arrival must not replace the move it already deferred.
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    const moves = toggle.actor.getSnapshot().context.deferred
    expect(moves).toHaveLength(2)
    expect(moves.find(move => move.sessionId === 's1')).toMatchObject({ name: s1Name, workspaceId: 'project', request: isolateRequest() })
    expect(moves.find(move => move.sessionId === 's2')?.request?.base).toBe('release')

    commit(toggle, 's1')
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    commit(toggle, 's2')
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))

    expect(toggle.calls).toEqual([`provision isolate ${s1Name ?? ''}`, `open ws-${s1Name ?? ''}`, 'provision isolate thread-02', 'open ws-thread-02'])
    expect(toggle.switched).toHaveLength(2)
  })

  it('provisions nothing when a reload shows a blank thread in the workspace it already owns', () => {
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
    arriveAt(toggle, { sessionId: 'session:reloaded', workspaceId: 'ws-own' })
    resolveAt(toggle, { sessionId: 'session:reloaded', request })

    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.calls).toEqual([])
    expect(toggle.switched).toEqual([])
  })

  it('does not treat a switch that opened the workspace the thread is already in as a move to continue', async () => {
    const toggle = startToggle()
    toggle.release()
    arriveAt(toggle, { sessionId: 's1', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's1', request: sharedRequest() })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    // Opening the project checkout moved nothing, so no fresh Session arrived and the next New thread there must
    // still get its own workspace.
    expect(toggle.actor.getSnapshot().context.opened).toBeNull()

    arriveAt(toggle, { sessionId: 's2', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 's2', request: isolateRequest() })
    expect(toggle.actor.getSnapshot().context.deferred).toHaveLength(1)
  })
})

describe('deferWorkspaceSubmit', () => {
  it('holds only a requested send and submits it in the newly selected workspace', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
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
    const { blockCalls, blocks } = blocksRecorder()
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

  it('delivers the first send into the workspace the deferred isolation provisioned', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 'source', request: isolateRequest() })
    commit(toggle, 'source')

    const sourceComposer = composerWithDraft('first message')
    const targetComposer = composerWithDraft('first message')
    const source: WorkspaceComposer = { sessionId: SessionId('source'), workspaceId: 'project', blank: true, input: sourceComposer.input }
    const target: WorkspaceComposer = {
      sessionId: SessionId('target'),
      workspaceId: 'ws-thread-abc123',
      blank: true,
      input: targetComposer.input,
    }
    const { blockCalls, blocks } = blocksRecorder()
    // What the client sees: the main view still holds the source composer until the switch opens its workspace.
    let current = source
    toggle.actor.subscribe(snapshot => {
      if (snapshot.matches('idle') && snapshot.context.landed !== null) current = target
    })
    const pending = deferWorkspaceSubmit({
      actor: toggle.actor,
      source,
      submitSource: 'enter',
      current: () => current,
      blocks,
      reason: 'Preparing thread-abc123…',
      failureMessage: 'Workspace setup failed.',
      changedMessage: 'The draft changed.',
      signal: new AbortController().signal,
    })
    expect(sourceComposer.submissions).toEqual([])
    toggle.release()
    await expect(pending).resolves.toBe('sent')
    expect(targetComposer.submissions).toEqual([{ mode: 'queue', source: 'enter' }])
    expect(sourceComposer.submissions).toEqual([])
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
  })

  it('leaves the draft unsent and releases the composer when provisioning fails', async () => {
    const toggle = startToggle({ provision: async () => Promise.reject(new Error('jj workspace add failed')) })
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'project' })
    resolveAt(toggle, { sessionId: 'source', request: isolateRequest() })
    commit(toggle, 'source')
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const { blockCalls, blocks } = blocksRecorder()

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
    expect(sourceComposer.input.state.getSnapshot().draft).toBe('send after setup')
    expect(blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
  })

  it('leaves the draft unsent when destination lookup times out', async () => {
    vi.useFakeTimers()
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'project' })
    commit(toggle, 'source')
    expect(defersIsolationToSend(WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source'))).toBe(true)
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const { blockCalls, blocks } = blocksRecorder()
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
    arriveAt(toggle, { sessionId: 's2', workspaceId: 'project', isolateByDefault: false })
    expect(toggle.actor.getSnapshot().context.error).toBeNull()
  })

  it('cancels the deferred send and releases the composer on Escape', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: isolateRequest() })
    const sourceComposer = composerWithDraft('send after setup')
    const source: WorkspaceComposer = {
      sessionId: SessionId('source'),
      workspaceId: 'project',
      blank: true,
      input: sourceComposer.input,
    }
    const { blockCalls, blocks } = blocksRecorder()
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

describe('defersIsolationToSend', () => {
  const move = (overrides: Partial<DeferredMove>): DeferredMove => ({
    sessionId: 'session',
    visitId: 'new-thread:session',
    workspaceId: 'project',
    name: 'thread-abc123',
    wantsIsolation: false,
    request: null,
    ...overrides,
  })

  it('holds the first send only when that Session is due its own workspace', () => {
    expect(defersIsolationToSend(null)).toBe(false)
    expect(defersIsolationToSend(move({}))).toBe(false)
    expect(defersIsolationToSend(move({ wantsIsolation: true }))).toBe(true)
    expect(defersIsolationToSend(move({ request: isolateRequest() }))).toBe(true)
    expect(defersIsolationToSend(move({ wantsIsolation: true, request: sharedRequest() }))).toBe(false)
  })
})

describe('hostConfirmedOwnThreadWorkspace', () => {
  it('does not settle from a client workspaces-list hint when Host destination is unknown', () => {
    expect(
      WorkspaceToggle.hostConfirmedOwnThreadWorkspace({
        inThreadWorkspace: true,
        clientOccupied: false,
        destination: undefined,
      }),
    ).toBe(false)
    expect(
      WorkspaceToggle.hostConfirmedOwnThreadWorkspace({
        inThreadWorkspace: true,
        clientOccupied: true,
        destination: {
          vcs: 'jj',
          isolated: true,
          projectWorkspaceId: 'project',
          bookmark: 'main',
          bookmarks: ['main'],
          isolateByDefault: true,
          ownedByAnotherSession: false,
        },
      }),
    ).toBe(true)
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
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({}), workspaceId: 'project', defaultBookmark: 'main' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
  })

  it('uses the configured base instead of the project checkout bookmark', () => {
    const checkout = destination({ bookmark: 'fix/sidebar', bookmarks: ['main', 'fix/sidebar'] })
    expect(WorkspaceToggle.defaultDestinationMove({ destination: checkout, workspaceId: 'project', defaultBookmark: 'main' })).toEqual(isolateRequest())
  })

  it('lets the Host choose its configured base when the client has not loaded settings', () => {
    const checkout = destination({ bookmark: 'fix/sidebar', bookmarks: ['main', 'fix/sidebar'] })
    expect(WorkspaceToggle.defaultDestinationMove({ destination: checkout, workspaceId: 'project' })).toStrictEqual({
      isolate: true,
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
  })

  it('shows the configured base for deferred isolation, but keeps explicit and shared destinations truthful', () => {
    const checkout = destination({ bookmark: 'fix/sidebar' })
    expect(WorkspaceToggle.startingBookmark({ destination: checkout, isolated: true, defaultBookmark: 'main' })).toBe('main')
    expect(WorkspaceToggle.startingBookmark({ destination: checkout, isolated: false, defaultBookmark: 'main' })).toBe('fix/sidebar')
    expect(
      WorkspaceToggle.startingBookmark({
        destination: destination({ bookmark: 'fix/sidebar', isolated: true, ownedByAnotherSession: false }),
        isolated: true,
        defaultBookmark: 'main',
      }),
    ).toBe('fix/sidebar')
  })

  it('does not guess an explicit base when isolation is toggled before settings load', () => {
    const checkout = destination({ bookmark: 'fix/sidebar' })
    const base = WorkspaceToggle.startingBookmark({ destination: checkout, isolated: true, defaultBookmark: undefined })
    expect(base).toBeNull()
    // A null chip base makes the checkbox omit base, so the Host can use its own main/develop setting.
    expect(WorkspaceToggle.isolatingMove({ destination: checkout, workspaceId: 'project' })).not.toHaveProperty('base')
  })

  it('supports a configured base other than main', () => {
    expect(
      WorkspaceToggle.defaultDestinationMove({ destination: destination({ bookmark: 'fix/sidebar' }), workspaceId: 'project', defaultBookmark: 'develop' }),
    ).toEqual(isolateRequest({ base: 'develop' }))
  })

  it('does not reuse the inherited thread workspace when isolation is the default', () => {
    expect(WorkspaceToggle.defaultDestinationMove({ destination: destination({ isolated: true }), workspaceId: 'ws-other', defaultBookmark: 'main' })).toEqual({
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
        defaultBookmark: 'main',
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

  it('forces a fresh thread workspace even when isolation is off by default', () => {
    expect(
      WorkspaceToggle.isolatingMove({
        destination: destination({ isolated: true, isolateByDefault: false, ownedByAnotherSession: true }),
        workspaceId: 'ws-shared',
        defaultBookmark: 'main',
      }),
    ).toEqual({ isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null, excludeSpareWorkspaceId: 'ws-shared' })
    expect(WorkspaceToggle.isolatingMove({ destination: destination({ vcs: 'none' }), workspaceId: 'ws-shared' })).toBeNull()
  })
})

describe('first-send isolation', () => {
  it('retires the claimed move without moving anything', () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 'first', workspaceId: 'project' })
    expect(WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'first')).not.toBeNull()
    toggle.actor.send({ type: 'claim', sessionId: 'first' })
    expect(toggle.actor.getSnapshot().context.deferred).toEqual([])
    expect(toggle.actor.getSnapshot().value).toBe('idle')
  })

  it('isolates the next send of a blank Session reopened in the shared thread workspace its first send left', () => {
    const toggle = startToggle()
    const shared = isolateRequest({ excludeSpareWorkspaceId: 'ws-shared' })
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'ws-shared' })
    resolveAt(toggle, { sessionId: 'source', request: shared })
    toggle.actor.send({ type: 'claim', sessionId: 'source' })
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'ws-shared' })
    resolveAt(toggle, { sessionId: 'source', request: shared })
    const move = WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source')
    expect(defersIsolationToSend(move)).toBe(true)
    expect(move?.request).toEqual(shared)
  })

  it('provisions the thread workspace without opening it', async () => {
    const toggle = startToggle()
    const landing = WorkspaceToggle.isolateFirstSend({
      client: toggle.actor.getSnapshot().context.client,
      request: isolateRequest(),
      name: 'thread-abc123',
      signal: new AbortController().signal,
    })
    toggle.release()
    await expect(landing).resolves.toEqual({ workspaceId: 'ws-thread-abc123' })
    expect(toggle.calls).toEqual(['provision isolate thread-abc123'])
  })

  it('never reuses an unresolved-base spare after the Host default changes', async () => {
    let defaultBookmark = 'main'
    const payloads: unknown[] = []
    const toggle = startToggle({
      provision: async input => {
        payloads.push(input)
        return { workspaceId: `ws-${defaultBookmark}` }
      },
    })
    // A legacy/pre-settings warm may have recorded main under the unresolved key. It must never mean develop later.
    toggle.spares.set(WorkspaceToggle.spareKey('project', undefined), { workspaceId: 'ws-main-spare', name: 'thread-123abc' })
    const request: ToggleRequest = { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null }
    const isolate = () =>
      WorkspaceToggle.isolateFirstSend({
        client: toggle.actor.getSnapshot().context.client,
        request,
        name: 'thread-abc123',
        signal: new AbortController().signal,
      })
    await expect(isolate()).resolves.toEqual({ workspaceId: 'ws-main' })
    defaultBookmark = 'develop'
    await expect(isolate()).resolves.toEqual({ workspaceId: 'ws-develop' })
    expect(payloads).toStrictEqual([
      { workspaceId: 'project', isolate: true, name: 'thread-abc123' },
      { workspaceId: 'project', isolate: true, name: 'thread-abc123' },
    ])
  })

  it("takes this project's spare thread workspace and consumes it", async () => {
    const toggle = startToggle()
    toggle.spares.set(WorkspaceToggle.spareKey('project', 'main'), { workspaceId: 'ws-spare', name: 'thread-spare' })
    const landed = await WorkspaceToggle.isolateFirstSend({
      client: toggle.actor.getSnapshot().context.client,
      request: isolateRequest(),
      name: 'thread-abc123',
      signal: new AbortController().signal,
    })
    expect(landed).toEqual({ workspaceId: 'ws-spare' })
    expect(toggle.calls).toEqual([])
    expect(toggle.spares.size).toBe(0)
  })
})

describe('deliverFirstSend', () => {
  const deliveryFixture = (
    options: {
      readonly showsSource?: boolean
      readonly targetDraft?: string
      readonly copies?: boolean
      readonly keeps?: boolean
      readonly destinationFails?: boolean
      readonly failIsolationAttempts?: number
    } = {},
  ) => {
    const sourceComposer = composerWithDraft('first prompt')
    const targetComposer = composerWithDraft(options.targetDraft ?? '')
    const source: WorkspaceComposer = { sessionId: SessionId('source'), workspaceId: 'project', blank: true, input: sourceComposer.input }
    const target = { sessionId: SessionId('target'), workspaceId: 'ws-thread-abc123', blank: true, input: targetComposer.input }
    const { blockCalls, blocks } = blocksRecorder()
    const shown: string[] = []
    const isolated: string[] = []
    const copied: string[] = []
    const isolationAttempts: string[] = []
    const deliver = () =>
      deliverFirstSend({
        source,
        submitSource: 'enter',
        destination: async () => {
          if (options.destinationFails) throw new Error('Destination lookup timed out.')
          return options.keeps === true ? null : isolateRequest()
        },
        isolate: async () => {
          isolationAttempts.push('attempt')
          if (isolationAttempts.length <= (options.failIsolationAttempts ?? 0)) throw new Error('Workspace provisioning failed.')
          isolated.push('ws-thread-abc123')
          return { workspaceId: 'ws-thread-abc123' }
        },
        composerIn: async () => target,
        copyDraft: async () => {
          copied.push(target.sessionId)
          if (options.copies === false) return false
          targetComposer.edit(sourceComposer.input.state.getSnapshot().draft)
          return true
        },
        clearSource: () => sourceComposer.edit(''),
        showsSource: () => options.showsSource ?? false,
        show: sessionId => void shown.push(sessionId),
        blocks,
        reason: 'Preparing thread-abc123…',
        failureMessage: 'Workspace setup failed.',
        changedMessage: 'The draft changed.',
        signal: new AbortController().signal,
      })
    const delivery = deliver()
    return { delivery, deliver, sourceComposer, targetComposer, blockCalls, shown, isolated, copied, isolationAttempts }
  }

  it('keeps the deferred move after a failed first send until a successful retry claims it', async () => {
    const toggle = startToggle()
    arriveAt(toggle, { sessionId: 'source', workspaceId: 'project' })
    const move = WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source')
    if (move === null) throw new Error('Expected the arriving New thread to defer its move.')

    const failed = deliveryFixture({ destinationFails: true })
    await expect(failed.delivery).resolves.toBe('failed')
    expect(WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source')).toEqual(move)
    expect(defersIsolationToSend(WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source'))).toBe(true)

    const retried = deliveryFixture()
    await expect(retried.delivery).resolves.toBe('sent')
    toggle.actor.send({ type: 'claim', sessionId: 'source' })
    expect(WorkspaceToggle.deferredMoveFor(toggle.actor.getSnapshot(), 'source')).toBeNull()
  })

  it('sends into the thread workspace and leaves the view on the New thread opened meanwhile', async () => {
    const fixture = deliveryFixture({ showsSource: false })
    await expect(fixture.delivery).resolves.toBe('sent')
    expect(fixture.targetComposer.submissions).toEqual([{ mode: 'queue', source: 'enter' }])
    expect(fixture.sourceComposer.submissions).toEqual([])
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('')
    expect(fixture.shown).toEqual([])
    expect(fixture.blockCalls).toEqual(['Preparing thread-abc123…', 'released'])
  })

  it('follows the thread into its workspace while the source is still shown', async () => {
    const fixture = deliveryFixture({ showsSource: true })
    await expect(fixture.delivery).resolves.toBe('sent')
    expect(fixture.shown).toEqual(['target'])
  })

  it('sends in place when the destination keeps the thread where it is', async () => {
    const fixture = deliveryFixture({ keeps: true })
    await expect(fixture.delivery).resolves.toBe('kept')
    expect(fixture.sourceComposer.submissions).toEqual([{ mode: 'queue', source: 'enter' }])
    expect(fixture.isolated).toEqual([])
  })

  it('keeps a New thread unsent when its destination lookup fails', async () => {
    const fixture = deliveryFixture({ destinationFails: true })
    await expect(fixture.delivery).resolves.toBe('failed')
    expect(fixture.sourceComposer.submissions).toEqual([])
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('first prompt')
    expect(fixture.sourceComposer.notices).toEqual(['Workspace setup failed.'])
    expect(fixture.isolated).toEqual([])
  })

  it('keeps the first send retryable when workspace provisioning fails', async () => {
    const fixture = deliveryFixture({ failIsolationAttempts: 1 })
    await expect(fixture.delivery).resolves.toBe('failed')
    expect(fixture.sourceComposer.submissions).toEqual([])
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('first prompt')
    expect(fixture.sourceComposer.notices).toEqual(['Workspace setup failed.'])
    expect(fixture.isolationAttempts).toEqual(['attempt'])

    await expect(fixture.deliver()).resolves.toBe('sent')
    expect(fixture.sourceComposer.submissions).toEqual([])
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('')
    expect(fixture.isolated).toEqual(['ws-thread-abc123'])
    expect(fixture.targetComposer.submissions).toEqual([{ mode: 'queue', source: 'enter' }])
    expect(fixture.isolationAttempts).toEqual(['attempt', 'attempt'])
  })

  it('keeps the draft in the source when the thread workspace refuses it', async () => {
    const fixture = deliveryFixture({ copies: false })
    await expect(fixture.delivery).resolves.toBe('failed')
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('first prompt')
    expect(fixture.sourceComposer.notices).toEqual(['Workspace setup failed.'])
    expect(fixture.targetComposer.submissions).toEqual([])
  })

  it('never writes over a thread workspace Session that already holds a draft', async () => {
    const fixture = deliveryFixture({ targetDraft: 'someone else' })
    await expect(fixture.delivery).resolves.toBe('changed')
    expect(fixture.copied).toEqual([])
    expect(fixture.sourceComposer.input.state.getSnapshot().draft).toBe('first prompt')
  })
})
