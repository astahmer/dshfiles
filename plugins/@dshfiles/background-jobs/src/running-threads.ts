/**
 * Which threads run a background job now. A turn can end while its job keeps running, so a thread list that wants to
 * show such a thread as working reads this on an interval (docs/ade-ux §4.7). Published as the
 * `@dshfiles/background-jobs/running-threads` dshx module: the reader depends on background-jobs, never the reverse
 * (docs/plugin-boundaries.md), and binds the contract with `useApi(backgroundJobsApi)`.
 */
import { backgroundJobsApi } from './api.js'

export { backgroundJobsApi }

interface RunningBoard {
  readonly rows: readonly { readonly owner: string | null }[]
}

/** The one method this module calls, so a test or a Host-side caller can hand it any client of the contract. */
interface RunningBoardReader {
  board(input: { readonly scope: 'running'; readonly limit: number }, options?: { readonly signal?: AbortSignal }): Promise<RunningBoard>
}

export class RunningThreads {
  /** The Query key the Processes page already polls; share it so one request serves every reader. */
  static readonly queryKey = ['dshfiles-background-jobs', 'running-owners'] as const

  /** More running jobs than this on one host is not a thread-list concern; the board pages beyond it. */
  static readonly limit = 200

  /** The owners of the board's running rows, each once, in board order (newest activity first). */
  static readonly ownersOf = (board: RunningBoard): readonly string[] => [...new Set(board.rows.flatMap(row => (row.owner === null ? [] : [row.owner])))]

  /** Thread ids that own at least one running background job. */
  static readonly read = async (api: RunningBoardReader, signal?: AbortSignal): Promise<readonly string[]> =>
    RunningThreads.ownersOf(await api.board({ scope: 'running', limit: RunningThreads.limit }, signal === undefined ? undefined : { signal }))
}
