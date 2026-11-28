import { formatDurationMs } from '@dshfiles/plugin-ui/lib/format-duration'
import * as Schema from 'effect/Schema'
import type { AttributeValue } from './types.js'

const formatDuration = (milliseconds: number | null): string => (milliseconds === null ? '—' : formatDurationMs(milliseconds))

const formatPercent = (fraction: number): string =>
  fraction === 0 ? '0%' : fraction < 0.001 ? '<0.1%' : `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`

const formatClock = (unixMs: number, now: number = Date.now()): string => {
  const date = new Date(unixMs)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

const formatAttribute = (value: AttributeValue): string => (typeof value === 'string' ? value : JSON.stringify(value))

// A service is an identity (DESIGN.md › Colour roles): the eight identity tones, never chart, info or accent hues.
const SERVICE_TONES = [
  { background: 'dshx:bg-identity-1', fill: 'dshx:fill-identity-1' },
  { background: 'dshx:bg-identity-2', fill: 'dshx:fill-identity-2' },
  { background: 'dshx:bg-identity-3', fill: 'dshx:fill-identity-3' },
  { background: 'dshx:bg-identity-4', fill: 'dshx:fill-identity-4' },
  { background: 'dshx:bg-identity-5', fill: 'dshx:fill-identity-5' },
  { background: 'dshx:bg-identity-6', fill: 'dshx:fill-identity-6' },
  { background: 'dshx:bg-identity-7', fill: 'dshx:fill-identity-7' },
  { background: 'dshx:bg-identity-8', fill: 'dshx:fill-identity-8' },
] as const

const toneOf = (service: string): (typeof SERVICE_TONES)[number] => {
  let hash = 0
  for (const character of service) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return SERVICE_TONES[hash % SERVICE_TONES.length] ?? SERVICE_TONES[0]
}

/** A stable tone per service name, so one service keeps its color across traces and reloads. */
const serviceTone = (service: string): string => toneOf(service).background

/** The same tone as an SVG fill. */
const serviceFill = (service: string): string => toneOf(service).fill

/** List-price USD: cents for a dollar or more, three significant digits below it, so a $0.0004 call is not "$0.00". */
const formatUsd = (usd: number | null | undefined): string => {
  if (usd === null || usd === undefined) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toPrecision(3).replace(/\.?0+$/, '')}`
}

/** The `dshx.cost.usd` agent telemetry put on a span, or null. */
const costSchema = Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0))

const spanCostUsd = (attributes: Readonly<Record<string, AttributeValue>>): number | null => {
  const result = Schema.decodeUnknownResult(costSchema)(attributes['dshx.cost.usd'])
  return result._tag === 'Success' ? result.success : null
}

export class TraceFormat {
  static readonly usd = formatUsd
  static readonly spanCostUsd = spanCostUsd
  static readonly duration = formatDuration
  static readonly percent = formatPercent
  static readonly clock = formatClock
  static readonly attribute = formatAttribute
  static readonly serviceTone = serviceTone
  static readonly serviceFill = serviceFill
}
