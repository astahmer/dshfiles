import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { successfulAccountSchema } from './serving-account-api.js'
import { servingAccountSessionForCaller } from './serving-account-host.js'
import {
  createServingAccountService,
  ServingAccountModel,
  MAX_SERVING_ACCOUNT_SESSIONS,
  SERVING_ACCOUNT_RETENTION_MS,
  type ServingAccountService,
} from './serving-account.js'

const roots: string[] = []
const contexts: Context[] = []
const services: ServingAccountService[] = []
const open = async (root: string, now = () => 1000) => {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  contexts.push(ctx)
  const service = createServingAccountService(ctx, now)
  services.push(service)
  return { ctx, service }
}
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'serving-account-'))
  roots.push(root)
  return { root, ...(await open(root)) }
}
const route = { sessionId: 'chat-one', accountId: 'codex-actual', provider: 'codex', model: 'gpt-5', turn: 1, step: 1 }
const usage: StreamChunk = { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } }
const success: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
const error: StreamChunk = { type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT', message: 'timeout' } } }
const drain = async (service: ServingAccountService, chunks: StreamChunk[], accountId = route.accountId) => {
  const attempt = service.start({ ...route, accountId })
  async function* source() {
    yield* chunks
  }
  const seen: StreamChunk[] = []
  for await (const chunk of ServingAccountModel.observe(source(), service, attempt)) seen.push(chunk)
  return seen
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('actual serving account ownership', () => {
  it('separates failed attempts from last successful, follows failover, and preserves only success across restart', async () => {
    const { root, service } = await fixture()
    expect(await service.read(route.sessionId)).toEqual({ sessionId: route.sessionId, currentAttempt: null, lastSuccessful: null })
    expect(await drain(service, [usage, success])).toEqual([usage, success])
    await drain(service, [usage, error], 'failed-account')
    expect(await service.read(route.sessionId)).toMatchObject({
      currentAttempt: { accountId: 'failed-account', status: 'failed' },
      lastSuccessful: { accountId: 'codex-actual', status: 'succeeded' },
    })
    await drain(service, [usage, success], 'stand-in')
    service.clear(route.sessionId)
    expect(await service.read(route.sessionId)).toMatchObject({ currentAttempt: null, lastSuccessful: { accountId: 'stand-in' } })
    await service.close()
    services.splice(services.indexOf(service), 1)
    const restarted = await open(root)
    expect(await restarted.service.read(route.sessionId)).toMatchObject({ currentAttempt: null, lastSuccessful: { accountId: 'stand-in' } })
    expect(await restarted.service.read('different-chat')).toEqual({ sessionId: 'different-chat', currentAttempt: null, lastSuccessful: null })
  })
  it('does not persist missing usage, truncated streams, exceptions or superseded completions', async () => {
    const { service } = await fixture()
    for (const chunks of [[success], [usage], [usage, error]]) {
      await drain(service, chunks)
      expect((await service.read(route.sessionId)).lastSuccessful).toBeNull()
    }
    const older = service.start(route)
    const newer = service.start({ ...route, accountId: 'newer' })
    service.finish(older, true)
    expect((await service.read(route.sessionId)).lastSuccessful).toBeNull()
    service.clear(route.sessionId)
    service.finish(newer, true)
    expect((await service.read(route.sessionId)).lastSuccessful).toBeNull()
    async function* thrown(): AsyncIterable<StreamChunk> {
      yield usage
      throw new Error('upstream')
    }
    await expect(async () => {
      for await (const _chunk of ServingAccountModel.observe(thrown(), service, service.start(route))) {
        /* drain */
      }
    }).rejects.toThrow('upstream')
    expect(await service.read(route.sessionId)).toMatchObject({ currentAttempt: { status: 'failed' }, lastSuccessful: null })
  })
  it('excludes side purposes, native requests and unmatched main steps; uses the wire account rather than logical provider', async () => {
    const { service } = await fixture()
    const options = { sessionId: SessionId(route.sessionId), provider: 'logical-selected', model: route.model }
    const active = { ...route, provider: options.provider }
    for (const purpose of ['session-title', 'compaction'] as const) {
      expect(ServingAccountModel.startRequest(service, { ...options, purpose }, active, 'wire-account', 'codex')).toBeUndefined()
    }
    expect(ServingAccountModel.startRequest(service, options, active, 'native', undefined)).toBeUndefined()
    expect(ServingAccountModel.startRequest(service, options, undefined, 'wire-account', 'codex')).toBeUndefined()
    expect(ServingAccountModel.startRequest(service, { ...options, model: 'different' }, active, 'wire-account', 'codex')).toBeUndefined()
    expect((await service.read(route.sessionId)).currentAttempt).toBeNull()
    expect(ServingAccountModel.startRequest(service, options, active, 'wire-account', 'codex')).toMatchObject({
      accountId: 'wire-account',
      provider: 'codex',
      status: 'attempting',
    })
    expect((await service.read(route.sessionId)).lastSuccessful).toBeNull()
  })
  it('validates metadata with an explicit allowlist, never content or credentials', () => {
    const good = { ...route, startedAt: 1, updatedAt: 2, status: 'succeeded' }
    expect(successfulAccountSchema.safeParse(good).success).toBe(true)
    for (const extra of [{ messages: [] }, { token: 'not-a-secret-fixture' }, { purpose: 'title' }, { title: 'private' }]) {
      expect(successfulAccountSchema.safeParse({ ...good, ...extra }).success).toBe(false)
    }
  })
  it('bounds retained successful chats and expires old metadata on open', async () => {
    const { root, service } = await fixture()
    await drain(service, [usage, success])
    await service.close()
    services.splice(services.indexOf(service), 1)
    const reopened = await open(root, () => 1000 + SERVING_ACCOUNT_RETENTION_MS + 1)
    expect((await reopened.service.read(route.sessionId)).lastSuccessful).toBeNull()
    const entries = new Map(
      Array.from({ length: MAX_SERVING_ACCOUNT_SESSIONS + 3 }, (_, index) => {
        const sessionId = `chat-${index}`
        return [sessionId, successfulAccountSchema.parse({ ...route, sessionId, startedAt: index, updatedAt: index, status: 'succeeded' })]
      }),
    )
    expect(ServingAccountModel.pruneKeys(entries, MAX_SERVING_ACCOUNT_SESSIONS + 3)).toEqual(['chat-2', 'chat-1', 'chat-0'])
  })
})

describe('serving account access', () => {
  it('restricts agents to themselves; requires an explicit chat from UI/Host', () => {
    expect(servingAccountSessionForCaller({}, { kind: 'agent', sessionId: 'self' })).toBe('self')
    expect(() => servingAccountSessionForCaller({ sessionId: 'other' }, { kind: 'agent', sessionId: 'self' })).toThrow('own session')
    expect(() => servingAccountSessionForCaller({}, { kind: 'agent' })).toThrow('active Agent')
    expect(() => servingAccountSessionForCaller({}, { kind: 'client' })).toThrow('session ID')
    expect(servingAccountSessionForCaller({ sessionId: 'chosen' }, { kind: 'client' })).toBe('chosen')
  })
})
