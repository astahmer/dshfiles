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
import {
  createParentFeedbackService,
  type ParentFeedbackAgent,
  type ParentFeedbackRuntime,
} from './revisioned-feedback.js'
import { parentQuestionDomain, parentQuestionRecordSchema } from './store.js'

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
  return {
    context,
    domain,
    table: domain.table('questions'),
    feedbackTable: domain.table('feedback'),
  }
}

const legacyQuestionDomain = StorageDomain.defineDomain({
  name: parentQuestionDomain.name,
  version: 1,
  layout: 'per-record',
  tables: {
    questions: {
      valueSchema: parentQuestionRecordSchema,
      __key: 'questions',
    },
  },
})

const versionTwoQuestionDomain = StorageDomain.defineDomain({
  name: parentQuestionDomain.name,
  version: 2,
  compatibleVersions: [1],
  layout: 'per-record',
  tables: {
    questions: {
      valueSchema: parentQuestionRecordSchema,
      __key: 'questions',
    },
  },
})

const openLegacyQuestionStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(legacyQuestionDomain)
  return { context, domain, table: domain.table('questions') }
}

const openVersionTwoQuestionStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(versionTwoQuestionDomain)
  return { context, domain, table: domain.table('questions') }
}

const createService = (
  table: Awaited<ReturnType<typeof openQuestionStorage>>['table'],
  runtime: ParentQuestionRuntime,
  now: () => number = Date.now,
) => createParentQuestionService({ table: async () => table, runtime, now })

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
        recommendedOptionId: 'expand-contract',
        expiryBehavior: 'recommended',
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      })
      const waiting = firstService.wait({
        agent: firstRuntime.child,
        questionId: receipt.questionId,
        signal: new AbortController().signal,
      })
      await setImmediate()
      await firstService.close()
      await expect(waiting).resolves.toEqual({ kind: 'interrupted', questionId: receipt.questionId })
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

  it('opens v1 pending rows and keeps their no-default expiry semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-questions-v1-'))
    let legacy: Awaited<ReturnType<typeof openLegacyQuestionStorage>> | undefined
    let current: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let service: ReturnType<typeof createService> | undefined
    const questionId = '00000000-0000-4000-8000-000000000001'

    try {
      legacy = await openLegacyQuestionStorage(root)
      await legacy.table.put('legacy-question', {
        questionId,
        parentSessionId: parent.id,
        childSessionId: child.id,
        operationId: 'legacy-operation',
        question: 'Continue the older request?',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
        status: 'pending',
        createdAt: 1_000,
        expiresAt: 2_000,
        updatedAt: 1_000,
      })
      await legacy.domain.close()
      await legacy.context.fiber.dispose()
      legacy = undefined

      current = await openQuestionStorage(root)
      const currentRuntime = createRuntime()
      service = createService(current.table, currentRuntime.runtime, () => 2_000)
      const outcome = await service.wait({
        agent: currentRuntime.child,
        questionId,
        signal: new AbortController().signal,
      })

      expect(outcome).toEqual({ kind: 'expired', questionId })
      expect([...current.table.entries()][0]?.[1].status).toBe('expired')
    } finally {
      await service?.close()
      await current?.domain.close()
      await current?.context.fiber.dispose()
      await legacy?.domain.close()
      await legacy?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens version 2 question storage with the new feedback table', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-questions-v2-'))
    let versionTwo: Awaited<ReturnType<typeof openVersionTwoQuestionStorage>> | undefined
    let current: Awaited<ReturnType<typeof openQuestionStorage>> | undefined

    try {
      versionTwo = await openVersionTwoQuestionStorage(root)
      await versionTwo.table.put('version-two-question', {
        questionId: '00000000-0000-4000-8000-000000000002',
        parentSessionId: parent.id,
        childSessionId: child.id,
        operationId: 'version-two-operation',
        question: 'Keep this question during the storage upgrade?',
        options: [
          { id: 'keep', label: 'Keep' },
          { id: 'remove', label: 'Remove' },
        ],
        status: 'pending',
        createdAt: 1_000,
        expiresAt: 2_000,
        updatedAt: 1_000,
      })
      await versionTwo.domain.close()
      await versionTwo.context.fiber.dispose()
      versionTwo = undefined

      current = await openQuestionStorage(root)
      expect(current.feedbackTable.size).toBe(0)
      expect([...current.table.entries()]).toMatchObject([[
        'version-two-question',
        { questionId: '00000000-0000-4000-8000-000000000002', status: 'pending' },
      ]])
    } finally {
      await current?.domain.close()
      await current?.context.fiber.dispose()
      await versionTwo?.domain.close()
      await versionTwo?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reattaches to a deferred outcome and file path after JSON domain reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-questions-deferred-'))
    let first: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let second: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let firstService: ReturnType<typeof createService> | undefined
    let secondService: ReturnType<typeof createService> | undefined
    let timestamp = 10_000

    try {
      first = await openQuestionStorage(root)
      const firstRuntime = createRuntime()
      firstService = createService(first.table, firstRuntime.runtime, () => timestamp)
      const receipt = await firstService.request({
        agent: firstRuntime.child,
        operationId: 'deferred-question-call',
        question: 'Which release plan should I use?',
        options: [
          { id: 'staged', label: 'Release in stages' },
          { id: 'single', label: 'Release in one step' },
        ],
        recommendedOptionId: 'staged',
        expiryBehavior: 'defer',
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      })
      timestamp += 1_000
      const deferred = await firstService.wait({
        agent: firstRuntime.child,
        questionId: receipt.questionId,
        signal: new AbortController().signal,
      })
      expect(deferred.kind).toBe('deferred')
      const attached = await firstService.recordDeferredFile({
        agent: firstRuntime.child,
        questionId: receipt.questionId,
        filePath: 'questions/2026-10-06T10-00-00-000Z_release-plan.md',
      })
      await firstService.close()
      await first.domain.close()
      await first.context.fiber.dispose()
      first = undefined

      second = await openQuestionStorage(root)
      const secondRuntime = createRuntime()
      secondService = createService(second.table, secondRuntime.runtime, () => timestamp)
      const recovered = await secondService.wait({
        agent: secondRuntime.child,
        questionId: receipt.questionId,
        signal: new AbortController().signal,
      })

      expect(attached).toMatchObject({ kind: 'deferred', filePath: 'questions/2026-10-06T10-00-00-000Z_release-plan.md' })
      expect(recovered).toEqual(attached)
    } finally {
      await firstService?.close()
      await first?.domain.close()
      await first?.context.fiber.dispose()
      await secondService?.close()
      await second?.domain.close()
      await second?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves anchored feedback and late resolution receipts across JSON domain reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-feedback-'))
    const parentAgent: ParentFeedbackAgent = { id: 'feedback-parent' }
    const childAgent: ParentFeedbackAgent = { id: 'feedback-child' }
    const revision = 'c'.repeat(64)
    const runtime: ParentFeedbackRuntime = {
      isLive: agent => agent === parentAgent || agent === childAgent,
      parentSessionId: childSessionId => childSessionId === childAgent.id ? parentAgent.id : undefined,
      isDirectChild: (childSessionId, parentSessionId) =>
        childSessionId === childAgent.id && parentSessionId === parentAgent.id,
      currentRevision: async () => revision,
      sendToParent: async ({ record }) => `parent-message-${record.feedbackId}`,
      sendToChild: async () => undefined,
    }
    let first: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let second: Awaited<ReturnType<typeof openQuestionStorage>> | undefined
    let firstService: ReturnType<typeof createParentFeedbackService> | undefined
    let secondService: ReturnType<typeof createParentFeedbackService> | undefined

    try {
      const opened = await openQuestionStorage(root)
      first = opened
      firstService = createParentFeedbackService({ table: async () => opened.feedbackTable, runtime })
      const submitted = await firstService.submit({
        agent: childAgent,
        operationId: 'feedback-call-1',
        anchor: {
          kind: 'markdown',
          path: 'docs/guide.md',
          revision,
          startLine: 4,
          endLine: 4,
          excerpt: 'Preserve this behavior.',
        },
        comment: 'Keep the existing recovery guarantee.',
        signal: new AbortController().signal,
      })
      await firstService.close()
      await first.domain.close()
      await first.context.fiber.dispose()
      first = undefined

      const reopened = await openQuestionStorage(root)
      second = reopened
      secondService = createParentFeedbackService({ table: async () => reopened.feedbackTable, runtime })
      expect((await secondService.read({ agent: childAgent, feedbackId: submitted.feedbackId })).status).toBe('pending')
      await secondService.answerMany({
        agent: parentAgent,
        responses: [{ feedbackId: submitted.feedbackId, disposition: 'accepted', note: 'Agreed.' }],
        signal: new AbortController().signal,
      })

      const recovered = await secondService.read({ agent: childAgent, feedbackId: submitted.feedbackId })
      expect(recovered).toMatchObject({
        status: 'resolved',
        anchor: { path: 'docs/guide.md', revision },
        resolutionReceipt: { disposition: 'accepted', observedRevision: revision },
      })
    } finally {
      await firstService?.close()
      await first?.domain.close()
      await first?.context.fiber.dispose()
      await secondService?.close()
      await second?.domain.close()
      await second?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
