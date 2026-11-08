/**
 * Resumable ingest. Each pass walks the session-log root, compares each log's cursor with the indexed one, and decodes
 * only the frames the log gained. Work is bounded by a small byte window and a time budget so the worker stays
 * responsive to searches between passes, and every session commits on its own, so an interrupted pass resumes instead
 * of restarting the corpus.
 */
import { open } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { buildSessionEventSearchDocuments, extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { FrameLog, type SessionLogFile } from './frame-log.js'
import type { DocumentRow, SearchIndex, SessionCursor } from './index-db.js'
import { withoutUndefined } from './optional-fields.js'
import { sessionHeaderSchema, type SessionHeaderRow } from './protocol.js'
import { DocumentText } from './text.js'

export interface IngestPassResult {
  readonly scanned: number
  readonly ingested: number
  readonly documents: number
  readonly behindSessions: number
  readonly behindBytes: number
  /** Archived Sessions whose documents were dropped: archived history is cold and not kept in the index. */
  readonly pruned: number
  /** False when the time budget ran out, so the caller schedules another pass immediately. */
  readonly complete: boolean
}

export interface IngestPassOptions {
  readonly index: SearchIndex
  readonly root: string
  readonly budgetMs: number
  readonly windowBytes: number
  readonly now: () => number
  /** Sessions the user archived: cold history, dropped from the index and indexed again only when asked for by id. */
  readonly archived?: ReadonlySet<string>
}

const GROUP_SESSIONS = 64
const GROUP_MS = 250

/**
 * Every committed Session event already wakes the loop (the Host nudges it), so the idle poll only catches logs written
 * behind the Host's back. A pass that finds nothing doubles the next wait up to a minute; a wake starts over at 5 s.
 * On 2,800 Sessions an idle pass costs ~35 ms of CPU, so a fixed 5 s poll was a permanent tax for no fresher results.
 */
export class IdleBackoff {
  static readonly first = Duration.seconds(5)
  static readonly longest = Duration.seconds(60)

  /** The wait after `idlePasses` consecutive passes that found nothing to index. */
  static after(idlePasses: number): Duration.Duration {
    return Duration.min(Duration.times(IdleBackoff.first, 2 ** Math.max(0, Math.min(idlePasses - 1, 4))), IdleBackoff.longest)
  }
}

const parseEvents = (text: string, skipHeader: boolean): readonly SessionEvent[] => {
  const events: SessionEvent[] = []
  const lines = text.split('\n')
  for (const [position, line] of lines.entries()) {
    if (line.length === 0) continue
    if (skipHeader && position === 0) continue
    try {
      // SAFETY: the line is a committed session-log event; the persistence contract guarantees the shape core reads.
      events.push(decodeJson(jsonValueSchema, line) as SessionEvent)
    } catch {
      break
    }
  }
  return events
}

const fallbackHeader = (sessionId: string): SessionHeaderRow => ({ version: 4, id: sessionId, createdAt: 0, isSeeded: false })

const toHeader = (raw: unknown, sessionId: string): SessionHeaderRow => {
  const parsed = Schema.decodeUnknownOption(sessionHeaderSchema)(raw)
  return Option.isSome(parsed) ? withoutUndefined(parsed.value) : fallbackHeader(sessionId)
}

/**
 * Read only the byte window a pass needs: the whole 69 MB log used to be read to slice it, on every pass. The buffer is
 * sized to what the file still holds, not to the window: zero-filling a 2 MiB buffer per small log was 13 % of a first
 * build's CPU.
 */
const readWindow = async (path: string, from: number, windowBytes: number, fileSize: number): Promise<Buffer> => {
  const length = Math.max(0, Math.min(windowBytes, fileSize - from))
  if (length === 0) return Buffer.alloc(0)
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const ingestSession = async (options: IngestPassOptions & { readonly log: SessionLogFile; readonly cursor: SessionCursor | undefined }): Promise<number> => {
  const { index, log, cursor, windowBytes, now } = options
  const replace = cursor === undefined || cursor.dev !== log.dev || cursor.ino !== log.ino || log.size < cursor.offset
  const from = replace ? 0 : cursor.offset
  // A frame larger than the window decodes nothing; widen until one fits or the rest of the log is read.
  let size = windowBytes
  let window = await readWindow(log.path, from, size, log.size)
  let decoded = FrameLog.decodeFrom(window, 0)
  while (decoded.offset === 0 && from + size < log.size) {
    size *= 2
    window = await readWindow(log.path, from, size, log.size)
    decoded = FrameLog.decodeFrom(window, 0)
  }
  const events = parseEvents(decoded.text, replace)
  const rows: DocumentRow[] = []
  if (events.length > 0) {
    // Core's builder folds the whole event list to classify surfaces, so it can only run on a session's full history.
    // An appended batch is indexed with the current surface instead; the next full pass (a rewritten or replaced log)
    // restores exact surface classification.
    const documents =
      events.length > 0 && replace
        ? buildSessionEventSearchDocuments(SessionId(log.sessionId), events).map(document => ({ ...document, sessionId: log.sessionId }))
        : events.flatMap(event => {
            const text = extractSessionEventText(event)
            return text.length === 0 ? [] : [{ sessionId: log.sessionId, seq: event.seq, type: event.type, time: event.time, surface: 'current', text }]
          })
    for (const document of documents) {
      const bounded = DocumentText.truncate(DocumentText.sanitize(document.text), DocumentText.capFor(document.type))
      rows.push({
        sessionId: document.sessionId,
        seq: document.seq,
        type: document.type,
        time: document.time,
        surface: document.surface,
        text: bounded.text,
        truncated: bounded.truncated,
      })
    }
  }
  const header = await FrameLog.readHeader(log.path)
  index.commitBatch({
    header: toHeader(header, log.sessionId),
    cursor: { logPath: log.path, dev: log.dev, ino: log.ino, offset: from + decoded.offset, size: log.size, mtimeNs: log.mtimeNs },
    documents: rows,
    replace,
    now: now(),
  })
  return rows.length
}

export const runIngestPass = async (options: IngestPassOptions): Promise<IngestPassResult> => {
  const startedAt = options.now()
  const logs = await FrameLog.list(options.root)
  const cursors = options.index.cursors()
  let ingested = 0
  let documents = 0
  let behindSessions = 0
  let behindBytes = 0
  let pruned = 0
  let complete = true
  // Sessions commit in groups of up to GROUP_SESSIONS or GROUP_MS; searches still run between sessions inside a group.
  let grouped = 0
  let groupStartedAt = 0
  try {
    for (const log of logs) {
      if (options.archived?.has(log.sessionId) === true) {
        // Cold by the user's own decision: keep no documents for it, and index it again only for a targeted search.
        if (cursors.has(log.sessionId)) {
          options.index.forget(log.sessionId)
          pruned += 1
        }
        continue
      }
      const cursor = cursors.get(log.sessionId)
      const unchanged =
        cursor !== undefined &&
        cursor.dev === log.dev &&
        cursor.ino === log.ino &&
        cursor.size === log.size &&
        cursor.mtimeNs === log.mtimeNs &&
        cursor.offset >= log.size
      if (unchanged) continue
      behindSessions += 1
      behindBytes += Math.max(0, log.size - (cursor?.offset ?? 0))
      if (!complete) continue
      if (options.now() - startedAt >= options.budgetMs && ingested > 0) {
        complete = false
        continue
      }
      if (grouped === 0) {
        options.index.beginGroup()
        groupStartedAt = options.now()
      }
      documents += await ingestSession({ ...options, log, cursor })
      ingested += 1
      grouped += 1
      if (grouped >= GROUP_SESSIONS || options.now() - groupStartedAt >= GROUP_MS) {
        options.index.commitGroup()
        grouped = 0
      }
      // Searches queue on this thread's message port; let them run between sessions.
      await setImmediate()
    }
    options.index.commitGroup()
  } catch (error) {
    options.index.rollbackGroup()
    throw error
  }
  return { scanned: logs.length, ingested, documents, behindSessions, behindBytes, pruned, complete }
}

/**
 * Index exactly the Sessions a caller asked about, even archived ones. A targeted search is the slow path back into cold
 * history, so it pays for the read instead of the whole corpus staying indexed.
 */
export const indexSessions = async (options: IngestPassOptions, sessionIds: readonly string[]): Promise<number> => {
  const wanted = new Set(sessionIds.filter(sessionId => options.index.cursor(sessionId) === undefined))
  if (wanted.size === 0) return 0
  const logs = await FrameLog.list(options.root)
  let documents = 0
  for (const log of logs) {
    if (!wanted.delete(log.sessionId)) continue
    documents += await ingestSession({ ...options, log, cursor: undefined })
    if (wanted.size === 0) break
  }
  return documents
}
