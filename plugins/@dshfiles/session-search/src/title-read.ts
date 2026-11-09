/**
 * Bounded title reads for the `sessionQuery` backend. Core folds a title by decoding the Session's whole event log,
 * four at a time: on a cold corpus that is up to 4 × 86 MB of transient events for an answer its first and last bytes
 * hold. A title is the text of the newest `session/title` event, and a Session writes its title in its first appends,
 * so a head window holds the event while the projection cache holds the title the log ends with. Nothing here decodes
 * a whole log to find a title, and every bounded read answers `undefined` when it cannot prove its answer, so the
 * caller keeps the whole-log fold.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { foldSessionTitle, type SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import { HEAD_WINDOW_BYTES, MIN_TAIL_BYTES, openLogHead, recentLogEvents, TailLog, type LogHead, type LogWindowMetrics } from '@dshfiles/session-log-window'

/** The bytes a title read reads at most from the end of a log to prove which title the log currently ends with. */
const PROOF_WINDOW_BYTES = 64_000

/** How much further the head window grows when a Session's first appends are larger than the default window. */
const HEAD_WINDOW_GROWTHS = 1

/** Whole-file read for a log small enough that decoding it costs less than proving it boundedly; `readFileHead` clamps. */
const WHOLE_LOG_BYTES = Number.MAX_SAFE_INTEGER

/** What a bounded read found for one Session: the header it read, and the title when the log has one. */
export interface BoundedTitleSnapshot {
  readonly session: SessionHeader
  readonly title?: SessionTitleSnapshot
}

const isTitleEvent = (event: SessionEvent): boolean => event.type === 'session/title'

/** The newest title event in the supplied events, as the snapshot core's own fold would produce. */
const titleOf = (events: readonly SessionEvent[]): SessionTitleSnapshot | undefined => foldSessionTitle(events)

/**
 * The title the projection cache already folded for this lifecycle, or `undefined`: the same zero-I/O listing hint the
 * Session list serves, which is possibly stale but never wrong and never from an unrelated log. Its watermark is an
 * event seq of this lifecycle, so it can be compared with the log's own.
 */
const cachedTitle = (ctx: Context, header: SessionHeader): { readonly title: string; readonly asOfSeq: number } | undefined => {
  const cache = ctx.get('sessionProjectionCache')
  if (cache === undefined) return undefined
  const block = cache.cachedSnapshot(header, ['title']) ?? cache.cachedPredecessorTitle(header)
  const title = block?.values.title
  if (typeof title !== 'string' || title.length === 0 || block === undefined) return undefined
  return { title, asOfSeq: block.asOfSeq }
}

/**
 * The first window of one log, grown once when it holds no title event and the cache could still prove one: a Session
 * whose first turn writes more than the default window still gets its title from its own bytes.
 */
const readHead = async (input: { readonly ctx: Context; readonly sessionId: SessionId; readonly signal: AbortSignal }, metrics: LogWindowMetrics) => {
  let head: LogHead | undefined = await openLogHead({ ...input, metrics })
  for (let growth = 0; growth < HEAD_WINDOW_GROWTHS; growth += 1) {
    if (head === undefined || head.reachesLogEnd || titleOf(head.events) !== undefined) return head
    if (cachedTitle(input.ctx, head.header) === undefined) return head
    const wider: LogHead | undefined = await openLogHead({ ...input, metrics }, HEAD_WINDOW_BYTES * 4 ** (growth + 1))
    if (wider === undefined) return head
    head = wider
  }
  return head
}

/**
 * The latest title of one stored Session, read from bounded windows of its log.
 * @param input - the Host context, the stored Session, and cancellation.
 * @returns the header and title the log ends with, `{ session }` when the log holds no title event, or `undefined`
 *   when only the full-log fold can answer exactly.
 */
export const readBoundedTitle = async (input: {
  readonly ctx: Context
  readonly sessionId: SessionId
  readonly signal: AbortSignal
}): Promise<BoundedTitleSnapshot | undefined> => {
  const metrics: LogWindowMetrics = {}
  let head = await readHead(input, metrics)
  if (head === undefined) return undefined
  if (!head.reachesLogEnd && head.sizeBytes <= MIN_TAIL_BYTES) {
    const whole: LogHead | undefined = await openLogHead({ ...input, metrics }, WHOLE_LOG_BYTES)
    if (whole !== undefined && whole.reachesLogEnd) head = whole
  }
  if (head.reachesLogEnd) return { session: head.header, ...withTitle(titleOf(head.events)) }

  const headTitle = titleOf(head.events)
  const hint = cachedTitle(input.ctx, head.header)
  if (headTitle !== undefined && hint?.title === headTitle.title && (await checkpointCoversLogEnd(input, hint.asOfSeq))) {
    return { session: head.header, title: headTitle }
  }

  // A Session renamed later carries a newer title event near the end of its log; the newest window holds it, and a log
  // the window decodes completely needs no checkpoint to prove it.
  const recent = await recentLogEvents({ ...input, metrics, matches: isTitleEvent, keep: 1 })
  if (recent === undefined) return undefined
  const latest = recent.events.at(-1)
  if (latest === undefined) return recent.complete ? { session: head.header } : undefined
  const snapshot = titleOf([latest])
  return snapshot === undefined ? undefined : { session: head.header, title: snapshot }
}

/**
 * Whether the cache's title row folded through the last event of the log, which is what makes its title the current
 * one. The row's watermark is an event seq of this lifecycle, and the newest window's last event is the log's end.
 */
const checkpointCoversLogEnd = async (
  input: { readonly ctx: Context; readonly sessionId: SessionId; readonly signal: AbortSignal },
  asOfSeq: number,
): Promise<boolean> => {
  const last = await TailLog.open({ ...input, metrics: {}, retain: false, windowBytes: PROOF_WINDOW_BYTES })
  if (last === undefined) return false
  last.before(1)
  return last.last?.seq === asOfSeq
}

const withTitle = (title: SessionTitleSnapshot | undefined): { readonly title?: SessionTitleSnapshot } => (title === undefined ? {} : { title })

/** The title a live Session's own events fold to; its log is never read because the events are already here. */
export const readLiveTitle = (session: Session): BoundedTitleSnapshot => ({
  session: structuredClone(session.header),
  ...withTitle(foldSessionTitle(session.snapshotEvents())),
})
