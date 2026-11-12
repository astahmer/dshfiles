import type { JobView } from '@deepseek-ai/dsh-api-job-controller/types'
import type { RunFoldKind, RunFoldMemberState, RunFoldStatus } from '@dshfiles/chat/run-folds'
import { SquareTerminalIcon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { JobPreviewModel, type JobsClient } from './job-preview-model.js'
import type { BackgroundJobsTranslate } from './locales.js'

/** The job lifecycle on the transcript's status vocabulary; only a failed job is a problem that stays out of a fold. */
const STATUS = {
  running: 'working',
  stopping: 'working',
  completed: 'done',
  killed: 'stopped',
  failed: 'failed',
} as const satisfies Record<JobView['status'], RunFoldStatus>

const SEPARATOR = '\n'

/** The registry settles a command that exited non-zero as `completed` with `exit code: N` in its detail. */
const EXIT_CODE = /exit code: (-?\d+)/

/** A job's fold status: its lifecycle, with a non-zero exit counted as the failure it is. */
export const jobFoldStatus = (row: Pick<JobView, 'status' | 'detail'>): RunFoldStatus => {
  const code = row.status === 'completed' ? EXIT_CODE.exec(row.detail ?? '')?.[1] : undefined
  return code !== undefined && code !== '0' ? 'failed' : STATUS[row.status]
}

const jobIdOf = (call: { readonly toolName: string; readonly resultText: string | undefined }): string | undefined =>
  call.resultText === undefined ? undefined : JobPreviewModel.jobIdOfResult({ toolName: call.toolName, text: call.resultText })

const signatureOf = (states: readonly RunFoldMemberState[]): string =>
  states.map(state => `${state.status}:${String(state.startedAt)}:${String(state.finishedAt)}`).join('|')

/**
 * Background-job tool calls as a transcript fold kind (b:7rv2): Chat folds two or more consecutive job starts into
 * "3 background jobs · 2 running · 1 done · longest 4m 10s". Each job keeps its own card under the fold.
 */
export const jobRunFold = (input: { readonly jobs: JobsClient; readonly t: BackgroundJobsTranslate }): RunFoldKind => {
  const { jobs, t } = input
  const subscribe = (listener: () => void): (() => void) => jobs.state.subscribe(listener)
  return {
    id: '@dshfiles/background-jobs/job',
    order: 0,
    Icon: SquareTerminalIcon,
    claims: call => call.phase === 'result' && !call.isError && jobIdOf(call) !== undefined,
    useStates: ({ sessionId, calls }) => {
      useEffect(() => jobs.watchRows(sessionId), [sessionId])
      const ids = useMemo(() => calls.map(call => jobIdOf(call) ?? '').join(SEPARATOR), [calls])
      const last = useRef<{ readonly signature: string; readonly states: readonly RunFoldMemberState[] } | undefined>(undefined)
      const read = useCallback((): readonly RunFoldMemberState[] => {
        const rows = jobs.state.getSnapshot().rows[sessionId] ?? []
        const states = ids.split(SEPARATOR).map((id): RunFoldMemberState => {
          const row = rows.find(candidate => candidate.id === id)
          // A job the registry no longer holds (an earlier DSH process, or retention) has settled.
          if (row === undefined) return { status: 'done' }
          const live: RunFoldMemberState = { status: jobFoldStatus(row), startedAt: row.startedAt }
          return row.finishedAt === undefined ? live : { ...live, finishedAt: row.finishedAt }
        })
        const signature = signatureOf(states)
        if (last.current?.signature === signature) return last.current.states
        last.current = { signature, states }
        return states
      }, [ids, sessionId])
      return useSyncExternalStore(subscribe, read)
    },
    useText: () => ({ count: count => t(count === 1 ? 'foldCountOne' : 'foldCountOther', { count }), active: t('foldActive'), done: t('foldDone') }),
  }
}
