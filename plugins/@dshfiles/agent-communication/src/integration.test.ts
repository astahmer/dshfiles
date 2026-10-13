import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionSearchCursor, type SessionEventSearchPage, type SessionEventSearchRequest } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommunicationService, type CommunicationService } from '@dshfiles/dshx/communication'
import { initializeCommunicationAgent } from './agent-lifecycle.js'
import { createAgentCommunicationOperations } from './api-operations.js'
import { communicationWorkspaceTopic, findOwnedLiveAgent, findOwnedLiveAgents, observeLiveAgent, projectRegisteredWorkspace } from './live-agent-directory.js'
import { createSessionHistorySearchRequest, projectSessionHistoryPage } from './session-history.js'

interface TestAgent {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly session: { readonly header: { readonly cwd: string | undefined; readonly createdAt: number } }
  readonly interference: string[]
  readonly followup: () => never
  readonly steer: () => never
  readonly resume: () => never
}

const temporaryRoots: string[] = []
const cwd = '/private/workspaces/project-a'
const now = 1_800_000_000_000

const createAgent = (input: { readonly id: string; readonly status?: 'idle' | 'running'; readonly cwd?: string }): TestAgent => {
  const interference: string[] = []
  const forbid = (name: string) => (): never => {
    interference.push(name)
    throw new Error(`Agent interference: ${name} was called on ${input.id}`)
  }
  return {
    id: input.id,
    status: input.status ?? 'idle',
    session: { header: { cwd: input.cwd, createdAt: 1_800_000_000_000 } },
    interference,
    followup: forbid('followup'),
    steer: forbid('steer'),
    resume: forbid('resume'),
  }
}

const createService = async (): Promise<CommunicationService> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-agent-communication-integration-'))
  temporaryRoots.push(root)
  return createCommunicationService({ statePath: join(root, 'state.json'), now: () => now })
}

const registryFor = (agents: readonly TestAgent[], ownership: Readonly<Record<string, readonly string[]>>) => ({
  list: () => agents,
  isOwnedBy: (candidate: TestAgent, owner: TestAgent) => (ownership[owner.id] ?? []).includes(candidate.id),
})

const register = async (service: CommunicationService, agent: TestAgent): Promise<void> => {
  await initializeCommunicationAgent({ service, agentId: agent.id, workspaceCwd: agent.session.header.cwd })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Agent communication integration', () => {
  it('A: two active agents share information without redirecting either conversation', async () => {
    const service = await createService()
    const agentA = createAgent({ id: 'session-a', status: 'running', cwd })
    const agentB = createAgent({ id: 'session-b', status: 'idle', cwd })
    await register(service, agentA)
    await register(service, agentB)
    const topic = communicationWorkspaceTopic(cwd)
    expect(topic).toBeDefined()

    const message = await service.publish({ sender: { kind: 'agent', id: agentA.id }, topic: topic ?? '', text: 'The build passed.', intent: 'notice' })

    expect(await service.inbox({ principal: { kind: 'agent', id: agentB.id }, topic })).toMatchObject([
      { id: message.id, intent: 'notice', sender: { kind: 'agent', id: agentA.id } },
    ])
    expect(await service.inbox({ principal: { kind: 'agent', id: agentA.id }, topic })).toEqual([])
    expect(agentA.interference).toEqual([])
    expect(agentB.interference).toEqual([])
    expect(agentB.status).toBe('idle')
  })

  it('B: a message to a completed agent stays durable and never resumes or replays it', async () => {
    const service = await createService()
    const completed = createAgent({ id: 'session-completed', status: 'idle', cwd })
    const sender = createAgent({ id: 'session-sender', status: 'running', cwd })
    await register(service, completed)
    await register(service, sender)

    const liveAfterCompletion = [sender]
    expect(liveAfterCompletion.some(agent => agent.id === completed.id)).toBe(false)

    const message = await service.send({ sender: { kind: 'agent', id: sender.id }, toAgentId: completed.id, text: 'Relevant follow-up.', intent: 'notice' })

    expect(await service.browseMessages({ agentId: completed.id })).toMatchObject({ totalMatching: 1, items: [{ id: message.id, topic: null }] })
    expect(await service.inbox({ principal: { kind: 'agent', id: completed.id }, topic: 'inbox' })).toMatchObject([
      { id: message.id, recipients: [{ readAt: 1_800_000_000_000 }] },
    ])
    expect(await service.inbox({ principal: { kind: 'agent', id: completed.id }, topic: 'inbox' })).toHaveLength(1)

    await register(service, completed)
    const replayed = await service.inbox({ principal: { kind: 'agent', id: completed.id }, topic: 'inbox' })
    expect(replayed.map(item => item.id)).toEqual([message.id])
    expect(await service.browseMessages({ agentId: completed.id })).toMatchObject({ totalMatching: 1 })
    expect(completed.interference).toEqual([])
    expect(sender.interference).toEqual([])
  })

  it('C: orchestrator inspection is read-only and never resumes the inspected agents', async () => {
    const orchestrator = createAgent({ id: 'session-orchestrator', status: 'running', cwd })
    const worker = createAgent({ id: 'session-worker', status: 'idle', cwd })
    const unrelated = createAgent({ id: 'session-unrelated', status: 'idle', cwd })
    const registry = registryFor([worker, unrelated], { [orchestrator.id]: [worker.id] })
    const snapshot = JSON.stringify([orchestrator, worker, unrelated].map(agent => ({ id: agent.id, status: agent.status })))

    const descendants = findOwnedLiveAgents({
      caller: orchestrator,
      liveAgents: registry.list(),
      isOwnedBy: registry.isOwnedBy,
    })
    expect(descendants.map(entry => entry.agent.id)).toEqual([worker.id])
    expect(findOwnedLiveAgent({ caller: orchestrator, liveAgents: registry.list(), targetId: unrelated.id, isOwnedBy: registry.isOwnedBy })).toBeUndefined()

    const observed = observeLiveAgent({
      id: worker.id,
      status: worker.status,
      createdAt: worker.session.header.createdAt,
      cwd: worker.session.header.cwd,
    })
    expect(observed).toEqual({ id: worker.id, status: 'idle', createdAt: 1_800_000_000_000, workspaceTopic: communicationWorkspaceTopic(cwd) })
    expect(JSON.stringify(observed)).not.toContain(cwd)

    const workspace = {
      id: WorkspaceId('workspace-id'),
      title: 'project-a',
      path: cwd,
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:00.000Z',
      sessionIds: [],
      setTitle: async () => undefined,
      attachSession: async () => undefined,
      insertSessionBefore: async () => undefined,
      detachSession: async () => undefined,
      status: async (): Promise<'ok' | 'missing-dir'> => 'ok',
    } satisfies Workspace
    expect(projectRegisteredWorkspace(workspace)).toEqual({ workspace_id: 'workspace-id', workspace_title: 'project-a' })

    const sessionId = SessionId(worker.id)
    const page: SessionEventSearchPage = {
      session: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 100, cwd, isSeeded: false },
      items: [{ sessionId, seq: SessionSeq(3), type: 'assistant/message', time: 200, surface: 'current', snippet: 'visible work' }],
      nextCursor: SessionSearchCursor('next-page'),
    }
    const requests: SessionEventSearchRequest[] = []
    const sessionQuery = {
      searchEvents: async (request: SessionEventSearchRequest) => {
        requests.push(request)
        return page
      },
    }

    const projected = projectSessionHistoryPage({
      page: await sessionQuery.searchEvents(createSessionHistorySearchRequest({ sessionId, query: 'visible', limit: 8, cursor: undefined })),
      sessionId,
      runtimeOwnerSessionId: SessionId(orchestrator.id),
    })

    expect(requests).toEqual([{ sessionId: worker.id, query: 'visible', filters: [{ kind: 'type', values: ['user/message', 'assistant/message'] }], limit: 8 }])
    expect(projected).toMatchObject({ status: 'results', session_id: worker.id, runtime_owner_session_id: orchestrator.id, more_available: true })
    expect(JSON.stringify(projected)).not.toContain(cwd)
    expect(Object.keys(sessionQuery)).toEqual(['searchEvents'])
    expect(JSON.stringify([orchestrator, worker, unrelated].map(agent => ({ id: agent.id, status: agent.status })))).toBe(snapshot)
    expect(orchestrator.interference).toEqual([])
    expect(worker.interference).toEqual([])
    expect(unrelated.interference).toEqual([])
  })

  it('D: a request intent is distinguishable from a notice and still never delegates work', async () => {
    const service = await createService()
    const sender = createAgent({ id: 'session-sender', status: 'running', cwd })
    const recipient = createAgent({ id: 'session-recipient', status: 'idle', cwd })
    const operations = createAgentCommunicationOperations({
      service: () => service,
      listAgents: () => [{ id: recipient.id, status: recipient.status }],
    })

    const notice = await operations.postMessage({ topic: 'workspace/demo', text: 'FYI.' })
    const request = await operations.postMessage({ topic: 'workspace/demo', text: 'Please review.', intent: 'request' })
    const direct = await service.send({ sender: { kind: 'agent', id: sender.id }, toAgentId: recipient.id, text: 'Please run the checks.', intent: 'request' })

    expect(notice.intent).toBe('notice')
    expect(request.intent).toBe('request')
    expect(direct).toMatchObject({ intent: 'request', recipients: [{ principal: { kind: 'agent', id: recipient.id }, delivery: 'passive' }] })
    expect(Object.hasOwn(service, 'resume')).toBe(false)
    expect(Object.hasOwn(service, 'followup')).toBe(false)
    expect(Object.hasOwn(service, 'steer')).toBe(false)
    expect(sender.interference).toEqual([])
    expect(recipient.interference).toEqual([])
  })

  it('E: concurrent senders keep ordering, attribution, and idempotent retries', async () => {
    const service = await createService()
    const recipient = 'session-recipient'
    const senders = ['session-one', 'session-two', 'session-three']

    const sent = await Promise.all(
      senders.map(sender => service.send({ sender: { kind: 'agent', id: sender }, toAgentId: recipient, text: `update from ${sender}` })),
    )
    const inbox = await service.inbox({ principal: { kind: 'agent', id: recipient } })

    expect(inbox.map(message => message.id)).toEqual(sent.map(message => message.id))
    expect(inbox.map(message => message.sender.id)).toEqual(senders)
    expect(new Set(sent.map(message => message.id)).size).toBe(senders.length)

    const first = sent[0]
    if (first === undefined) throw new Error('Expected a first message.')
    const retried = await service.send({
      sender: { kind: 'agent', id: senders[0] ?? '' },
      toAgentId: recipient,
      text: 'update from session-one',
      dedupeKey: 'retry-key',
    })
    const retriedAgain = await service.send({
      sender: { kind: 'agent', id: senders[0] ?? '' },
      toAgentId: recipient,
      text: 'update from session-one',
      dedupeKey: 'retry-key',
    })
    expect(retriedAgain.id).toBe(retried.id)
    expect(retried.id).not.toBe(first.id)
  })

  it('F: stale ids and reopened state neither lose messages nor replay them as new instructions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshfiles-agent-communication-integration-'))
    temporaryRoots.push(root)
    const statePath = join(root, 'state.json')
    const service = createCommunicationService({ statePath, now: () => now })
    const staleId = 'session-not-live'

    const message = await service.send({ sender: { kind: 'agent', id: 'session-sender' }, toAgentId: staleId, text: 'Pending until that Session runs.' })
    expect(await service.browseMessages({ agentId: staleId })).toMatchObject({ totalMatching: 1 })

    const reopened = createCommunicationService({ statePath, now: () => now })
    expect(await reopened.inbox({ principal: { kind: 'agent', id: staleId }, topic: 'inbox' })).toMatchObject([
      { id: message.id, recipients: [{ readAt: 1_800_000_000_000 }] },
    ])

    await expect(reopened.acknowledge({ kind: 'agent', id: staleId }, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'message-not-found',
    })
    expect(await reopened.browseMessages({ agentId: staleId })).toMatchObject({ totalMatching: 1 })

    const persisted: unknown = JSON.parse(await readFile(statePath, 'utf8'))
    expect(persisted).toMatchObject({ schemaVersion: 4, messages: [{ id: message.id, topic: null }] })
  })

  it('G: a completed workspace agent is not reopened to gather integration context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshfiles-agent-communication-integration-'))
    temporaryRoots.push(root)
    const service = createCommunicationService({ statePath: join(root, 'state.json'), now: () => now })
    const completed = createAgent({ id: 'session-workspace-owner', status: 'idle', cwd })
    const orchestrator = createAgent({ id: 'session-orchestrator', status: 'running', cwd })
    await register(service, completed)
    await register(service, orchestrator)

    const completion = await service.send({
      sender: { kind: 'agent', id: completed.id },
      toAgentId: orchestrator.id,
      text: 'Workspace work is finished; integration context is ready.',
      intent: 'request',
    })

    const liveAgents = [orchestrator]
    const registry = registryFor(liveAgents, {})
    expect(findOwnedLiveAgent({ caller: orchestrator, liveAgents, targetId: completed.id, isOwnedBy: registry.isOwnedBy })).toBeUndefined()
    expect(await service.browseMessages({ agentId: completed.id })).toMatchObject({ totalMatching: 1 })

    const inbox = await service.inbox({ principal: { kind: 'agent', id: orchestrator.id }, topic: 'inbox' })
    expect(inbox.map(item => item.id)).toEqual([completion.id])
    expect(inbox[0]?.intent).toBe('request')
    expect(await service.browseMessages({ agentId: completed.id })).toMatchObject({ totalMatching: 1 })
    expect(completed.interference).toEqual([])
    expect(orchestrator.interference).toEqual([])
  })
})
