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

describe('a subagent\'s phone header (round 21 D3)', () => {
  const deepseek = { provider: 'dshx_fake_commandcode', model: 'deepseek/deepseek-v4-flash' }
  const child = { parentTitle: 'Audit money rounding', label: 'Check credit note rounding', route: deepseek }

  it('puts the model where the project was, names its parent for Back, and takes its call\'s name as the title', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], running: true, child })
    expect(meta).toEqual({
      project: undefined,
      mark: undefined,
      route: deepseek,
      status: 'Working',
      working: true,
      subagents: undefined,
      parent: { id: 's-root', title: 'Audit money rounding' },
      title: 'Check credit note rounding',
    })
  })

  it('keeps the project without a known model, today\'s title without a name, and Threads without a parent title', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], child: { parentTitle: ' ', label: '', route: undefined } })
    expect(meta).toMatchObject({ project: 'billing-api', status: 'Idle' })
    expect(meta.route).toBeUndefined()
    expect(meta.parent).toBeUndefined()
    expect(meta.title).toBeUndefined()
  })

  it('says Turn failed for a child whose last turn failed, where it read Idle (round 21 D4)', () => {
    const failed = { ...child, terminal: 'failed' as const, failedLabel: 'Turn failed' }
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], child: failed })).toMatchObject({ status: 'Turn failed', working: false })
    // A child the user stopped, or one that finished, keeps today's word.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], child: { ...failed, terminal: 'stopped' } }).status).toBe('Idle')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], child: { ...failed, terminal: 'completed' } }).status).toBe('Idle')
    // A new turn works again; the list's own status still wins when it publishes one.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], running: true, child: failed }).status).toBe('Working')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], status: { status: 'needs-you', detail: undefined, kind: 'Approval' }, child: failed }).status).toBe('Approval')
  })

  it('ignores child facts on a root thread', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], child })
    expect(meta).toEqual({ project: 'billing-api', mark: { palette: 'balanced' }, status: 'Idle', working: false, subagents: undefined })
  })
})
