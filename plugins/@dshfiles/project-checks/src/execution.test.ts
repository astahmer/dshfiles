import { describe, expect, it } from 'vitest'
import { remoteHostSchema, type ExecutionPolicy, type RemoteHost } from './core.js'
import { ExecutionModel, type ExecutionSelection, type RemoteEndpointState } from './execution.js'

const remote = (id: string, priority = 1): RemoteHost =>
  remoteHostSchema.parse({ id, sshTarget: `host-${id}`, gitRemote: id, workspace: `/work/${id}`, priority })

const policy = (patch: Partial<ExecutionPolicy>): ExecutionPolicy => ({ target: 'local', onRemoteFailure: 'local', ...patch })

const selection = (patch: Partial<ExecutionSelection> & { readonly states?: ReadonlyMap<string, RemoteEndpointState> }): ExecutionSelection => ({
  policy: policy({}),
  remotes: [],
  localMemoryFloorMb: 4_096,
  freeMemoryMb: 16_384,
  now: 1_000,
  states: new Map(),
  ...patch,
})

const state = (inFlight: number, coolingDownUntil = 0): RemoteEndpointState => ({ inFlight, coolingDownUntil })

describe('project check execution policy', () => {
  it('keeps local-only actions local', () => {
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'local' }), remotes: [remote('m1')] }))).toEqual({
      endpoint: { kind: 'local' },
      reason: 'local-target',
    })
  })

  it('picks the highest-priority enabled remote and skips cooling remotes', () => {
    const remotes = [remote('slow', 5), remote('fast', 1), remote('off', 1)]
    remotes[2] = remoteHostSchema.parse({ ...remotes[2], enabled: false })
    const states = new Map([['fast', state(0, 2_000)]])
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'remote' }), remotes, states }))).toEqual({
      endpoint: { kind: 'remote', remote: remotes[0] },
      reason: 'remote-target',
    })
  })

  it('honours an explicit remote pin even while it cools down', () => {
    const pinned = remote('m1', 9)
    const states = new Map([['m1', state(3, 9_999)]])
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'remote', remote: 'm1' }), remotes: [pinned], states }))).toEqual({
      endpoint: { kind: 'remote', remote: pinned },
      reason: 'remote-target',
    })
  })

  it('falls back to a local decision when no remote is available', () => {
    const states = new Map([['m1', state(0, 9_999)]])
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'remote' }), remotes: [remote('m1')], states }))).toEqual({
      endpoint: { kind: 'local' },
      reason: 'remote-unavailable',
    })
  })

  it('balances auto work onto the least busy endpoint and prefers a peer on a tie', () => {
    const remotes = [remote('m1'), remote('m2')]
    const tied = ExecutionModel.choose(selection({ policy: policy({ target: 'auto' }), remotes }))
    expect(tied.endpoint).toEqual({ kind: 'remote', remote: remotes[0] })

    const idleLocal = new Map([
      ['m1', state(2)],
      ['m2', state(1)],
    ])
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'auto' }), remotes, states: idleLocal })).endpoint).toEqual({ kind: 'local' })

    const busyLocal = new Map([
      ['m1', state(0)],
      ['m2', state(1)],
      ['local', state(5)],
    ])
    expect(ExecutionModel.choose(selection({ policy: policy({ target: 'auto' }), remotes, states: busyLocal })).endpoint).toEqual({
      kind: 'remote',
      remote: remotes[0],
    })
  })

  it('keeps the local endpoint out of auto while memory is below the floor, but never blocks', () => {
    const lowMemory = selection({ policy: policy({ target: 'auto' }), remotes: [], freeMemoryMb: 512 })
    expect(ExecutionModel.choose(lowMemory)).toEqual({ endpoint: { kind: 'local' }, reason: 'local-floor' })

    const peerOnly = selection({ policy: policy({ target: 'auto' }), remotes: [remote('m1')], freeMemoryMb: 512 })
    expect(ExecutionModel.choose(peerOnly).endpoint).toEqual({ kind: 'remote', remote: remote('m1') })
  })

  it('plans the receipt fields a failed remote attempt leaves behind', () => {
    const fallback = ExecutionModel.planRemoteFailure({
      policy: policy({ onRemoteFailure: 'local' }),
      remoteId: 'm1',
      code: 'peer-unreachable',
      message: 'x'.repeat(300),
    })
    expect(fallback.decision).toBe('fallback-local')
    expect(fallback.failure).toBeNull()
    expect(fallback.remoteFailure).toEqual({ remoteId: 'm1', code: 'peer-unreachable', message: 'x'.repeat(240) })

    const hard = ExecutionModel.planRemoteFailure({ policy: policy({ onRemoteFailure: 'fail' }), remoteId: 'm1', code: 'peer-timeout', message: 'slow' })
    expect(hard.decision).toBe('fail')
    expect(hard.failure).toBe('remote-failed')

    const cancelled = ExecutionModel.planRemoteFailure({ policy: policy({}), remoteId: 'm1', code: 'peer-cancelled', message: 'stop' })
    expect(cancelled.decision).toBe('cancelled')
    expect(cancelled.failure).toBeNull()
  })

  it('turns remote trouble into a local fallback unless the action fails hard', () => {
    expect(ExecutionModel.decideRemoteFailure({ policy: policy({ onRemoteFailure: 'local' }), code: 'peer-unreachable' })).toBe('fallback-local')
    expect(ExecutionModel.decideRemoteFailure({ policy: policy({ onRemoteFailure: 'fail' }), code: 'peer-unreachable' })).toBe('fail')
    expect(ExecutionModel.decideRemoteFailure({ policy: policy({ onRemoteFailure: 'local' }), code: 'peer-cancelled' })).toBe('cancelled')
  })
})
