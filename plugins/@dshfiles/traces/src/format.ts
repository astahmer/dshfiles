import type { AttributeValue } from './types.js'

const formatDuration = (milliseconds: number | null): string => {
  if (milliseconds === null) return '—'
  if (milliseconds < 1) return `${String(Math.round(milliseconds * 1000))} µs`
  if (milliseconds < 1_000)
    return `${milliseconds < 10 ? milliseconds.toFixed(2) : milliseconds < 100 ? milliseconds.toFixed(1) : Math.round(milliseconds).toString()} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(2)} s`
  return `${Math.floor(milliseconds / 60_000).toString()} m ${Math.round((milliseconds % 60_000) / 1_000).toString()} s`
}

const formatPercent = (fraction: number): string =>
  fraction === 0 ? '0%' : fraction < 0.001 ? '<0.1%' : `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`

const formatClock = (unixMs: number, now: number = Date.now()): string => {
  const date = new Date(unixMs)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

const formatAttribute = (value: AttributeValue): string => (typeof value === 'string' ? value : JSON.stringify(value))

const SERVICE_TONES = [
  'dshx:bg-chart-1',
  'dshx:bg-chart-2',
  'dshx:bg-chart-3',
  'dshx:bg-info',
  'dshx:bg-chart-5',
  'dshx:bg-primary',
  'dshx:bg-chart-1/55',
  'dshx:bg-chart-2/55',
  'dshx:bg-chart-3/55',
  'dshx:bg-info/55',
] as const

/** A stable tone per service name, so one service keeps its color across traces and reloads. */
const serviceTone = (service: string): string => {
  let hash = 0
  for (const character of service) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return SERVICE_TONES[hash % SERVICE_TONES.length] ?? SERVICE_TONES[0]
}

/** Five evenly spaced labels from 0 to the trace duration for the waterfall's time axis. */
const axisTicks = (durationMs: number): readonly { readonly fraction: number; readonly label: string }[] =>
  [0, 0.25, 0.5, 0.75, 1].map(fraction => ({ fraction, label: formatDuration(durationMs * fraction) }))

export type CollapsibleRow = { readonly spanId: string; readonly depth: number }

/** Rows still shown when the spans in `collapsed` hide their descendants; rows arrive in depth-first order. */
const visibleRows = <Row extends CollapsibleRow>(rows: readonly Row[], collapsed: ReadonlySet<string>): Row[] => {
  const shown: Row[] = []
  let hiddenBelowDepth: number | null = null
  for (const row of rows) {
    if (hiddenBelowDepth !== null && row.depth > hiddenBelowDepth) continue
    hiddenBelowDepth = collapsed.has(row.spanId) ? row.depth : null
    shown.push(row)
  }
  return shown
}

export class TraceFormat {
  static readonly duration = formatDuration
  static readonly percent = formatPercent
  static readonly clock = formatClock
  static readonly attribute = formatAttribute
  static readonly serviceTone = serviceTone
  static readonly axisTicks = axisTicks
  static readonly visibleRows = visibleRows
}
