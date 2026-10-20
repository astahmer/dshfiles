import { describe, expect, it } from 'vitest'

import { JobSelectionModel } from './job-selection.js'
import type { JobRow } from './types.js'

const row = (input: { readonly id: string; readonly status: JobRow['status'] }): JobRow => ({
  id: input.id,
  kind: 'bash',
  label: `job ${input.id}`,
  owner: 'session-1',
  status: input.status,
  progress: null,
  detail: null,
  startedAt: 1,
  finishedAt: null,
  durationMs: null,
  category: 'tests',
  live: true,
  outputTotal: 0,
  spillPaths: [],
})

describe('job selection', () => {
  it('keeps only running and stopping rows, in board order', () => {
    expect(
      JobSelectionModel.stoppableIds([
        row({ id: 'a', status: 'running' }),
        row({ id: 'b', status: 'completed' }),
        row({ id: 'c', status: 'stopping' }),
        row({ id: 'd', status: 'failed' }),
      ]),
    ).toEqual(['a', 'c'])
  })

  it('reports requested, already-finished and failed kills separately', async () => {
    const outcome = await JobSelectionModel.stop({
      ids: ['a', 'b', 'c'],
      kill: async jobId => {
        if (jobId === 'b') throw new Error('owner fence refused')
        return { jobId, outcome: jobId === 'a' ? 'requested' : 'already-finished' }
      },
    })
    expect(outcome).toEqual({ requested: ['a'], skipped: ['c'], failed: ['b'] })
  })

  it('does nothing for an empty selection', async () => {
    await expect(JobSelectionModel.stop({ ids: [], kill: async jobId => ({ jobId, outcome: 'requested' }) })).resolves.toEqual({
      requested: [],
      skipped: [],
      failed: [],
    })
  })
})
