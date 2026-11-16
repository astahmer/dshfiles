import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import type { HmrFrame } from './frames.js'
/**
 * Which live code swaps the page can take, and which it cannot.
 *
 * The stock renderer installs the `session` slot scope from `@deepseek-ai/dsh-client-ui-session`. Replacing that
 * package, or any package it injects (the Session Controller that provides `sessions`, the slot renderer...), disposes
 * the scope adapter while React still renders the conversation; the renderer then throws `SlotAssemblyError` past
 * every error boundary and the page goes blank. A swap there cannot be made safe from a plugin, so the gate does not
 * attempt it: it reloads the page at a moment that loses nothing instead. Every other package keeps its live swap.
 */

/** The packages that install slot scopes; their injection closure must not be swapped live. */
export const SCOPE_OWNERS = ['@deepseek-ai/dsh-client-ui-session'] as const

/**
 * The graph names contracts, not who implements them: ui-session injects the `dsh-api-session-controller` contract
 * row, while this profile's `sessions` service comes from the `@dshfiles/session-controller` fork (and from the stock
 * client controller where the fork is off). Each contract row maps to the packages that may provide its service.
 */
export const CONTRACT_PROVIDERS = new Map<string, readonly string[]>([
  ['@deepseek-ai/dsh-api-session-controller', ['@dshfiles/session-controller', '@deepseek-ai/dsh-client-session-controller']],
])

/** The page's module table as the guard reads it. */
export interface GuardState {
  readonly rows: readonly GuardRow[]
  readonly release: string | undefined
}

type GraphFrame = Extract<HmrFrame, { readonly type: 'graph' }>

/** One row of the page's module table: its id, revision and the package rows it injects. */
export interface GuardRow {
  readonly id: string
  readonly rev: string
  readonly inject: readonly string[]
}

/** The scope owners and every package they inject, transitively, read from the current module table. */
function unsafeIds(rows: readonly GuardRow[]): ReadonlySet<string> {
  const byId = new Map(rows.map(row => [row.id, row]))
  const unsafe = new Set<string>()
  const visit = (id: string): void => {
    if (unsafe.has(id)) return
    unsafe.add(id)
    for (const next of byId.get(id)?.inject ?? []) visit(next)
    for (const provider of CONTRACT_PROVIDERS.get(id) ?? []) if (byId.has(provider)) visit(provider)
  }
  for (const owner of SCOPE_OWNERS) if (byId.has(owner)) visit(owner)
  return unsafe
}

const graphSchema = Schema.Struct({
  release: Schema.optional(Schema.Struct({ version: Schema.String })),
  entries: Schema.Array(Schema.Struct({ id: Schema.String, rev: Schema.String, inject: Schema.optional(Schema.Array(Schema.String)) })),
})
const decodeGraph = Schema.decodeUnknownOption(graphSchema)

/** The rows and release of a Host graph frame, or undefined when it is not a graph this guard can read. */
function readGraph(frame: GraphFrame): { readonly rows: GuardRow[]; readonly release: string | undefined } | undefined {
  return Option.getOrUndefined(
    Option.map(decodeGraph(frame.graph), graph => ({
      release: graph.release?.version,
      rows: graph.entries.map(entry => ({ id: entry.id, rev: entry.rev, inject: entry.inject ?? [] })),
    })),
  )
}

/** Whether swapping one rebuilt package live would blank the page. */
function rebuiltNeedsReload(current: readonly GuardRow[], id: string): boolean {
  return unsafeIds(current).has(id)
}

/**
 * Whether reconciling a Host graph live would replace, add or drop an unsafe package. A graph of another release is
 * left to the stock release gate, which pauses updates and announces it.
 */
function graphNeedsReload(current: GuardState, frame: GraphFrame): boolean {
  const read = readGraph(frame)
  if (read === undefined || read.release !== current.release) return false
  const next = read.rows
  const unsafe = new Set([...unsafeIds(current.rows), ...unsafeIds(next)])
  const before = new Map(current.rows.map(row => [row.id, row.rev]))
  const after = new Map(next.map(row => [row.id, row.rev]))
  for (const id of unsafe) if (before.get(id) !== after.get(id)) return true
  return false
}

/** The packages a Host graph adds, drops or replaces; empty for an unreadable graph or one of another release. */
function graphChanges(current: GuardState, frame: GraphFrame): readonly string[] {
  const read = readGraph(frame)
  if (read === undefined || read.release !== current.release) return []
  const before = new Map(current.rows.map(row => [row.id, row.rev]))
  const after = new Map(read.rows.map(row => [row.id, row.rev]))
  return [...new Set([...before.keys(), ...after.keys()])].filter(id => before.get(id) !== after.get(id))
}

/** Live-swap safety for HMR frames. */
export class SwapGuard {
  static readonly unsafeIds = unsafeIds
  static readonly rebuiltNeedsReload = rebuiltNeedsReload
  static readonly graphNeedsReload = graphNeedsReload
  static readonly graphChanges = graphChanges
}

interface QuietPage {
  readonly hidden: () => boolean
  /** True while the user is typing in a field, so a reload now would cost a keystroke or a draft. */
  readonly editing: () => boolean
  readonly onSettle: (listener: () => void) => () => void
  readonly reload: () => void
}

/**
 * Reload once the page can afford it: right away when it is hidden or nobody is typing, otherwise at the next blur of
 * the field or the next time the tab is hidden. Several requests share one reload.
 */
export function createQuietReload(page: QuietPage): () => void {
  let pending = false
  let stop: (() => void) | undefined
  const attempt = (): void => {
    if (!page.hidden() && page.editing()) return
    stop?.()
    stop = undefined
    page.reload()
  }
  return () => {
    if (pending) return
    pending = true
    stop = page.onSettle(attempt)
    attempt()
  }
}
