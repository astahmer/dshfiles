import { it } from '@effect/vitest'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import type { JobEvent } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Effect } from 'effect'
import { describe, expect } from 'vitest'
import { killJob } from './kill-job.js'
import { JobsBoard } from './service.js'

const emptyHistory = {
  historyRows: [],
  indexing: { active: false, caughtUp: true, files: 0, indexedFiles: 0, historyRows: 0, lastIndexedAt: null, lastError: null },
  sessionOf: () => null,
}

const runningJob: JobView = {
  id: JobId('bash-now'),
  kind: 'bash',
  label: 'pnpm test',
  owner: SessionId('session-aaaa'),
  status: 'running',
  startedAt: 1_000,
  output: { total: 0, earliest: 0 },
}

const boardWithFailingKill = () => {
  const board = new JobsBoard({ history: emptyHistory })
  let emit: (event: JobEvent) => void = () => undefined
  board.attachLive({
    events: {
      subscribe: (_filter: { readonly owners: 'all' }, next: (event: JobEvent) => void) => {
        emit = next
        return () => undefined
      },
    },
    readAt: () => ({ chunks: [], next: 0, lossy: false }),
    kill: () => {
      throw new Error('registry refused the kill')
    },
  })
  emit({ type: 'registered', job: runningJob })
  return board
}

describe('killJob', () => {
  it.effect('reports an unknown job as JobNotFound', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(killJob({ board: new JobsBoard({ history: emptyHistory }), jobId: 'missing' }))
      expect(failure._tag).toBe('JobNotFound')
    }),
  )

  it.effect('keeps a failing kill of a retained job distinct from JobNotFound', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(killJob({ board: boardWithFailingKill(), jobId: 'bash-now' }))
      expect(failure._tag).toBe('JobKillFailed')
    }),
  )
})
