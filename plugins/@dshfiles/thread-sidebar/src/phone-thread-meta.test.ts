import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it } from 'vitest'
import { threadSidebarDictionaries } from './locales.js'
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
  countWords: { working: (count: number) => `${String(count)} working`, failed: (count: number) => `${String(count)} failed` },
  savedChipOf: () => undefined,
  palette: 'balanced' as const,
  coloured: true,
}

describe('phone thread meta line (council round 17 B2.2)', () => {
  it('names the project the list names, its status word and its working subagents', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], status: { status: 'working', detail: 'Waiting on 1 subagent' }, subagents: 1 })
    // The count says it works, so the Working word and its ring go (round 22 follow-up): `BA billing-api · 1 working`.
    expect(meta).toEqual({ project: 'billing-api', mark: { palette: 'balanced' }, status: undefined, working: false, children: [{ key: 'working', count: 1, text: '1 working', tone: 'plain' }] })
  })

  it('leaves out the Working word only where the count says the thread works (round 22 follow-up)', () => {
    // `BA · 6 working · ✕ 1 failed`, not `Working · 6 working · ✕ 1 failed`.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], running: true, subagents: 6, failedSubagents: 1 })).toMatchObject({ status: undefined, working: false })
    // Working with no child working keeps its word and ring, a failed child or not.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], running: true })).toMatchObject({ status: 'Working', working: true })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], running: true, failedSubagents: 1 })).toMatchObject({ status: 'Working', working: true })
    // A word the count does not say stays: an attention kind, Turn failed, Ready, Idle.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 2, status: { status: 'needs-you', detail: undefined, kind: 'Approval' } }).status).toBe('Approval')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 2, status: { status: 'failed', detail: undefined, kind: 'Turn failed' } }).status).toBe('Turn failed')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 2, status: { status: 'ready', detail: undefined } }).status).toBe('Ready')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], failedSubagents: 2 }).status).toBe('Idle')
    // A child with children of its own reads the same way after its model.
    const child = { parentTitle: 'Audit money rounding', label: 'Check credit note rounding', route: { provider: 'p', model: 'm' } }
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['child', 's-root'], running: true, subagents: 1, child })).toMatchObject({ status: undefined, working: false })
  })

  it('counts its children in the one formula, failed ones in the failed tone (round 22 items 2 and 3)', () => {
    const meta = PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 6, failedSubagents: 1 })
    expect(meta.children).toEqual([
      { key: 'working', count: 6, text: '6 working', tone: 'plain' },
      { key: 'failed', count: 1, text: '1 failed', tone: 'failed' },
    ])
    // A failed child alone does not make the thread work; a zero part is left out.
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], failedSubagents: 2 })).toMatchObject({
      status: 'Idle',
      children: [{ key: 'failed', count: 2, text: '2 failed', tone: 'failed' }],
    })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'] }).children).toEqual([])
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
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'], subagents: 1 })).toMatchObject({ status: undefined, working: false, children: [{ text: '1 working' }] })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'] }).status).toBe('Idle')
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['s-root'] }).children).toEqual([])
  })

  it('paints the mark as the row does: a saved tone or colour, the line\'s ink with project colour off, none without a project', () => {
    const saved = { ...base, savedChipOf: (path: string) => (path === '/dev/billing-api' ? { tone: 4, color: '#aa3300' } : undefined) }
    expect(PhoneThreadMeta.resolve({ ...saved, lineage: ['s-thread'] }).mark).toEqual({ tone: 4, color: '#aa3300', palette: 'balanced' })
    expect(PhoneThreadMeta.resolve({ ...saved, lineage: ['s-root'], coloured: false }).mark).toEqual({ tone: 4, color: 'currentColor', palette: 'balanced' })
    expect(PhoneThreadMeta.resolve({ ...base, lineage: ['elsewhere'] })).toMatchObject({ project: undefined, mark: undefined })
  })
})

describe('the count formula\'s words (round 22 items 2 and 3)', () => {
  it('says `N working` and `N failed` in both languages', () => {
    expect(threadSidebarDictionaries.en.threadSidebarWorkingCount).toBe('{count} working')
    expect(threadSidebarDictionaries.en.threadSidebarFailedCount).toBe('{count} failed')
    expect(threadSidebarDictionaries.zh.threadSidebarFailedCount).toBe('{count} 个失败')
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
      children: [],
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
    expect(meta).toEqual({ project: 'billing-api', mark: { palette: 'balanced' }, status: 'Idle', working: false, children: [] })
  })
})
