import { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, { appendPluginRecord, pluginRecordOf, SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadModelPolicy } from '../../src/thread-model-api.ts'
import { threadModelSessionForCaller } from '../../src/thread-model-host.ts'
import { annotateThreadModel, THREAD_MODEL_RECORD, threadModelPolicyProjection } from '../../src/thread-model-policy.ts'
import { installModelSelectionProjection } from '../../src/native/model-selection-projection.ts'

const contexts = new Set<Context>()
const selected = { provider: 'account-a', model: 'model-a', reasoningEffort: ReasoningEffortId('high') }

// A different owner may append an ordinary ignorable record between selection and annotation.
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dshfiles/thread-model-tests/interleaved': { note: string }
  }
}

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

async function fixture() {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const unregisterPolicy = ctx.sessionProjections.register(threadModelPolicyProjection)
  installModelSelectionProjection(ctx)
  const session = ctx.sessions.create(SessionId('policy-source'))
  const policy = (target: Session = session) => ctx.sessionProjections.snapshot(target, ['threadModelPolicy']).values.threadModelPolicy
  return { ctx, session, policy, unregisterPolicy }
}

function grantPreference(session: Session): ThreadModelPolicy {
  const event = session.append('model/selection', selected)
  const policy = { revision: event.seq + 1, selection: selected, preferSelectedProvider: true }
  annotateThreadModel(session, policy)
  return policy
}

describe('thread model policy through public Session and projection services', () => {
  it('does not reject valid native model identifiers merely because they exceed a handoff UI length', async () => {
    const { session, policy } = await fixture()
    const longSelection = { provider: 'account-a', model: `gateway/${'x'.repeat(300)}`, reasoningEffort: ReasoningEffortId('high') }
    const event = session.append('model/selection', longSelection)
    expect(policy()).toEqual({ revision: event.seq + 1, selection: longSelection, preferSelectedProvider: false })
  })

  it('reports capability absence rather than throwing when the policy is not registered', async () => {
    const { ctx, session, unregisterPolicy } = await fixture()
    session.append('model/selection', selected)
    unregisterPolicy()
    expect(ctx.sessionProjections.stateOf(session, 'threadModelPolicy')).toBeUndefined()
    expect(ctx.sessionProjections.snapshot(session, ['threadModelPolicy']).values.threadModelPolicy).toBeUndefined()
  })

  it('starts empty, then every native selection establishes seq + 1 with preference disabled', async () => {
    const { session, policy } = await fixture()
    expect(policy()).toEqual({ revision: 0, selection: null, preferSelectedProvider: false })
    session.append('request/context', { provider: 'prior', model: 'prior' })
    const event = session.append('model/selection', selected)
    expect(policy()).toEqual({ revision: event.seq + 1, selection: selected, preferSelectedProvider: false })
    const repeated = session.append('model/selection', selected)
    expect(policy()?.revision).toBe(repeated.seq + 1)
  })

  it('does not grant preference before any native selection exists', async () => {
    const { session, policy } = await fixture()
    annotateThreadModel(session, { revision: 0, selection: null, preferSelectedProvider: true })
    expect(policy()).toEqual({ revision: 0, selection: null, preferSelectedProvider: false })
  })

  it('grants preference only through the immediately adjacent public plugin record', async () => {
    const { session, policy } = await fixture()
    const expected = grantPreference(session)
    expect(policy()).toEqual(expected)
    const record = session.snapshotEvents().at(-1)
    expect(record === undefined ? undefined : pluginRecordOf(record)).toMatchObject({
      type: THREAD_MODEL_RECORD,
      seq: expected.revision,
      data: expected,
    })
    expect(session.deriveMessages()).toEqual([])
  })

  const mismatches: Array<{ name: string; change: (policy: ThreadModelPolicy) => ThreadModelPolicy }> = [
    { name: 'provider', change: policy => ({ ...policy, selection: { ...selected, provider: 'account-b' } }) },
    { name: 'model', change: policy => ({ ...policy, selection: { ...selected, model: 'model-b' } }) },
    { name: 'effort', change: policy => ({ ...policy, selection: { ...selected, reasoningEffort: 'low' } }) },
    { name: 'omitted effort', change: policy => ({ ...policy, selection: { provider: selected.provider, model: selected.model } }) },
    { name: 'null selection', change: policy => ({ ...policy, selection: null }) },
    { name: 'older revision', change: policy => ({ ...policy, revision: policy.revision - 1 }) },
    { name: 'future revision', change: policy => ({ ...policy, revision: policy.revision + 1 }) },
  ]
  it.each(mismatches)('rejects an adjacent annotation with $name mismatch', async ({ change }) => {
    const { session, policy } = await fixture()
    const event = session.append('model/selection', selected)
    const before = policy()
    annotateThreadModel(session, change({ revision: event.seq + 1, selection: selected, preferSelectedProvider: true }))
    expect(policy()).toEqual(before)
    expect(policy()?.preferSelectedProvider).toBe(false)
  })

  it('rejects a malformed policy payload retained by the public plugin-record boundary', async () => {
    const { session, policy } = await fixture()
    const selection = session.append('model/selection', selected)
    appendPluginRecord(session, THREAD_MODEL_RECORD, { revision: -1, selection: selected, preferSelectedProvider: true })
    expect(policy()).toEqual({ revision: selection.seq + 1, selection: selected, preferSelectedProvider: false })
  })

  it('cannot replay an old annotation over a newer selection even when the selected model is identical', async () => {
    const { session, policy } = await fixture()
    const old = grantPreference(session)
    const selection = session.append('model/selection', selected)
    annotateThreadModel(session, old)
    expect(policy()).toEqual({ revision: selection.seq + 1, selection: selected, preferSelectedProvider: false })
  })

  it('rejects an annotation that adds an effort absent from the native selection', async () => {
    const { session, policy } = await fixture()
    const event = session.append('model/selection', { provider: selected.provider, model: selected.model })
    annotateThreadModel(session, { revision: event.seq + 1, selection: selected, preferSelectedProvider: true })
    expect(policy()?.preferSelectedProvider).toBe(false)
  })

  it.each(['native event', 'plugin record'] as const)('rejects an otherwise matching annotation after an interleaved %s', async interleaved => {
    const { session, policy } = await fixture()
    const event = session.append('model/selection', selected)
    if (interleaved === 'native event') session.append('request/context', { provider: 'account-b', model: 'model-b' })
    else appendPluginRecord(session, 'plugin:dshfiles/thread-model-tests/interleaved', { note: 'other owner' })
    annotateThreadModel(session, { revision: event.seq + 1, selection: selected, preferSelectedProvider: true })
    expect(policy()).toEqual({ revision: event.seq + 1, selection: selected, preferSelectedProvider: false })
  })

  it.each([selected, { provider: 'account-b', model: 'model-b' }])('request/header use of $provider does not clear durable preference', async used => {
    const { ctx, session, policy } = await fixture()
    const expected = grantPreference(session)
    session.append('request/header', { reason: 'initial', header: { config: used } })
    expect(policy()).toEqual(expected)
    expect(ctx.sessionProjections.snapshot(session, ['modelSelection']).values.modelSelection?.lastUsed).toEqual(used)
  })

  it.each([
    { name: 'normal picker (same selection)', selection: selected },
    { name: 'failover (different selection)', selection: { provider: 'account-b', model: 'model-b' } },
  ])('$name clears preference through the native selection event', async ({ selection }) => {
    const { session, policy } = await fixture()
    grantPreference(session)
    const event = session.append('model/selection', selection)
    expect(policy()).toEqual({ revision: event.seq + 1, selection, preferSelectedProvider: false })
  })

  it.each(['granted', 'request used', 'interleaved rejected', 'native selection cleared'] as const)(
    'replay and real fork seed preserve the %s state',
    async state => {
      const { ctx, session, policy } = await fixture()
      grantPreference(session)
      if (state === 'request used') session.append('request/header', { reason: 'initial', header: { config: selected } })
      if (state === 'interleaved rejected') {
        const selection = session.append('model/selection', selected)
        appendPluginRecord(session, 'plugin:dshfiles/thread-model-tests/interleaved', { note: 'other owner' })
        annotateThreadModel(session, { revision: selection.seq + 1, selection: selected, preferSelectedProvider: true })
      }
      if (state === 'native selection cleared') session.append('model/selection', { provider: 'account-b', model: 'model-b' })
      const expected = policy()
      const replay = ctx.sessions.create(SessionId('policy-replay'), { seed: session.snapshotEvents() })
      const fork = ctx.sessions.fork(session, undefined, SessionId('policy-fork'))
      expect(policy(replay)).toEqual(expected)
      expect(policy(fork)).toEqual(expected)
      expect(fork.inheritedEventCount).toBe(session.seq)
      expect(ctx.sessionProjections.snapshot(fork, ['modelSelection']).values.modelSelection).toEqual(
        ctx.sessionProjections.snapshot(session, ['modelSelection']).values.modelSelection,
      )
    },
  )
})

describe('threadModelSessionForCaller authority', () => {
  it('derives agent identity exclusively from caller scope, with optional matching input', () => {
    const caller: ApiCaller = { kind: 'agent', sessionId: 'self', cwd: '/anywhere' }
    expect(threadModelSessionForCaller({}, caller)).toBe('self')
    expect(threadModelSessionForCaller({ sessionId: 'self' }, caller)).toBe('self')
    expect(() => threadModelSessionForCaller({ sessionId: 'other' }, caller)).toThrowError(expect.objectContaining({ code: 'thread-model-forbidden' }))
  })

  it.each([{}, { sessionId: 'claimed' }])('rejects a missing agent caller identity even with input %j', input => {
    expect(() => threadModelSessionForCaller(input, { kind: 'agent', cwd: '/not-authority' })).toThrowError(
      expect.objectContaining({ code: 'thread-model-forbidden' }),
    )
  })

  it.each<ApiCaller>([{ kind: 'client' }, { kind: 'plugin', packageId: '@dshfiles/test' }])('$kind callers must explicitly name their session', caller => {
    expect(threadModelSessionForCaller({ sessionId: 'target' }, caller)).toBe('target')
    expect(() => threadModelSessionForCaller({}, caller)).toThrowError(PluginApiError)
    expect(() => threadModelSessionForCaller({}, caller)).toThrowError(expect.objectContaining({ code: 'thread-model-session-required' }))
  })
})
