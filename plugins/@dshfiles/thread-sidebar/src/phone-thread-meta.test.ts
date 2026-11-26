import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it } from 'vitest'
import { PhoneThreadMeta } from './phone-thread-meta.js'

/** A workspace row as the Host lists it; only the fields the meta line reads matter. */
const workspace = (input: { readonly id: string; readonly path: string; readonly title: string; readonly sessionIds: readonly string[] }): WorkspaceView =>
  // SAFETY: test rows; WorkspaceId and SessionId are branded strings the resolver only compares.
  ({ workspaceId: input.id, path: input.path, title: input.title, sessionIds: input.sessionIds, createdAt: '', updatedAt: '' }) as unknown as WorkspaceView

const workspaces = [
  workspace({ id: 'w1', path: '/dev/billing-api', title: 'billing-api', sessionIds: ['s-root'] }),
  workspace({ id: 'w2', path: '/dev/billing-api-threads/thread-1', title: 'billing-api · thread-1', sessionIds: ['s-thread'] }),
]

const base = {
  workspaces,
  threadDirectories: new Map<string, string>(),
  status: undefined,
  running: false,
  subagents: 0,
  wordOf: (status: string) => ({ working: 'Working', idle: 'Idle', ready: 'Ready' })[status] ?? status,
  subagentsLabel: (count: number) => (count === 1 ? '1 subagent' : `${String(count)} subagents`),
  savedChipOf: () => undefined,
  palette: 'balanced' as const,
  coloured: true,
}

describe('phone thread meta line (council round 17 B2.2)', () => {
  it('names the project the list names, its status word and its working subagents', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], status: { status: 'working', detail: 'Waiting on 1 subagent' }, subagents: 1 })
    expect(meta).toEqual({ project: 'billing-api', mark: { palette: 'balanced' }, status: 'Working', working: true, subagents: '1 subagent' })
  })

  it('reads the project a thread workspace was cut from, and a subagent its parent\'s', () => {
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-thread'] }).project).toBe('billing-api')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-thread'] }).project).toBe('billing-api')
  })

  it('says an attention thread\'s kind, and falls back to Working or Idle without a list status', () => {
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], status: { status: 'needs-you', detail: undefined, kind: 'Approval' } }).status).toBe('Approval')
    // An attention kind is no working state: the header draws no working ring before it (council round 18 B2.3).
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], status: { status: 'needs-you', detail: undefined, kind: 'Approval' } }).working).toBe(false)
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], running: true }).status).toBe('Working')
    // Inside a thread the list is closed and publishes no status: a parent waiting on a working subagent still works.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 1 })).toMatchObject({ status: 'Working', working: true, subagents: '1 subagent' })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'] }).status).toBe('Idle')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'] }).subagents).toBeUndefined()
  })

  it('paints the mark as the row does: a saved tone or colour, the line\'s ink with project colour off, none without a project', () => {
    const saved = { ...base, savedChipOf: (path: string) => (path === '/dev/billing-api' ? { tone: 4, color: '#aa3300' } : undefined) }
    expect(PhoneThreadMeta.resolve({ ...saved, lineage: ['s-thread'] }).mark).toEqual({ tone: 4, color: '#aa3300', palette: 'balanced' })
    expect(PhoneThreadMeta.resolve({ ...saved, lineage: ['s-root'], coloured: false }).mark).toEqual({ tone: 4, color: 'currentColor', palette: 'balanced' })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['elsewhere'] })).toMatchObject({ project: undefined, mark: undefined })
  })
})
