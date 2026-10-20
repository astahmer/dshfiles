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
import { FrameLog, type SessionLogFile } from './frame-log.js'
import type { DocumentRow, SearchIndex } from './index-db.js'
import { withoutUndefined } from './optional-fields.js'
import { sessionHeaderSchema, type SessionHeaderRow } from './protocol.js'
import { DocumentText } from './text.js'

export interface IngestPassResult {
  readonly scanned: number
  readonly ingested: number
  readonly documents: number
  readonly behindSessions: number
  readonly behindBytes: number
  /** False when the time budget ran out, so the caller schedules another pass immediately. */
  readonly complete: boolean
}

export interface IngestPassOptions {
  readonly index: SearchIndex
  readonly root: string
  readonly budgetMs: number
  readonly windowBytes: number
  readonly now: () => number
}

const parseEvents = (text: string, skipHeader: boolean): readonly SessionEvent[] => {
  const events: SessionEvent[] = []
  const lines = text.split('\n')
  for (const [position, line] of lines.entries()) {
    if (line.length === 0) continue
    if (skipHeader && position === 0) continue
    try {
      // SAFETY: the line is a committed session-log event; the persistence contract guarantees the shape core reads.
      events.push(JSON.parse(line) as SessionEvent)
    } catch {
      break
    }
  }
  return events
}

const fallbackHeader = (sessionId: string): SessionHeaderRow => ({ version: 4, id: sessionId, createdAt: 0, isSeeded: false })

const toHeader = (raw: unknown, sessionId: string): SessionHeaderRow => {
  const parsed = sessionHeaderSchema.safeParse(raw)
  return parsed.success ? withoutUndefined(parsed.data) : fallbackHeader(sessionId)
}

/** Read only the byte window a pass needs: the whole 69 MB log used to be read to slice it, on every pass. */
const readWindow = async (path: string, from: number, windowBytes: number): Promise<Buffer> => {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(windowBytes)
    const { bytesRead } = await handle.read(buffer, 0, windowBytes, from)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const ingestSession = async (options: IngestPassOptions & { readonly log: SessionLogFile }): Promise<number> => {
  const { index, log, windowBytes, now } = options
  const cursor = index.cursor(log.sessionId)
  const replace = cursor === undefined || cursor.dev !== log.dev || cursor.ino !== log.ino || log.size < cursor.offset
  const from = replace ? 0 : cursor.offset
  // A frame larger than the window decodes nothing; widen until one fits or the rest of the log is read.
  let size = windowBytes
  let window = await readWindow(log.path, from, size)
  let decoded = FrameLog.decodeFrom(window, 0)
  while (decoded.offset === 0 && from + size < log.size) {
    size *= 2
    window = await readWindow(log.path, from, size)
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
  let ingested = 0
  let documents = 0
  let behindSessions = 0
  let behindBytes = 0
  let complete = true
  for (const log of logs) {
    const cursor = options.index.cursor(log.sessionId)
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
    documents += await ingestSession({ ...options, log })
    ingested += 1
    // Searches queue on this thread's message port; let them run between sessions.
    await setImmediate()
  }
  return { scanned: logs.length, ingested, documents, behindSessions, behindBytes, complete }
}
