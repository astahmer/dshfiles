import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createUserMessage, type LlmFailure, type Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createAccountPool } from './account-pool.js'
import { DEFAULT_RECOVERY_POLICY, type RecoveryPolicy } from './failure-policy.js'
import { classifyFailure, createFailureRecovery, offloadResentImages } from './failure-recovery.js'

const NOW = 1_000_000

const setup = (options: { readonly policy?: RecoveryPolicy; readonly lunaReserve?: boolean; readonly hidden?: readonly string[] } = {}) => {
  const pool = createAccountPool({ cooldownMs: 60_000 })
  pool.put({ id: 'codex', kind: 'codex', label: 'Codex' })
  pool.put({ id: 'codex_work', kind: 'codex', label: 'Codex Work' })
  pool.put({ id: 'codex_spare', kind: 'codex', label: 'Codex Spare' })
  pool.put({ id: 'claude', kind: 'claude', label: 'Claude' })
  const kinds = new Map([
    ['codex', 'codex'],
    ['codex_work', 'codex'],
    ['codex_spare', 'codex'],
    ['claude', 'claude'],
  ])
  const engaged: string[] = []
  let retryIds = 0
  const recovery = createFailureRecovery({
    pool,
    isAccountRoute: provider => kinds.has(provider),
    readPolicy: () => options.policy ?? DEFAULT_RECOVERY_POLICY,
    failoverCandidates: ({ from }) => [...kinds].filter(([id, kind]) => kind === kinds.get(from) && !(options.hidden ?? []).includes(id)).map(([id]) => id),
    lunaReserve: { available: id => options.lunaReserve === true && !engaged.includes(id), engage: id => engaged.push(id) },
    newRetryId: () => `retry-${String(++retryIds)}`,
  })
  const fail = (failure: LlmFailure, step = 1) =>
    recovery.recover({ conversationKey: 'session', turn: 1, step, provider: 'codex', model: 'gpt-6', failure, canShrink: false, now: NOW })
  return { pool, recovery, engaged, fail }
}

const rateLimit: LlmFailure = { message: 'Too many requests', code: 'RATE_LIMIT', status: 429 }
const transport: LlmFailure = { message: 'exceeded request buffer limit while retrying upstream', code: 'TRANSPORT' }
const quota: LlmFailure = { message: 'You have hit your usage limit', code: 'QUOTA', status: 429 }

describe('classifyFailure', () => {
  it('sorts provider failures into the kinds the settings name', () => {
    expect(classifyFailure(transport)).toBe('transport')
    expect(classifyFailure({ message: 'bad gateway', code: 'PI_AI_ERROR', status: 502 })).toBe('transport')
    expect(classifyFailure(rateLimit)).toBe('rateLimit')
    expect(classifyFailure(quota)).toBe('exhausted')
    expect(classifyFailure({ message: 'token expired', code: 'AUTH', status: 401 })).toBe('auth')
    expect(classifyFailure({ message: 'context too long', code: 'CONTEXT_WINDOW_EXCEEDED' })).toBe('oversized')
    expect(classifyFailure({ message: 'Request Entity Too Large', code: 'PI_AI_ERROR', status: 413 })).toBe('oversized')
    expect(classifyFailure({ message: 'images must be offloaded', code: 'IMAGE_OFFLOAD_REQUIRED' })).toBeUndefined()
  })
})

describe('failure recovery through the account pool', () => {
  it('moves a rate-limited conversation to the next healthy account and cools the spent one', () => {
    const { pool, recovery, fail } = setup()

    const action = fail(rateLimit)
    expect(action).toMatchObject({ kind: 'retry', account: 'codex', step: { kind: 'failover', to: 'codex_work' } })
    expect(pool.isHealthy('codex', NOW)).toBe(false)
    expect(recovery.routeFor('session', 'codex', NOW)).toBe('codex_work')
    expect(recovery.routeFor('other-session', 'codex', NOW)).toBe('codex')

    expect(fail(rateLimit)).toMatchObject({ kind: 'retry', account: 'codex_work', step: { kind: 'failover', to: 'codex_spare' } })
    expect(recovery.routeFor('session', 'codex', NOW)).toBe('codex_spare')
  })

  it('never fails over to another provider kind or a hidden account', () => {
    const { fail } = setup({ hidden: ['codex_work', 'codex_spare'] })
    expect(fail(rateLimit)).toMatchObject({ kind: 'retry', step: { kind: 'wait', delayMs: 60_000 } })
    expect(fail(rateLimit)).toEqual({ kind: 'give-up', then: 'fail', failureKind: 'rateLimit', account: 'codex' })
  })

  it('returns the conversation to its chosen account once that account cools down', () => {
    const { recovery, fail } = setup()
    fail(rateLimit)
    expect(recovery.routeFor('session', 'codex', NOW + 59_000)).toBe('codex_work')
    expect(recovery.routeFor('session', 'codex', NOW + 61_000)).toBe('codex')
  })

  it('tries Luna Reserve on the exhausted account before failing over', () => {
    const { recovery, engaged, fail } = setup({ lunaReserve: true })
    expect(fail(quota)).toMatchObject({ kind: 'retry', step: { kind: 'luna-reserve' } })
    expect(engaged).toEqual(['codex'])
    expect(recovery.routeFor('session', 'codex', NOW)).toBe('codex')
    expect(fail(quota)).toMatchObject({ kind: 'retry', step: { kind: 'failover', to: 'codex_work' } })
  })

  it('retries transport failures in place first and numbers every attempt of one step under one retry id', () => {
    const { fail } = setup()
    const first = fail(transport)
    const second = fail(transport)
    const third = fail(transport)
    expect([first, second, third].map(action => (action.kind === 'retry' ? [action.step.kind, action.attempt, action.retryId] : action.kind))).toEqual([
      ['retry', 1, 'retry-1'],
      ['retry', 2, 'retry-1'],
      ['failover', 3, 'retry-1'],
    ])
    expect(fail(transport, 2)).toMatchObject({ kind: 'retry', attempt: 1, retryId: 'retry-2', step: { kind: 'retry' } })
  })

  it('passes through routes and failures it does not own', () => {
    const { recovery } = setup()
    expect(
      recovery.recover({ conversationKey: 'session', turn: 1, step: 1, provider: 'deepseek', model: undefined, failure: rateLimit, canShrink: false }),
    ).toEqual({
      kind: 'pass',
    })
    expect(
      recovery.recover({
        conversationKey: 'session',
        turn: 1,
        step: 1,
        provider: 'codex',
        model: undefined,
        failure: { message: 'x', code: 'IMAGE_OFFLOAD_REQUIRED' },
        canShrink: false,
      }),
    ).toEqual({ kind: 'pass' })
  })

  it('keeps a shrink active for the rest of the step only', () => {
    const policy = { ...DEFAULT_RECOVERY_POLICY, oversized: { ...DEFAULT_RECOVERY_POLICY.oversized, shrink: true } }
    const { recovery } = setup({ policy })
    const failure: LlmFailure = { message: 'Request Entity Too Large', code: 'PI_AI_ERROR', status: 413 }
    expect(recovery.recover({ conversationKey: 'session', turn: 1, step: 1, provider: 'codex', model: undefined, failure, canShrink: true })).toMatchObject({
      step: { kind: 'shrink' },
    })
    expect(recovery.shrinkActive('session', 1, 1)).toBe(true)
    expect(recovery.shrinkActive('session', 1, 2)).toBe(false)
    recovery.forget('session')
    expect(recovery.shrinkActive('session', 1, 1)).toBe(false)
  })
})

describe('offloadResentImages', () => {
  const image = (attachmentId: string) => ({
    type: 'image' as const,
    attachment: { attachmentId: AttachmentId(attachmentId), mediaType: 'image/png' as const, bytes: 10, width: 1, height: 1 },
  })

  it('offloads images the model already answered and keeps the newest input whole', () => {
    const messages: readonly Message[] = [
      createUserMessage({ content: [{ type: 'text', text: 'look' }, image('old')], source: { kind: 'user' } }),
      createAssistantMessage({ content: [{ type: 'text', text: 'seen' }], source: { provider: 'codex', model: 'gpt-6' } }),
      createUserMessage({ content: [image('new')], source: { kind: 'user' } }),
    ]

    const shrunk = offloadResentImages(messages)
    expect(shrunk).not.toBe(messages)
    expect(shrunk[0]?.content[1]).toMatchObject({ type: 'image', offloaded: true })
    expect(shrunk[2]).toBe(messages[2])
    expect(offloadResentImages(shrunk)).toBe(shrunk)
  })
})
