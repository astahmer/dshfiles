import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { createCleanupJobRunner } from './cleanup-jobs.js'
import { SettleCleanupModel, settledStatusSchema } from './settle-cleanup.js'
import { defaultJjIntegrationSettings } from './settings.js'

const repository = {
  repoRoot: '/repo',
  threads: [
    { name: 'landed', sessionIds: ['a'], unlanded: [], rebasedAt: 10 },
    { name: 'never-landed', sessionIds: ['b'], unlanded: [] },
    { name: 'has-work', sessionIds: ['c'], unlanded: ['rev'], rebasedAt: 10 },
    { name: 'shared', sessionIds: ['d', 'e'], unlanded: [], rebasedAt: 10 },
    { name: 'shared-archived', sessionIds: ['f', 'g'], unlanded: [], rebasedAt: 10 },
    { name: 'untouched', sessionIds: ['h'], unlanded: [], rebasedAt: 10 },
  ],
}

describe('SettleCleanupModel', () => {
  it('is off by default so existing settle behavior keeps every workspace', () => {
    expect(defaultJjIntegrationSettings.autoCleanup.onSettle).toBe(false)
  })

  it('reads settled ids from the thread-sidebar document and tolerates other shapes', () => {
    expect(settledStatusSchema.parse({ settledSessionIds: ['a'], other: 1 }).settledSessionIds).toEqual(['a'])
    expect(settledStatusSchema.parse(undefined).settledSessionIds).toEqual([])
    expect(settledStatusSchema.parse({ settledSessionIds: 'nope' }).settledSessionIds).toEqual([])
  })

  it('reports only ids that were not settled before', () => {
    expect(SettleCleanupModel.newlySettled({ previous: ['a'], next: ['a', 'b'] })).toEqual(['b'])
    expect(SettleCleanupModel.newlySettled({ previous: ['a', 'b'], next: ['a'] })).toEqual([])
  })

  it('targets workspaces the settle finished and never ones with unlanded work, live threads or excluded kinds', () => {
    const targets = SettleCleanupModel.targets({
      repositories: [repository],
      justSettled: ['a', 'b', 'c', 'd', 'g'],
      settled: new Set(['a', 'b', 'c', 'd', 'g', 'h']),
      archived: new Set(['f']),
      kinds: ['empty', 'integrated'],
    })
    expect(targets).toEqual([
      { repoRoot: '/repo', name: 'landed', kind: 'integrated' },
      { repoRoot: '/repo', name: 'never-landed', kind: 'empty' },
      { repoRoot: '/repo', name: 'shared-archived', kind: 'integrated' },
    ])
    expect(
      SettleCleanupModel.targets({
        repositories: [repository],
        justSettled: ['a', 'b'],
        settled: new Set(['a', 'b']),
        archived: new Set(),
        kinds: ['integrated'],
      }),
    ).toEqual([{ repoRoot: '/repo', name: 'landed', kind: 'integrated' }])
  })

  it('sends targets through the shared runner as an automatic job', async () => {
    const requests: unknown[] = []
    const runner = createCleanupJobRunner({
      execute: async ({ request }) => {
        requests.push(request)
        return { applied: true, workspaces: [], skipped: [], untracked: [], emptyRevisions: [] }
      },
    })
    const targets = [{ repoRoot: '/repo', name: 'landed', kind: 'integrated' as const }]
    await runner.start({ path: null, olderThanHours: 0, kinds: ['integrated'], targets, trigger: 'automatic' }).done
    expect(requests).toEqual([{ path: null, olderThanHours: 0, kinds: ['integrated'], targets, trigger: 'automatic' }])
  })

  it('records a settle cleanup span with settled, targeted and removed counts', async () => {
    using recorder = recordSpans()
    const removed = await SettleCleanupModel.run({
      justSettled: ['a'],
      settled: ['a'],
      kinds: ['integrated'],
      repositories: async () => [repository],
      archived: () => new Set(),
      remove: async targets => ({
        applied: true,
        workspaces: targets.map(target => ({
          repoRoot: target.repoRoot,
          name: target.name,
          path: `/t/${target.name}`,
          kind: 'integrated',
          lastUsedAt: 0,
          missing: false,
          outcome: 'removed',
        })),
        skipped: [],
        untracked: [],
        emptyRevisions: [],
      }),
    })
    expect(removed).toBe(1)
    const span = recorder.span('jj-integration settle cleanup')
    expect(span.attributes['dshx.cleanup.settled']).toBe(1)
    expect(span.attributes['dshx.cleanup.targets']).toBe(1)
    expect(span.attributes['dshx.cleanup.removed']).toBe(1)
  })
})
