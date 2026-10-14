import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import type { DestinationView } from './api.js'
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
    blockComposer: reason => {
      calls.push(`block ${reason}`)
      return () => void calls.push('unblock')
    },
    generateName: () => 'thread-abc123',
    preparingReason: name => `Preparing ${name ?? 'project'}`,
    ...overrides,
  }
  const actor = createActor(workspaceToggleMachine, { input: { client } }).start()
  const switched: string[] = []
  actor.on('switched', event => switched.push(event.workspaceId))
  return { actor, calls, spares, switched, release: () => gate() }
}

describe('workspaceToggleMachine', () => {
  it('shows the client-chosen name at once and blocks the composer until the Host created the workspace', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'toggle', request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    expect(toggle.actor.getSnapshot().context.pending).toEqual({ isolate: true, name: 'thread-abc123', spare: null })
    expect(toggle.calls).toEqual(['block Preparing thread-abc123', 'provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.calls.slice(2)).toEqual(['open ws-thread-abc123', 'unblock'])
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

  it('reports a failed provision and releases the composer', async () => {
    const toggle = startToggle({ provision: async () => Promise.reject(new Error('jj workspace add failed')) })
    toggle.actor.send({ type: 'toggle', request: { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null } })
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.actor.getSnapshot().context).toMatchObject({ pending: null, error: 'jj workspace add failed' })
    expect(toggle.calls.at(-1)).toBe('unblock')
  })

  it('holds Send for a new thread while its destination loads, then moves it to its own workspace in the background', async () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'project', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('preparing')).toBe(true)
    expect(toggle.actor.getSnapshot().context.pending?.name).toBe('thread-abc123')
    expect(toggle.calls).toEqual(['block Preparing thread-abc123'])
    toggle.actor.send({
      type: 'resolved',
      visitId: 's1',
      request: { isolate: true, base: 'main', projectWorkspaceId: 'project', leaving: null, leavingBase: null },
    })
    expect(toggle.calls.slice(1)).toEqual(['unblock', 'block Preparing thread-abc123', 'provision isolate thread-abc123'])
    toggle.release()
    await waitFor(toggle.actor, snapshot => snapshot.matches('idle'))
    expect(toggle.switched).toEqual(['ws-thread-abc123'])
    toggle.actor.send({ type: 'arrive', visitId: 's2', workspaceId: 'ws-thread-abc123', isolateByDefault: true })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls.filter(call => call.startsWith('block'))).toHaveLength(2)
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

  it('releases Send at once when the new thread already sits where it should', () => {
    const toggle = startToggle()
    toggle.actor.send({ type: 'arrive', visitId: 's1', workspaceId: 'ws-thread', isolateByDefault: true })
    toggle.actor.send({ type: 'resolved', visitId: 's1', request: null })
    expect(toggle.actor.getSnapshot().matches('idle')).toBe(true)
    expect(toggle.calls).toEqual(['block Preparing thread-abc123', 'unblock'])
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
