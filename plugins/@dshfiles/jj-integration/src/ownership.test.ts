import { describe, expect, it } from 'vitest'
import { decideToolCall, type WorkspaceOwnershipView } from './ownership.js'

const READ_ONLY = ['read', 'grep', 'jj_workspace_list']
const base = { now: 1_000_000, staleAfterMs: 60_000, readOnlyTools: READ_ONLY }

const view = (overrides: Partial<WorkspaceOwnershipView> = {}): WorkspaceOwnershipView => ({
  workspaceName: 'agent-1',
  isolated: true,
  unsafe: false,
  writerEpoch: 1,
  writerLease: { sessionId: 'session-a', epoch: 1, heartbeatAt: base.now },
  observers: [],
  ...overrides,
})

const decide = (query: Partial<Parameters<typeof decideToolCall>[0]> & { toolName: string; sessionId: string }) =>
  decideToolCall({ workspace: view(), heldEpoch: null, ...base, ...query })

describe('exclusive writer decisions', () => {
  it('lets the lease holder write and read', () => {
    expect(decide({ sessionId: 'session-a', toolName: 'bash' })).toEqual({ kind: 'allow' })
    expect(decide({ sessionId: 'session-a', toolName: 'read' })).toEqual({ kind: 'allow' })
  })

  it('lets the first caller take a free workspace', () => {
    expect(decide({ sessionId: 'session-b', toolName: 'bash', workspace: view({ writerLease: null }) })).toEqual({ kind: 'acquire', reclaim: false })
  })

  it('refuses a second live writer and names the contention', () => {
    const decision = decide({ sessionId: 'session-b', toolName: 'write' })
    expect(decision.kind).toBe('deny')
    expect(decision).toMatchObject({ code: 'writer-held' })
  })

  it('fences a session whose lease was superseded by a transfer', () => {
    const decision = decide({ sessionId: 'session-a', toolName: 'write', heldEpoch: 1, workspace: view({ writerEpoch: 3, writerLease: { sessionId: 'session-b', epoch: 3, heartbeatAt: base.now } }) })
    expect(decision).toMatchObject({ kind: 'deny', code: 'writer-fenced' })
  })

  it('reclaims a stale lease instead of blocking forever', () => {
    const decision = decide({ sessionId: 'session-b', toolName: 'write', workspace: view({ writerLease: { sessionId: 'session-a', epoch: 1, heartbeatAt: base.now - 120_000 } }) })
    expect(decision).toEqual({ kind: 'acquire', reclaim: true })
  })

  it('allows read-only tools for a registered observer only', () => {
    expect(decide({ sessionId: 'session-c', toolName: 'read', workspace: view({ observers: ['session-c'] }) })).toEqual({ kind: 'allow' })
    expect(decide({ sessionId: 'session-c', toolName: 'bash', workspace: view({ observers: ['session-c'] }) })).toMatchObject({ kind: 'deny', code: 'writer-held' })
    expect(decide({ sessionId: 'session-d', toolName: 'read' })).toMatchObject({ kind: 'deny', code: 'writer-held' })
  })

  it('never enforces ownership on a discovered workspace', () => {
    expect(decide({ sessionId: 'session-z', toolName: 'bash', workspace: view({ isolated: false }) })).toEqual({ kind: 'allow' })
  })

  it('quarantines a folded workspace to read-only tools', () => {
    expect(decide({ sessionId: 'session-z', toolName: 'read', workspace: view({ unsafe: true, isolated: false }) })).toEqual({ kind: 'allow' })
    expect(decide({ sessionId: 'session-z', toolName: 'bash', workspace: view({ unsafe: true, isolated: false }) })).toMatchObject({ kind: 'deny', code: 'unsafe-workspace' })
  })
})
