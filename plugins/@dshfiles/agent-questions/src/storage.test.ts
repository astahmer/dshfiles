import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { describe, expect, it } from 'vitest'
import {
  createParentQuestionService,
  type ParentQuestionAgent,
  type ParentQuestionRuntime,
} from './service.js'
import { parentQuestionDomain } from './store.js'

const parent: ParentQuestionAgent = { id: 'root-session' }
const child: ParentQuestionAgent = { id: 'child-session' }

const createRuntime = () => {
  const liveParent: ParentQuestionAgent = { id: parent.id }
  const liveChild: ParentQuestionAgent = { id: child.id }
  const liveAgents = new Map([
    [liveParent.id, liveParent],
    [liveChild.id, liveChild],
  ])
  const runtime: ParentQuestionRuntime = {
    isLive: agent => liveAgents.get(agent.id) === agent,
    parentSessionId: childId => childId === liveChild.id ? liveParent.id : undefined,
    isDirectChild: (childId, parentId) => childId === liveChild.id && parentId === liveParent.id,
    sendToParent: async ({ record, signal }) => {
      signal.throwIfAborted()
      return `message-${record.questionId}`
    },
  }
  return { parent: liveParent, child: liveChild, runtime }
}

const openQuestionStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(parentQuestionDomain)
  return { context, domain, table: domain.table('questions') }
}

const createService = (
  table: Awaited<ReturnType<typeof openQuestionStorage>>['table'],
  runtime: ParentQuestionRuntime,
) => createParentQuestionService({ table: async () => table, runtime })

describe('parent question JSON storage', () => {
  it('keeps a pending question answerable across Host shutdown and durable reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-questions-'))
    let first: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let second: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let third: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let firstService: ReturnType<typeof createService> | undefined
    let secondService: ReturnType<typeof createService> | undefined
    let thirdService: ReturnType<typeof createService> | undefined

    try {
      first = await openQuestionStorage(root)
      const firstRuntime = createRuntime()
      firstService = createService(first.table, firstRuntime.runtime)
      const receipt = await firstService.request({
        agent: firstRuntime.child,
        operationId: 'question-call-1',
        question: 'Which migration strategy should I use?',
        context: 'Preserve existing account data.',
        options: [
          { id: 'expand-contract', label: 'Expand and contract' },
          { id: 'direct', label: 'Replace in one migration' },
        ],
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      })
      const waiting = firstService.wait({
        agent: firstRuntime.child,
        questionId: receipt.questionId,
        signal: new AbortController().signal,
      })
      const interrupted = expect(waiting).rejects.toThrow('interrupted by Host shutdown')
      await setImmediate()
      await firstService.close()
      await interrupted
      expect([...first.table.entries()].find(([, record]) => record.questionId === receipt.questionId)?.[1].status)
        .toBe('pending')
      await first.domain.close()
      await first.context.fiber.dispose()
      first = undefined

      second = await openQuestionStorage(root)
      const secondRuntime = createRuntime()
      secondService = createService(second.table, secondRuntime.runtime)
      const answer = await secondService.answer({
        agent: secondRuntime.parent,
        questionId: receipt.questionId,
        answer: 'Use expand and contract.',
      })
      await secondService.close()
      await second.domain.close()
      await second.context.fiber.dispose()
      second = undefined

      third = await openQuestionStorage(root)
      const thirdRuntime = createRuntime()
      thirdService = createService(third.table, thirdRuntime.runtime)
      const recovered = await thirdService.wait({
        agent: thirdRuntime.child,
        questionId: receipt.questionId,
        signal: new AbortController().signal,
      })

      expect(answer).toEqual({
        kind: 'answered',
        questionId: receipt.questionId,
        answer: 'Use expand and contract.',
      })
      expect(recovered).toEqual(answer)
    } finally {
      await firstService?.close()
      await first?.domain.close()
      await first?.context.fiber.dispose()
      await secondService?.close()
      await second?.domain.close()
      await second?.context.fiber.dispose()
      await thirdService?.close()
      await third?.domain.close()
      await third?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
