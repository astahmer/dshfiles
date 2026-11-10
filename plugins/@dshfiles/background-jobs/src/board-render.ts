import type { JobBoard, JobRow } from './types.js'

/** Rows printed before the renderer summarizes the remainder; the API still returns every row. */
const MAX_LINES = 40
const MAX_LABEL = 140
const MAX_PROGRESS = 60

const elapsed = (row: JobRow, now: number): string => {
  const milliseconds = row.durationMs ?? Math.max(0, (row.finishedAt ?? now) - row.startedAt)
  if (milliseconds < 1000) return `${String(milliseconds)}ms`
  if (milliseconds < 60_000) return `${String(Math.round(milliseconds / 1000))}s`
  if (milliseconds < 3_600_000) return `${String(Math.round(milliseconds / 60_000))}m`
  return `${String(Math.round(milliseconds / 3_600_000))}h`
}

const singleLine = (text: string, maximum: number): string => {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > maximum ? `${normalized.slice(0, maximum)}…` : normalized
}

const oneRow = (row: JobRow, now: number): string => {
  const progress = row.progress === null ? '' : ` (${singleLine(row.progress, MAX_PROGRESS)})`
  const outlived = row.outlivedSince === null ? '' : ' · orphaned'
  return `${row.id} ${row.status} ${row.kind}/${row.category} ${elapsed(row, now)}${progress}${outlived} · ${singleLine(row.label, MAX_LABEL)}`
}

/**
 * Model-facing board text: a header, one line per job and a bound on the rows shown.
 *
 * The API output is the full board — up to 200 job rows, up to 200 per-Session rows, long
 * labels and spill paths — because the browser needs all of it. Sending that to the model
 * cost ~17k characters per call on average, with 202 board results above 20k characters in
 * one week. The tool renderer stays deliberately narrow: ids for follow-up calls, status,
 * elapsed time and a short label. `background_jobs_output` reads a job's detail.
 */
export const renderBoard = (board: JobBoard, now = Date.now()): string => {
  const shown = board.rows.slice(0, MAX_LINES).map(row => oneRow(row, now))
  const remaining = board.rows.length - shown.length
  if (remaining > 0) shown.push(`… ${String(remaining)} more row(s); narrow the filter or raise limit`)
  const header = `${String(board.runningCount)} running · ${String(board.finishedCount)} finished · ${String(board.total)} total${board.hasMore ? ' · more pages available' : ''}`
  const indexing = board.indexing.caughtUp
    ? ''
    : `\nindexing ${String(board.indexing.indexedFiles)}/${String(board.indexing.files)} files${board.indexing.lastError === null ? '' : ` · ${singleLine(board.indexing.lastError, MAX_LABEL)}`}`
  return [header, ...shown].join('\n') + indexing
}
