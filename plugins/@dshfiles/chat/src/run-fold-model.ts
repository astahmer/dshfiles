/**
 * The pure half of transcript run folds (b:7rv2): which rows form a run, which members stay outside the fold, and the
 * summary row's words. React and providers stay out, so every rule here is unit-tested.
 */
import type { RunFoldMemberState, RunFoldStatus, RunFoldText } from './run-folds.ts'

/** One run of consecutive rows a fold kind claimed: rows `start` up to (not including) `end`. */
export interface RunFoldSpan {
  readonly start: number
  readonly end: number
}

/** A run folds only from this many rows; a single row stays exactly as it is. */
export const RUN_FOLD_MINIMUM = 2

/**
 * Split a row list into fold runs.
 * @param kinds - per row, the claiming kind id, or undefined for a row no kind claims (it breaks a run).
 * @param enabled - false in Verbose, where every row stays open.
 * @returns runs of at least two consecutive claimed rows, in order; mixed kinds share one run.
 */
const partition = (kinds: readonly (string | undefined)[], enabled: boolean): readonly RunFoldSpan[] => {
  if (!enabled) return []
  const runs: RunFoldSpan[] = []
  let start = -1
  const close = (end: number): void => {
    if (start !== -1 && end - start >= RUN_FOLD_MINIMUM) runs.push({ start, end })
    start = -1
  }
  kinds.forEach((kind, index) => {
    if (kind === undefined) close(index)
    else if (start === -1) start = index
  })
  close(kinds.length)
  return runs
}

/** Problems never fold: a failed member or one waiting on the user keeps its own row. */
const isProblem = (status: RunFoldStatus): boolean => status === 'failed' || status === 'needs-you'

/** Whether a member's row is hidden: only while its run is collapsed, and never for a problem. */
const memberHidden = (input: { readonly expanded: boolean; readonly problem: boolean }): boolean => !input.expanded && !input.problem

export interface RunFoldCounts {
  readonly total: number
  readonly working: number
  readonly done: number
  readonly stopped: number
  readonly failed: number
  readonly needsYou: number
}

const count = (states: readonly RunFoldMemberState[]): RunFoldCounts => {
  const of = (status: RunFoldStatus): number => states.filter(state => state.status === status).length
  return { total: states.length, working: of('working'), done: of('done'), stopped: of('stopped'), failed: of('failed'), needsYou: of('needs-you') }
}

/** The summary's glyph: a problem outranks work in progress, which outranks a settled run. */
const glyph = (counts: RunFoldCounts): RunFoldStatus =>
  counts.failed > 0 ? 'failed' : counts.needsYou > 0 ? 'needs-you' : counts.working > 0 ? 'working' : counts.stopped === counts.total ? 'stopped' : 'done'

/** One kind's share of a run. */
export interface RunFoldGroup {
  readonly text: RunFoldText
  readonly states: readonly RunFoldMemberState[]
}

/** Chat's own words for the states every kind shares. */
export interface RunFoldWords {
  readonly stopped: string
  readonly failed: string
  readonly needsYou: string
}

/** A clause of the summary; `tone` colours only the two problem states (DESIGN.md: colour for Needs you and Failed). */
export interface RunFoldPart {
  readonly text: string
  readonly tone: 'plain' | 'needs-you' | 'failed'
}

const plain = (text: string): RunFoldPart => ({ text, tone: 'plain' })

/**
 * The summary row's clauses, joined with " · " by the row.
 * One kind: "3 background jobs · 1 failed · 2 running · 1 done". Several kinds: each kind's live and settled counts
 * named with its noun ("2 background jobs running · 1 subagent working · 1 subagent finished"), so no count is
 * ambiguous; with a problem, the totals and the problem lead. Needs you and Failed always follow the count, so a narrow
 * row truncates the routine clauses and never a problem.
 */
const summary = (groups: readonly RunFoldGroup[], words: RunFoldWords): readonly RunFoldPart[] => {
  const all = count(groups.flatMap(group => group.states))
  // Problems come right after the count so a narrow row truncates the routine clauses, never a failure.
  const problems: RunFoldPart[] = []
  if (all.needsYou > 0) problems.push({ text: `${String(all.needsYou)} ${words.needsYou}`, tone: 'needs-you' })
  if (all.failed > 0) problems.push({ text: `${String(all.failed)} ${words.failed}`, tone: 'failed' })
  const rest: RunFoldPart[] = []
  const single = groups.length === 1 ? groups[0] : undefined
  if (single !== undefined) {
    if (all.working > 0) rest.push(plain(`${String(all.working)} ${single.text.active}`))
    if (all.done > 0) rest.push(plain(`${String(all.done)} ${single.text.done}`))
    if (all.stopped > 0) rest.push(plain(`${String(all.stopped)} ${words.stopped}`))
    return [plain(single.text.count(all.total)), ...problems, ...rest]
  }
  for (const group of groups) {
    const own = count(group.states)
    if (own.working > 0) rest.push(plain(`${group.text.count(own.working)} ${group.text.active}`))
    if (own.done > 0) rest.push(plain(`${group.text.count(own.done)} ${group.text.done}`))
  }
  if (all.stopped > 0) rest.push(plain(`${String(all.stopped)} ${words.stopped}`))
  const totals = groups.map(group => plain(group.text.count(group.states.length)))
  return problems.length > 0 || rest.length === 0 ? [...totals, ...problems, ...rest] : rest
}

/**
 * What the "longest" clause measures: the earliest start among working members (it ticks), else the longest finished
 * span (static), else nothing.
 */
const longest = (
  states: readonly RunFoldMemberState[],
): { readonly kind: 'live'; readonly since: number } | { readonly kind: 'settled'; readonly ms: number } | undefined => {
  const starts = states.flatMap(state => (state.status === 'working' && state.startedAt !== undefined ? [state.startedAt] : []))
  if (starts.length > 0) return { kind: 'live', since: Math.min(...starts) }
  const spans = states.flatMap(state => (state.startedAt !== undefined && state.finishedAt !== undefined ? [state.finishedAt - state.startedAt] : []))
  return spans.length > 0 ? { kind: 'settled', ms: Math.max(...spans) } : undefined
}

export const RunFoldModel = {
  minimum: RUN_FOLD_MINIMUM,
  partition,
  isProblem,
  memberHidden,
  count,
  glyph,
  summary,
  longest,
} as const
