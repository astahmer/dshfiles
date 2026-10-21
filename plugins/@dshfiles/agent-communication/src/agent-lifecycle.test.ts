import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommunicationService } from '@dshfiles/dshx/communication'
import { AgentCommunicationLifecycle } from './agent-lifecycle.js'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('communication Agent initialization', () => {
  it('subscribes every Agent in a shared working directory exactly once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-communication-lifecycle-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json') })
    const workspaceCwd = join(root, 'jj-workspace')
    const agents = Array.from({ length: 26 }, (_, index) => ({ id: `session-${index}`, workspaceCwd }))

    await Promise.all(
      agents.flatMap(agent => [
        AgentCommunicationLifecycle.initializeCommunicationAgent({ service, agentId: agent.id, workspaceCwd: agent.workspaceCwd }),
        AgentCommunicationLifecycle.initializeCommunicationAgent({ service, agentId: agent.id, workspaceCwd: agent.workspaceCwd }),
      ]),
    )

    const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(workspaceCwd)
    expect(workspaceTopic).toMatch(/^workspace\/[a-f0-9]{24}$/)
    expect(await service.listTopics()).toEqual([{ topic: workspaceTopic, subscribers: agents.length }])

    const report = await service.diagnostics({
      agents: agents.map(agent => ({ id: agent.id, status: 'idle', workspaceTopic })),
    })
    expect(report.subscriptionCount).toBe(agents.length)
    expect(report.agents.every(agent => agent.workspaceSubscribed)).toBe(true)
    expect(report.topics).toEqual([{ topic: workspaceTopic, subscribers: agents.length }])
  })

  it('prunes an orphaned workspace channel only after no durable or live Session shares its workspace', async () => {
    let currentTime = 1_800_000_000_000
    const root = await mkdtemp(join(tmpdir(), 'agent-communication-lifecycle-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json'), now: () => currentTime })
    const workspaceCwd = join(root, 'jj-workspace')
    const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(workspaceCwd)

    if (workspaceTopic === undefined) throw new Error('expected a generated workspace topic')
    await service.ensureSubscription({ kind: 'agent', id: 'session-workspace' }, { topic: workspaceTopic, delivery: 'passive' })
    currentTime += 25 * 60 * 60 * 1000

    await expect(
      AgentCommunicationLifecycle.cleanupInactiveWorkspaceChannels({ service, sessionCwds: [workspaceCwd], liveAgentCwds: [], now: currentTime }),
    ).resolves.toBe(0)
    await expect(
      AgentCommunicationLifecycle.cleanupInactiveWorkspaceChannels({ service, sessionCwds: [], liveAgentCwds: [workspaceCwd], now: currentTime }),
    ).resolves.toBe(0)
    await expect(AgentCommunicationLifecycle.cleanupInactiveWorkspaceChannels({ service, sessionCwds: [], liveAgentCwds: [], now: currentTime })).resolves.toBe(
      1,
    )
    expect(await service.listTopics()).toEqual([])
  })

  it('keeps inbox available without inventing a workspace for sessions without cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-communication-lifecycle-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json') })

    await AgentCommunicationLifecycle.initializeCommunicationAgent({ service, agentId: 'session-no-cwd', workspaceCwd: undefined })

    expect(await service.listTopics()).toEqual([])
    expect(await service.diagnostics({ agents: [{ id: 'session-no-cwd', workspaceTopic: null }] })).toMatchObject({
      subscriptionCount: 0,
      agents: [{ workspaceTopic: null, workspaceSubscribed: false }],
    })
  })

  it('reports a registration failure instead of failing the Agent that is being created', async () => {
    const failures: unknown[] = []

    await AgentCommunicationLifecycle.registerCommunicationAgent({
      service: () => {
        throw new Error('communication state is unreadable')
      },
      agentId: 'session-broken',
      workspaceCwd: undefined,
      onFailure: error => failures.push(error),
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
  })
})
