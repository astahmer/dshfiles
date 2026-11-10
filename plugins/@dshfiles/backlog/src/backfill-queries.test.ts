import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, test } from 'vitest'

import type { BacklogBackfillResult } from './api.js'
import { backfillStatusQueries } from './backfill-queries.js'

const job = (state: BacklogBackfillResult['state']): BacklogBackfillResult => ({
  retriage: false,
  jobId: 'job-1',
  configured: true,
  reason: null,
  state,
  total: 10,
  completed: state === 'completed' ? 10 : 3,
  applied: 2,
  proposed: 1,
  unchanged: 0,
  failed: 0,
  remaining: 7,
})

describe('backfill status polling', () => {
  test('follows a queued or running job every second and stops once it settles', () => {
    expect(backfillStatusQueries.pollInterval({ status: 'success', data: job('queued') })).toBe(1_000)
    expect(backfillStatusQueries.pollInterval({ status: 'success', data: job('running') })).toBe(1_000)
    expect(backfillStatusQueries.pollInterval({ status: 'success', data: job('completed') })).toBe(false)
    expect(backfillStatusQueries.pollInterval({ status: 'success', data: job('failed') })).toBe(false)
  })

  test('backs off after a failed read and stops for a job the Host no longer holds', () => {
    expect(backfillStatusQueries.pollInterval({ status: 'error', data: job('running') })).toBe(5_000)
    expect(backfillStatusQueries.pollInterval({ status: 'success', data: null })).toBe(false)
    expect(backfillStatusQueries.pollInterval({ status: 'pending', data: undefined })).toBe(false)
  })

  test('keys the status per job and seeds that key from the start answer', () => {
    expect(backfillStatusQueries.key('job-1')).not.toEqual(backfillStatusQueries.key('job-2'))
    expect(backfillStatusQueries.key(null)).toContain('backfill-status')
    const client = new QueryClient()
    try {
      const key = backfillStatusQueries.key('job-1')
      client.setQueryData(key, job('queued'))
      expect(client.getQueryData<BacklogBackfillResult>(key)?.state).toBe('queued')
    } finally {
      client.clear()
    }
  })
})
