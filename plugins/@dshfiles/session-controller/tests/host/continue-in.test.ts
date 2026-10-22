import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, expect, it } from 'vitest'
import { SessionCommandController } from '../../src/native/commands.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const event = (seq: number, type: string): SessionEvent =>
  // SAFETY: the fork cut reads only type, seq and time of these turn markers.
  ({ seq, time: 1_000 + seq, type, data: {} }) as never

const completedThenRunning = [event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'turn/start'), event(3, 'step/start')]

interface Created {
  readonly cwd: string | undefined
  readonly inheritedEventCount: number
  readonly sessionId: string
}

const harness = () => {
  const ctx = new Context()
  contexts.add(ctx)
  const sourceId = SessionId('session-source')
  const observation = (): SessionObservation => ({
    source: 'prepared',
    header: { id: sourceId, createdAt: 100, cwd: '/projects/wrong' } as never,
    inheritedEventCount: 0 as never,
    events: completedThenRunning,
    cursor: 3 as never,
    projections: { asOfSeq: 3 as never, values: {} },
    retain: observation,
    [Symbol.dispose]: () => undefined,
  })
  const created: Created[] = []
  const attached: Array<{ workspace: string; sessionId: string }> = []
  const directories: string[] = []
  const notices: string[] = []
  const workspace = (id: string, path: string) => ({
    id: WorkspaceId(id),
    path,
    sessionIds: id === 'wrong' ? [sourceId] : [],
    attachSession: async (sessionId: string) => {
      attached.push({ workspace: id, sessionId })
    },
  })
  const workspaces = [workspace('wrong', '/projects/wrong'), workspace('right', '/projects/right-threads/thread-1')]
  // SAFETY: fork reads only observeSession from the query service.
  ctx.provide('sessionQuery', { observeSession: async () => observation() } as never)
  // SAFETY: fork reads only list and get from the registry.
  ctx.provide('workspaceRegistry', { list: () => workspaces, get: (id: string) => workspaces.find(entry => entry.id === id) } as never)
  // SAFETY: fork reads only the current default selection.
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'test' }) } as never)
  ctx.provide(
    'agents',
    // SAFETY: fork reads only create; the child Agent is used for set and inject.
    {
      create: async (options: { sessionId: string; inheritedEventCount: number; meta: { cwd?: string } }) => {
        created.push({ cwd: options.meta.cwd, inheritedEventCount: options.inheritedEventCount, sessionId: options.sessionId })
        return { agent: { id: options.sessionId, inject: (message: { content: Array<{ text: string }> }) => notices.push(message.content[0]?.text ?? '') } }
      },
    } as never,
  )
  ctx.provide(
    'workingDirectory',
    // SAFETY: the destination commit calls only set.
    {
      set: async (_agent: { readonly id: string }, path: string) => {
        directories.push(path)
        return path
      },
    } as never,
  )
  // SAFETY: fork reads only the composition of the source's preset.
  const agents = { composeAgent: async () => ({ setup: () => undefined }), presetForObservation: () => undefined } as never
  const commands = new SessionCommandController(ctx, agents, '/default')
  return { commands, created, attached, directories, notices, sourceId }
}

it('runs the continuation in the destination project and tells the model where it came from', async () => {
  const { commands, created, attached, directories, notices, sourceId } = harness()
  const forked = await commands.fork({ sessionId: sourceId }, { workspaceId: WorkspaceId('right'), includeOpenTurn: false })
  expect(created).toEqual([{ cwd: '/projects/right-threads/thread-1', inheritedEventCount: 2, sessionId: forked.sessionId }])
  expect(attached).toEqual([{ workspace: 'right', sessionId: forked.sessionId }])
  expect(directories).toEqual(['/projects/right-threads/thread-1'])
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('session-source')
  expect(notices[0]).toContain('"/projects/wrong"')
  expect(notices[0]).toContain('"/projects/right-threads/thread-1"')
})

it('keeps the running turn when the continuation includes it', async () => {
  const { commands, created, sourceId } = harness()
  await commands.fork({ sessionId: sourceId }, { workspaceId: WorkspaceId('right'), includeOpenTurn: true })
  expect(created.map(entry => entry.inheritedEventCount)).toEqual([4])
})

it('refuses an unknown destination before creating anything', async () => {
  const { commands, created, sourceId } = harness()
  const failure = await commands.fork({ sessionId: sourceId }, { workspaceId: WorkspaceId('missing'), includeOpenTurn: false }).catch((error: unknown) => error)
  expect(remoteErrorOf(failure)?.code).toBe('workspace/not-found')
  expect(created).toEqual([])
})

it('keeps a plain fork in the source directory and project', async () => {
  const { commands, created, attached, directories, notices, sourceId } = harness()
  const forked = await commands.fork({ sessionId: sourceId })
  expect(created).toEqual([{ cwd: '/projects/wrong', inheritedEventCount: 2, sessionId: forked.sessionId }])
  expect(attached).toEqual([{ workspace: 'wrong', sessionId: forked.sessionId }])
  expect(directories).toEqual([])
  expect(notices).toEqual([])
})
