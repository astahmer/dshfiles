import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ThreadPreparation, ThreadWarmup, type WarmPorts, type WarmScheduler } from './thread-warmup.js'
import type { ToggleRequest } from './workspace-toggle-machine.js'

const isolating = (base?: string): ToggleRequest => {
  const request: ToggleRequest = { isolate: true, projectWorkspaceId: 'project', leaving: null, leavingBase: null }
  return base === undefined ? request : { ...request, base }
}

const manualScheduler = (): WarmScheduler & { readonly pending: () => number; readonly runAll: () => void } => {
  const tasks = new Set<() => void>()
  return {
    after: (_milliseconds, task) => {
      tasks.add(task)
      return () => tasks.delete(task)
    },
    pending: () => tasks.size,
    runAll: () => {
      for (const task of [...tasks]) task()
    },
  }
}

interface WarmCalls {
  destination: number
  isolate: number
  composer: number
  keepSpare: { workspaceId: string; name: string; request: ToggleRequest }[]
}

const fixture = (
  options: {
    readonly request?: ToggleRequest | null
    readonly composerFails?: boolean
    readonly isolateFails?: boolean
    readonly destinationFails?: boolean
  } = {},
) => {
  const calls: WarmCalls = { destination: 0, isolate: 0, composer: 0, keepSpare: [] }
  const ports: WarmPorts = {
    destination: async () => {
      calls.destination += 1
      if (options.destinationFails === true) throw new Error('destination lookup failed')
      return options.request === undefined ? isolating() : options.request
    },
    isolate: async request => {
      calls.isolate += 1
      if (options.isolateFails === true) throw new Error('provision failed')
      return { workspaceId: `${request.projectWorkspaceId}-thread` }
    },
    composerIn: async workspaceId => {
      calls.composer += 1
      if (options.composerFails === true) throw new Error('connect failed')
      return {
        sessionId: SessionId('warm-session'),
        workspaceId,
        blank: true,
        // SAFETY: the warm never touches composer behaviour in these tests beyond reading the id back.
        input: {} as never,
      }
    },
    keepSpare: input => calls.keepSpare.push(input),
  }
  const scheduler = manualScheduler()
  const warmups = new ThreadWarmup({ scheduler })
  const warm = (overrides: { readonly name?: string; readonly sourceWorkspaceId?: string } = {}) => ({
    sessionId: 'source',
    sourceWorkspaceId: overrides.sourceWorkspaceId ?? 'checkout',
    name: overrides.name ?? 'thread-abc123',
  })
  return { warmups, ports, calls, scheduler, warm }
}

describe('warm eligibility', () => {
  it('starts once the draft holds something', () => {
    expect(ThreadPreparation.shouldPrepare({ blank: true, sending: false, content: true, isolating: true })).toBe(true)
  })

  it('prepares nothing for an empty draft, an engaged thread, a send in flight or a thread that stays put', () => {
    expect(ThreadPreparation.shouldPrepare({ blank: true, sending: false, content: false, isolating: true })).toBe(false)
    expect(ThreadPreparation.shouldPrepare({ blank: false, sending: false, content: true, isolating: true })).toBe(false)
    expect(ThreadPreparation.shouldPrepare({ blank: true, sending: true, content: true, isolating: true })).toBe(false)
    expect(ThreadPreparation.shouldPrepare({ blank: true, sending: false, content: true, isolating: false })).toBe(false)
  })

  it('reads content from text or attachments', () => {
    expect(ThreadPreparation.holdsContent({ draft: '  \n ', attachmentIds: [] })).toBe(false)
    expect(ThreadPreparation.holdsContent({ draft: 'ship it', attachmentIds: [] })).toBe(true)
    expect(ThreadPreparation.holdsContent({ draft: '', attachmentIds: ['image'] })).toBe(true)
  })
})

describe('the New thread screen still being watched', () => {
  const watched = { sourceSessionId: 'source', mainViewSessionId: 'source', activePanelId: null, screenVisible: true }

  it('follows the created thread only while its own screen is the visible main view', () => {
    expect(ThreadPreparation.waitsOnNewThread(watched)).toBe(true)
  })

  it('leaves the view alone after another thread, another tab or the Start page', () => {
    expect(ThreadPreparation.waitsOnNewThread({ ...watched, mainViewSessionId: 'other-thread' })).toBe(false)
    expect(ThreadPreparation.waitsOnNewThread({ ...watched, activePanelId: 'jj-integration' })).toBe(false)
    expect(ThreadPreparation.waitsOnNewThread({ ...watched, screenVisible: false })).toBe(false)
  })
})

describe('ThreadWarmup', () => {
  it('prepares the thread workspace once while the draft is written', async () => {
    const { warmups, ports, calls, warm } = fixture()
    warmups.prepare(warm(), ports)
    warmups.prepare(warm(), ports)
    await expect(warmups.for(warm())?.target(new AbortController().signal)).resolves.toMatchObject({ workspaceId: 'project-thread' })
    expect(calls).toMatchObject({ destination: 1, isolate: 1, composer: 1 })
    expect(warmups.state('source')?.settled).toBe('ready')
  })

  it('hands the send the destination and the blank composer it already prepared', async () => {
    const { warmups, ports, warm } = fixture()
    warmups.prepare(warm(), ports)
    const prepared = warmups.for(warm())
    if (prepared === undefined) throw new Error('Expected the prepared destination to be offered.')
    await expect(prepared.destination(new AbortController().signal)).resolves.toEqual(isolating())
    await expect(prepared.target(new AbortController().signal)).resolves.toMatchObject({ sessionId: 'warm-session' })
  })

  it('offers nothing to a thread that changed its source workspace or name', () => {
    const { warmups, ports, warm } = fixture()
    warmups.prepare(warm(), ports)
    expect(warmups.for(warm({ sourceWorkspaceId: 'thread-other' }))).toBeUndefined()
    expect(warmups.for(warm({ name: 'thread-other' }))).toBeUndefined()
  })

  it('keeps a provisioned workspace as the project spare when the thread is abandoned', async () => {
    const { warmups, ports, calls, warm } = fixture()
    warmups.prepare(warm(), ports)
    await warmups.for(warm())?.target(new AbortController().signal)
    warmups.abandon('source')
    expect(calls.keepSpare).toEqual([{ workspaceId: 'project-thread', name: 'thread-abc123', request: isolating() }])
    expect(warmups.state('source')).toBeUndefined()
  })

  it('never keeps the workspace a send took', async () => {
    const { warmups, ports, calls, warm } = fixture()
    warmups.prepare(warm(), ports)
    await warmups.for(warm())?.target(new AbortController().signal)
    warmups.consume('source')
    expect(calls.keepSpare).toEqual([])
    expect(warmups.state('source')).toBeUndefined()
  })

  it('keeps nothing for a destination that never provisioned a workspace', async () => {
    const { warmups, ports, calls, warm } = fixture({ request: null })
    warmups.prepare(warm(), ports)
    await expect(warmups.for(warm())?.destination(new AbortController().signal)).resolves.toBeNull()
    warmups.abandon('source')
    expect(calls.keepSpare).toEqual([])
  })

  it('expires a warm the send never took, keeping its workspace spare', async () => {
    const { warmups, ports, calls, scheduler, warm } = fixture()
    warmups.prepare(warm(), ports)
    await warmups.for(warm())?.target(new AbortController().signal)
    expect(scheduler.pending()).toBe(1)
    scheduler.runAll()
    expect(warmups.state('source')).toBeUndefined()
    expect(calls.keepSpare).toHaveLength(1)
  })

  it('forgets a failed warm so the send falls back and the next attempt retries', async () => {
    const failing = fixture({ isolateFails: true })
    failing.warmups.prepare(failing.warm(), failing.ports)
    await expect(failing.warmups.for(failing.warm())?.target(new AbortController().signal)).rejects.toThrow('provision failed')
    expect(failing.warmups.for(failing.warm())).toBeUndefined()
    failing.warmups.prepare(failing.warm(), failing.ports)
    expect(failing.warmups.state('source')?.settled).toBe('pending')
  })

  it('restarts under a new name instead of landing the send in the old destination', async () => {
    const { warmups, ports, calls, warm } = fixture()
    warmups.prepare(warm(), ports)
    await warmups.for(warm())?.target(new AbortController().signal)
    warmups.prepare(warm({ name: 'thread-new' }), ports)
    expect(calls.keepSpare).toHaveLength(1)
    await expect(warmups.for(warm({ name: 'thread-new' }))?.target(new AbortController().signal)).resolves.toMatchObject({
      workspaceId: 'project-thread',
    })
  })

  it('stops working and keeps nothing once disposed', async () => {
    const { warmups, ports, calls, warm } = fixture()
    warmups.prepare(warm(), ports)
    warmups.dispose()
    expect(warmups.state('source')).toBeUndefined()
    expect(calls.keepSpare).toEqual([])
  })
})
