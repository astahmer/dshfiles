import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommunicationService, type CommunicationService } from '@dshfiles/dshx/communication'
import { Effect } from 'effect'
import { cleanupInactiveWorkspaceChannels } from './agent-lifecycle.js'
import { CommunicationHub } from './communication-hub-promise.js'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

const temporaryRoots: string[] = []

const withHub = <A, E>(service: CommunicationService, effect: Effect.Effect<A, E, CommunicationHub>) =>
  Effect.runPromise(effect.pipe(Effect.provide(CommunicationHub.fromService(service))))

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace topic cleanup', () => {
  it('prunes a generated workspace topic once no live Agent remains and it has been idle past the window', async () => {
    let currentTime = 1_800_000_000_000
    const root = await mkdtemp(join(tmpdir(), 'agent-communication-lifecycle-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json'), now: () => currentTime })
    const workspaceCwd = join(root, 'jj-workspace')
    const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(workspaceCwd)

    if (workspaceTopic === undefined) throw new Error('expected a generated workspace topic')
    await service.ensureSubscription({ kind: 'agent', id: 'session-workspace' }, { topic: workspaceTopic, delivery: 'passive' })
    currentTime += 25 * 60 * 60 * 1000

    // A live Agent in that workspace keeps the topic; without one, a plain subscription no longer protects it.
    await expect(withHub(service, cleanupInactiveWorkspaceChannels({ liveAgentCwds: [workspaceCwd], now: currentTime }))).resolves.toBe(0)
    await expect(withHub(service, cleanupInactiveWorkspaceChannels({ liveAgentCwds: [], now: currentTime }))).resolves.toBe(1)
    expect(await service.listTopics()).toEqual([])
  })

  it('never keeps thousands of subscriptions alive just because their Sessions still exist', async () => {
    let currentTime = 1_800_000_000_000
    const root = await mkdtemp(join(tmpdir(), 'agent-communication-lifecycle-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json'), now: () => currentTime })
    const workspaceCwd = join(root, 'shared-workspace')
    const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(workspaceCwd)

    if (workspaceTopic === undefined) throw new Error('expected a generated workspace topic')
    // The old lifecycle subscribed every Agent it saw, so one busy folder accumulated one row per Session.
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        service.ensureSubscription({ kind: 'agent', id: `session-${String(index)}` }, { topic: workspaceTopic, delivery: 'passive' }),
      ),
    )
    currentTime += 25 * 60 * 60 * 1000

    await expect(withHub(service, cleanupInactiveWorkspaceChannels({ liveAgentCwds: [], now: currentTime }))).resolves.toBe(1)
    expect(await service.listTopics()).toEqual([])
  })
})
