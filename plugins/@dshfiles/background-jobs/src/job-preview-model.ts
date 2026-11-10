import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from '@deepseek-ai/dsh-api-job-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One job's live output tail as the client `jobs` service accumulates it. */
export interface ObservedJobOutput {
  readonly text: string
  readonly gapBefore: boolean
  readonly error?: string
}

/**
 * The part of the client `jobs` service (`@deepseek-ai/dsh-api-job-controller/client`) the preview reads. Stated here
 * because that package's Client and Host both declare `Context.jobs`, and this plugin's one tsconfig compiles both
 * halves: importing the client type would retype the Host registry that live.ts reads.
 */
export interface JobsClient {
  readonly state: {
    getSnapshot(): {
      readonly rows: Readonly<Record<string, readonly JobView[]>>
      readonly observed: Readonly<Record<string, ObservedJobOutput>>
    }
    subscribe(listener: () => void): () => void
  }
  watchRows(sessionId: SessionId): () => void
  observe(sessionId: SessionId | undefined, id: JobId): () => void
}

/**
 * What the transcript's job preview shows of one job. Its status is the registry's lifecycle, worded as on the Jobs
 * board; a subagent is not a job and has its own vocabulary in @dshfiles/thread-sidebar.
 */
export interface JobPreviewView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly owner: string | undefined
  readonly status: JobView['status']
  readonly progress: string | undefined
  readonly detail: string | undefined
  readonly startedAt: number
  readonly finishedAt: number | undefined
}

/** Tools whose results may name a job; any other tool's text can merely quote one, and must not grow a preview. */
const JOB_STARTING_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh', 'workflow'])

/**
 * The wording of each native result that hands a job over: `bash`/`pwsh` with run_in_background, the same tools
 * promoted past their timeout (after the partial output, so the last match is the real one), and `workflow`.
 */
const JOB_REFERENCE = /(?:^started background job |; moved to background job |started in the background as job )([a-z][a-z0-9-]*-[0-9a-f]+)\b/g

const SAME_FIELDS = ['id', 'kind', 'label', 'owner', 'status', 'progress', 'detail', 'startedAt', 'finishedAt'] as const

export const JobPreviewModel = {
  /** The job a settled tool call started, if it started one. */
  jobIdOfResult(input: { readonly toolName: string; readonly text: string }): string | undefined {
    if (!JOB_STARTING_TOOLS.has(input.toolName)) return undefined
    return [...input.text.matchAll(JOB_REFERENCE)].at(-1)?.[1]
  },

  viewOf(row: JobView): JobPreviewView {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      owner: row.owner,
      status: row.status,
      progress: row.progress,
      detail: row.detail,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    }
  },

  /** Output offsets move on every chunk and every roster frame builds new rows; only these fields change the card. */
  sameView(left: JobPreviewView | undefined, right: JobPreviewView | undefined): boolean {
    if (left === undefined || right === undefined) return left === right
    return SAME_FIELDS.every(field => left[field] === right[field])
  },

  isLive(status: JobView['status']): boolean {
    return status === 'running' || status === 'stopping'
  },

  /** `42s`, `3m 5s`, `2h 10m`. */
  formatElapsed(milliseconds: number): string {
    const seconds = Math.max(0, Math.round(milliseconds / 1000))
    if (seconds < 60) return `${String(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`
    return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
  },
}
