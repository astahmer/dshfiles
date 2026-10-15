import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DestinationView } from './api.js'
import { deferWorkspaceSubmit, type WorkspaceComposer } from './workspace-submit.js'
import {
  defaultDestinationMove,
  eagerDestinationMove,
  spareKey,
  workspaceToggleMachine,
  type SpareWorkspace,
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

  it('keeps the left thread workspace as a spare and reuses it instead of creating another one', async () => {
    const toggle = startToggle()
    toggle.release()
    const leaving = { workspaceId: 'ws-thread-abc123', name: 'thread-abc123' }
    toggle.actor.send({ type: 'toggle', request: { isolate: false, projectWorkspaceId: 'project', leaving, leavingBase: 'main' } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.spares.get(spareKey('project', 'main'))).toEqual(leaving)
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls.filter(call => call.startsWith('provision'))).toEqual([])
    expect(toggle.switched).toEqual(['project', 'ws-thread-abc123'])
  })

  it('retries without the name on a Host that does not know it yet', async () => {
    const names: (string | undefined)[] = []
    const toggle = startToggle({
      provision: async input => {
        names.push(input.name)
        if (input.name !== undefined) throw new Error('Unrecognized key: "name"')
        return { workspaceId: 'ws-host-named' }
      },
    })
    toggle.actor.send({ type: 'toggle', request: { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(names).toEqual(['thread-abc123', undefined])
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
    toggle.actor.send({ type: 'arrive', visitId: 's2', workspaceId: 'ws-thread-abc123', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
  })

  it('waits for Host ownership before accepting a thread workspace that appears exclusive', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'ws-shared', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)
    expect(eagerDestinationMove({ workspaceId: 'ws-shared', inThreadWorkspace: true, occupied: false, bookmark: 'main' })).toBeNull()
    expect(toggle.calls).toEqual([])

    const request = defaultDestinationMove({
      destination: { vcs: 'jj', isolated: true, projectWorkspaceId: 'project', bookmark: 'main', bookmarks: ['main'], isolateByDefault: true },
      workspaceId: 'ws-shared',
      occupied: true,
    })
    expect(request).not.toBeNull()
    toggle.actor.send({ type: 'resolved', visitId: 's1', request })
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
  })

  it('reuses the spare workspace for a new thread instead of provisioning one', async () => {
    const toggle = startToggle()
    toggle.spares.set(spareKey('project', 'main'), { workspaceId: 'ws-spare', name: 'thread-5pa4e0' })
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
  })

  it('settles a new thread already at its default destination without blocking Send', () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'ws-thread', isolateByDefault: true })
    toggle.actor.send({ type: 'resolved', visitId: 's1', request: null })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual([])
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

  it('moves a new thread out of the checkout into its own workspace when isolation is the default', () => {
    expect(defaultDestinationMove({ destination: destination({}), workspaceId: 'project', occupied: false })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
  })

  it('moves a new thread out of another thread workspace, whichever the default', () => {
    expect(defaultDestinationMove({ destination: destination({ isolated: true }), workspaceId: 'ws-other', occupied: true })?.isolate).toBe(true)
    expect(defaultDestinationMove({ destination: destination({ isolated: true, isolateByDefault: false }), workspaceId: 'ws-other', occupied: true })).toEqual({
      isolate: false,
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
  })

  it('keeps a new thread that is already where it belongs, or outside jj', () => {
    expect(defaultDestinationMove({ destination: destination({ isolated: true }), workspaceId: 'ws-own', occupied: false })).toBeNull()
    expect(defaultDestinationMove({ destination: destination({ isolateByDefault: false }), workspaceId: 'project', occupied: false })).toBeNull()
    expect(defaultDestinationMove({ destination: destination({ vcs: 'none' }), workspaceId: 'project', occupied: false })).toBeNull()
  })
})

describe('eagerDestinationMove', () => {
  it('gives a new thread its own workspace without waiting for the Host, unless it already sits alone in one', () => {
    expect(eagerDestinationMove({ workspaceId: 'project', inThreadWorkspace: false, occupied: false, bookmark: 'main' })).toEqual({
      isolate: true,
      base: 'main',
      projectWorkspaceId: 'project',
      leaving: null,
      leavingBase: null,
    })
    expect(eagerDestinationMove({ workspaceId: 'ws-other', inThreadWorkspace: true, occupied: true, bookmark: 'main' })?.isolate).toBe(true)
    expect(eagerDestinationMove({ workspaceId: 'ws-own', inThreadWorkspace: true, occupied: false, bookmark: 'main' })).toBeNull()
  })
})
