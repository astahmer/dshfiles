import { describe, expect, it } from 'vitest'
import { createParentQuestionService, type ParentQuestionAgent, type ParentQuestionRuntime } from './service.js'
import type { ParentQuestionExpiryBehavior, ParentQuestionRecord, ParentQuestionTable } from './store.js'
import { ParentQuestionToolFlow } from './tool-flow.js'

const createMemoryTable = (): ParentQuestionTable => {
  const records = new Map<string, ParentQuestionRecord>()
  return {
    get: key => records.get(key),
    entries: () => new Map(records).entries(),
    keys: () => new Map(records).keys(),
    get size() {
      return records.size
    },
    put: async (key, record) => {
      records.set(key, record)
    },
    delete: async key => records.delete(key),
    update: async (key, transform) => {
      const current = records.get(key)
      if (current === undefined) throw new Error(`Question row ${key} is missing.`)
      const updated = transform(current)
      records.set(key, updated)
      return updated
    },
  }
}

const root: ParentQuestionAgent = { id: 'root-session' }
const firstChild: ParentQuestionAgent = { id: 'child-session-a' }
const secondChild: ParentQuestionAgent = { id: 'child-session-b' }
const unrelatedAgent: ParentQuestionAgent = { id: 'unrelated-session' }

const createRuntime = (): ParentQuestionRuntime => {
  const liveAgents = new Map<string, ParentQuestionAgent>([
    [root.id, root],
    [firstChild.id, firstChild],
    [secondChild.id, secondChild],
    [unrelatedAgent.id, unrelatedAgent],
  ])
  const parentByChild = new Map([
    [firstChild.id, root.id],
    [secondChild.id, root.id],
  ])
  return {
    isLive: agent => liveAgents.get(agent.id) === agent,
    parentSessionId: childId => parentByChild.get(childId),
    isDirectChild: (childId, parentId) => parentByChild.get(childId) === parentId,
    sendToParent: async ({ record, signal }) => {
      signal.throwIfAborted()
      return `message-${record.questionId}`
    },
  }
}

const makeService = (table: ParentQuestionTable, now: () => number = Date.now) =>
  createParentQuestionService({
    table: async () => table,
    runtime: createRuntime(),
    now,
  })

const requestInput = (input: {
  readonly agent?: ParentQuestionAgent
  readonly operationId?: string
  readonly question?: string
  readonly recommendedOptionId?: string
  readonly expiryBehavior?: ParentQuestionExpiryBehavior
  readonly timeoutMs?: number
}) => ({
  agent: input.agent ?? firstChild,
  operationId: input.operationId ?? 'call-1',
  question: input.question ?? 'Which migration strategy should I use?',
  context: 'The migration needs to preserve existing account data.',
  options: [
    { id: 'expand-contract', label: 'Expand and contract' },
    { id: 'direct', label: 'Replace in one migration' },
  ],
  recommendedOptionId: input.recommendedOptionId ?? 'expand-contract',
  expiryBehavior: input.expiryBehavior ?? 'recommended',
  timeoutMs: input.timeoutMs ?? 30_000,
  signal: new AbortController().signal,
})

describe('parent question Host contract', () => {
  it('returns a stable question id for a duplicate operation', async () => {
    const table = createMemoryTable()
    const service = makeService(table)
    const input = requestInput({})

    const first = await service.request(input)
    const duplicate = await service.request(input)

    expect(duplicate).toEqual(first)
    expect(table.size).toBe(1)
    await service.close()
  })

  it('rejects a missing recommendation and changed expiry policy on an idempotent dispatch', async () => {
    const service = makeService(createMemoryTable())
    const input = requestInput({})

    await expect(service.request({ ...input, recommendedOptionId: 'unknown' })).rejects.toThrow('The recommended option must exist in the question options.')
    await service.request(input)
    await expect(service.request({ ...input, expiryBehavior: 'defer' })).rejects.toThrow('Question operation id was reused with different input.')
    await service.close()
  })

  it('stores optional option descriptions and honors a shorter expiry delay', async () => {
    const table = createMemoryTable()
    const service = makeService(table, () => 1_000)
    const input = requestInput({})

    await service.request({
      ...input,
      options: [
        { id: 'expand-contract', label: 'Expand and contract', description: 'Preserve old and new data paths during rollout.' },
        { id: 'direct', label: 'Replace directly' },
      ],
      timeoutMs: 20_000,
    })

    const record = [...table.entries()][0]?.[1]
    expect(record?.expiresAt).toBe(21_000)
    expect(record?.options[0]?.description).toBe('Preserve old and new data paths during rollout.')
    await service.close()
  })

  it('lists pending questions by direct parent with exact deadline and child filter', async () => {
    let timestamp = 1_000
    const service = makeService(createMemoryTable(), () => timestamp)
    const first = await service.request(requestInput({ timeoutMs: 30_000 }))
    const second = await service.request(
      requestInput({
        agent: secondChild,
        operationId: 'call-b',
        question: 'Which validation should I run?',
        timeoutMs: 10_000,
      }),
    )
    timestamp = 4_000

    const all = await service.listForParent({ agent: root })
    const firstQuestion = all.find(question => question.questionId === first.questionId)
    expect(firstQuestion).toMatchObject({
      childSessionId: firstChild.id,
      recommendedOptionId: 'expand-contract',
      expiryBehavior: 'recommended',
      expiresAt: 31_000,
      remainingMs: 27_000,
      expired: false,
    })
    expect(await service.listForParent({ agent: root, childSessionId: secondChild.id })).toMatchObject([
      { questionId: second.questionId, childSessionId: secondChild.id },
    ])
    expect(await service.listForParent({ agent: unrelatedAgent })).toEqual([])

    await service.answer({ agent: root, questionId: first.questionId, answer: 'Use expand and contract.' })
    expect((await service.listForParent({ agent: root })).map(question => question.questionId)).toEqual([second.questionId])
    await service.close()
  })

  it('isolates concurrent child answers by question id', async () => {
    const service = makeService(createMemoryTable())
    const first = await service.request(requestInput({ operationId: 'call-a' }))
    const second = await service.request(
      requestInput({
        agent: secondChild,
        operationId: 'call-b',
        question: 'Which validation should I run?',
      }),
    )
    let secondSettled = false
    const firstWait = service.wait({
      agent: firstChild,
      questionId: first.questionId,
      signal: new AbortController().signal,
    })
    const secondWait = service
      .wait({
        agent: secondChild,
        questionId: second.questionId,
        signal: new AbortController().signal,
      })
      .then(outcome => {
        secondSettled = true
        return outcome
      })

    const firstAnswer = await service.answer({
      agent: root,
      questionId: first.questionId,
      answer: 'Use expand and contract.',
    })
    expect(firstAnswer).toEqual({
      kind: 'answered',
      questionId: first.questionId,
      answer: 'Use expand and contract.',
    })
    expect(await firstWait).toEqual(firstAnswer)
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    await service.answer({ agent: root, questionId: second.questionId, answer: 'Run focused tests.' })
    expect(await secondWait).toEqual({
      kind: 'answered',
      questionId: second.questionId,
      answer: 'Run focused tests.',
    })
    await service.close()
  })

  it('rejects an answer from any Agent except the recorded direct parent', async () => {
    const service = makeService(createMemoryTable())
    const request = await service.request(requestInput({}))

    await expect(
      service.answer({
        agent: unrelatedAgent,
        questionId: request.questionId,
        answer: 'Unauthorized answer.',
      }),
    ).rejects.toThrow('Only the direct parent can answer this question.')

    const answer = await service.answer({
      agent: root,
      questionId: request.questionId,
      answer: 'The parent answer.',
    })
    expect(answer.kind).toBe('answered')
    await service.close()
  })

  it('rejects a competing answer after the parent has already answered', async () => {
    const service = makeService(createMemoryTable())
    const request = await service.request(requestInput({}))

    const attempts = await Promise.allSettled([
      service.answer({ agent: root, questionId: request.questionId, answer: 'First answer.' }),
      service.answer({ agent: root, questionId: request.questionId, answer: 'Second answer.' }),
    ])
    const fulfilled = attempts.filter(attempt => attempt.status === 'fulfilled')
    const rejected = attempts.filter(attempt => attempt.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined).toMatchObject({ message: 'Parent question already has a different answer.' })
    await service.close()
  })

  it('persists pending and answered records across service recreation', async () => {
    const table = createMemoryTable()
    const firstService = makeService(table)
    const request = await firstService.request(requestInput({}))
    await firstService.close()

    const secondService = makeService(table)
    const answer = await secondService.answer({
      agent: root,
      questionId: request.questionId,
      answer: 'Resume with the same request id.',
    })
    await secondService.close()

    const resumedService = makeService(table)
    const recovered = await resumedService.wait({
      agent: firstChild,
      questionId: request.questionId,
      signal: new AbortController().signal,
    })
    expect(recovered).toEqual(answer)
    await resumedService.close()
  })

  it('interrupts Host waiters without cancelling their durable question', async () => {
    const table = createMemoryTable()
    const firstService = makeService(table)
    const input = requestInput({})
    const waiting = ParentQuestionToolFlow.ask({ service: firstService, ...input })
    await new Promise(resolve => setTimeout(resolve, 0))

    await firstService.close()
    const interrupted = await waiting
    expect(interrupted.kind).toBe('interrupted')
    if (interrupted.kind !== 'interrupted') throw new Error('Host shutdown must interrupt the parent question wait.')
    expect(Array.from(table.entries()).map(([, record]) => record.status)).toEqual(['pending'])

    const restartedService = makeService(table)
    const answer = await ParentQuestionToolFlow.answer({
      service: restartedService,
      agent: root,
      questionId: interrupted.questionId,
      answer: 'The durable wait can reattach after Host recreation.',
    })
    const recovered = await ParentQuestionToolFlow.reattach({
      service: restartedService,
      agent: firstChild,
      questionId: interrupted.questionId,
      signal: new AbortController().signal,
    })

    expect(answer.kind).toBe('answered')
    expect(recovered).toEqual({
      kind: 'answered',
      questionId: interrupted.questionId,
      answer: 'The durable wait can reattach after Host recreation.',
    })
    await restartedService.close()
  })

  it('cancels the durable request when the child cancels its wait', async () => {
    const service = makeService(createMemoryTable())
    const request = await service.request(requestInput({}))
    const controller = new AbortController()
    const waiting = service.wait({
      agent: firstChild,
      questionId: request.questionId,
      signal: controller.signal,
    })
    controller.abort()

    expect(await waiting).toEqual({ kind: 'cancelled', questionId: request.questionId })
    await expect(
      service.answer({
        agent: root,
        questionId: request.questionId,
        answer: 'Too late.',
      }),
    ).rejects.toThrow('Parent question is cancelled.')
    await service.close()
  })

  it('uses the recommended option when a question reaches its persisted deadline', async () => {
    let timestamp = 1_000_000
    const service = makeService(createMemoryTable(), () => timestamp)
    const request = await service.request(requestInput({ timeoutMs: 1_000 }))
    timestamp += 1_000

    const outcome = await service.wait({
      agent: firstChild,
      questionId: request.questionId,
      signal: new AbortController().signal,
    })
    expect(outcome).toEqual({
      kind: 'recommended',
      questionId: request.questionId,
      option: { id: 'expand-contract', label: 'Expand and contract' },
    })
    await service.close()
  })

  it('returns deferred question data and attaches one safe relative file path', async () => {
    let timestamp = 1_000_000
    const table = createMemoryTable()
    const service = makeService(table, () => timestamp)
    const request = await service.request(requestInput({ timeoutMs: 1_000, expiryBehavior: 'defer' }))
    timestamp += 1_000

    const outcome = await service.wait({
      agent: firstChild,
      questionId: request.questionId,
      signal: new AbortController().signal,
    })
    expect(outcome).toEqual({
      kind: 'deferred',
      questionId: request.questionId,
      childSessionId: firstChild.id,
      question: 'Which migration strategy should I use?',
      context: 'The migration needs to preserve existing account data.',
      options: [
        { id: 'expand-contract', label: 'Expand and contract' },
        { id: 'direct', label: 'Replace in one migration' },
      ],
      recommendedOption: { id: 'expand-contract', label: 'Expand and contract' },
      createdAt: 1_000_000,
      deferredAt: 1_001_000,
    })

    const filePath = 'questions/2026-10-06T10-00-00-000Z_migration.md'
    const recorded = await service.recordDeferredFile({ agent: firstChild, questionId: request.questionId, filePath })
    expect(recorded).toMatchObject({ kind: 'deferred', filePath })
    await expect(service.recordDeferredFile({ agent: firstChild, questionId: request.questionId, filePath })).resolves.toEqual(recorded)
    await expect(
      service.recordDeferredFile({
        agent: firstChild,
        questionId: request.questionId,
        filePath: 'questions/other-question.md',
      }),
    ).rejects.toThrow('Deferred question already has a different file path.')
    await expect(
      service.recordDeferredFile({
        agent: unrelatedAgent,
        questionId: request.questionId,
        filePath,
      }),
    ).rejects.toThrow('Only the requesting direct child can read or cancel this question.')
    expect(table.entries().next().value?.[1].deferredFilePath).toBe(filePath)
    await service.close()
  })

  it('rejects calls from an Agent with no live direct parent', async () => {
    const service = makeService(createMemoryTable())

    await expect(service.request(requestInput({ agent: unrelatedAgent }))).rejects.toThrow('A question can only be requested by a live direct subagent.')
    await service.close()
  })
})
