import type { CorpusResult } from './self-improve-corpus.ts'
import { SessionMiner, type SessionFacts, type Signal, type TokenTotals } from './self-improve-mine.ts'

/**
 * The weekly evidence review: two windows of the same corpus, compared.
 *
 * `mine` answers "what recurs?" over one window. A review answers the question a
 * recurring improvement process actually needs — "what got worse, what got
 * better, and what is still worth one change this week?" — by normalising the
 * vitals per turn, classifying every signal against its previous-window count,
 * and naming the small set worth investigating next.
 *
 * It reads Session logs only. Cost, provider billing and live trace spans are
 * deliberately out of scope: the caveats say so instead of implying coverage.
 */

export interface ReviewWindow {
  readonly from: number
  readonly to: number
  /** Sessions whose log mtime falls inside this window. */
  readonly sessions: number
  readonly projects: number
  readonly unreadable: number
}

export interface ToolRow {
  readonly name: string
  readonly calls: number
  readonly errors: number
  readonly slowCalls: number
  readonly totalMs: number
}

export interface Vitals {
  readonly sessions: number
  readonly projects: number
  readonly turns: number
  readonly toolCalls: number
  readonly toolErrors: number
  readonly corrections: number
  readonly compactions: number
  readonly skillLoads: number
  readonly peerMessages: number
  readonly tokens: TokenTotals
  readonly abnormalTurnEnds: Readonly<Record<string, number>>
  readonly jjFailures: number
  readonly jobFailures: number
  readonly providerRetries: number
  readonly tools: readonly ToolRow[]
  readonly errorsByTool: readonly ToolRow[]
  readonly slowTools: readonly ToolRow[]
}

export type SignalChange = 'new' | 'worse' | 'better' | 'steady'

export interface SignalDelta {
  readonly id: string
  readonly kind: string
  readonly category: string
  readonly title: string
  readonly change: SignalChange
  readonly previousHits: number
  readonly currentHits: number
  readonly previousSessions: number
  readonly currentSessions: number
  readonly score: number
  readonly recurring: boolean
}

export interface ReviewCandidate {
  readonly delta: SignalDelta
  readonly hint: string
  readonly evidence: Signal['evidence']
  readonly sessionIds: readonly string[]
  /** Status of an existing ledger entry for this signal key, when one is tracked. */
  readonly ledgerStatus: string | null
}

export interface ReviewReport {
  readonly generatedAt: number
  readonly since: string
  readonly windowDays: number
  readonly current: ReviewWindow
  readonly previous: ReviewWindow
  readonly currentVitals: Vitals
  readonly previousVitals: Vitals
  readonly deltas: readonly SignalDelta[]
  readonly candidates: readonly ReviewCandidate[]
  readonly caveats: readonly string[]
  readonly notes: readonly string[]
}

export interface ReviewInput {
  readonly now: number
  readonly since: string
  readonly current: CorpusResult
  readonly previous: CorpusResult
  readonly currentWindow: { readonly from: number; readonly to: number }
  readonly previousWindow: { readonly from: number; readonly to: number }
  readonly ledger: readonly { readonly key: string; readonly status: string }[]
  readonly top: number
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const toolRows = (facts: readonly SessionFacts[]): readonly ToolRow[] => {
  const rows = new Map<string, { calls: number; errors: number; slowCalls: number; totalMs: number }>()
  for (const session of facts) {
    for (const stat of Object.values(session.toolStats)) {
      const row = rows.get(stat.name) ?? { calls: 0, errors: 0, slowCalls: 0, totalMs: 0 }
      row.calls += stat.count
      row.slowCalls += stat.slowCount
      row.totalMs += stat.totalMs
      rows.set(stat.name, row)
    }
    for (const error of session.toolErrors) {
      const row = rows.get(error.name) ?? { calls: 0, errors: 0, slowCalls: 0, totalMs: 0 }
      row.errors += error.count
      rows.set(error.name, row)
    }
  }
  return [...rows.entries()].map(([name, row]) => ({ name, ...row }))
}

const vitalsOf = (facts: readonly SessionFacts[]): Vitals => {
  const tools = toolRows(facts)
  const abnormalTurnEnds: Record<string, number> = {}
  for (const session of facts) {
    for (const [reason, count] of Object.entries(session.turnEnds)) {
      if (reason === 'completed' || reason === 'stop' || reason === 'unknown') continue
      abnormalTurnEnds[reason] = (abnormalTurnEnds[reason] ?? 0) + count
    }
  }
  return {
    sessions: facts.length,
    projects: new Set(facts.map(session => session.project)).size,
    turns: sum(facts.map(session => session.turns)),
    toolCalls: sum(facts.map(session => session.toolCallCount)),
    toolErrors: sum(facts.map(session => session.toolErrorCount)),
    corrections: sum(facts.map(session => session.corrections)),
    compactions: sum(facts.map(session => session.compactions)),
    skillLoads: sum(facts.map(session => sum(Object.values(session.skillLoads)))),
    peerMessages: sum(facts.map(session => session.peerMessages)),
    tokens: {
      input: sum(facts.map(session => session.tokens.input)),
      cacheRead: sum(facts.map(session => session.tokens.cacheRead)),
      output: sum(facts.map(session => session.tokens.output)),
    },
    abnormalTurnEnds,
    jjFailures: sum(facts.map(session => sum(session.jjFailures.map(failure => failure.count)))),
    jobFailures: sum(facts.map(session => session.failedJobs.length)),
    providerRetries: sum(facts.map(session => sum(session.retries.map(retry => retry.count)))),
    tools: [...tools].sort((left, right) => right.calls - left.calls).slice(0, 12),
    errorsByTool: [...tools]
      .filter(row => row.errors > 0)
      .sort((left, right) => right.errors - left.errors)
      .slice(0, 10),
    slowTools: [...tools]
      .filter(row => row.totalMs > 0)
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, 8),
  }
}

/** A change must clear both a ratio and an absolute floor, so a 2→3 count is not a trend. */
const changeOf = (input: {
  readonly previousHits: number
  readonly currentHits: number
  readonly previousSessions: number
  readonly currentSessions: number
}): SignalChange => {
  if (input.previousHits === 0 && input.previousSessions === 0) return input.currentHits >= 3 || input.currentSessions >= 2 ? 'new' : 'steady'
  if (input.currentHits >= input.previousHits * 1.5 && input.currentHits - input.previousHits >= 5) return 'worse'
  if (input.previousHits >= 5 && input.currentHits <= input.previousHits * 0.5) return 'better'
  return 'steady'
}

const deltasOf = (input: { readonly currentSignals: readonly Signal[]; readonly previousSignals: readonly Signal[] }): readonly SignalDelta[] => {
  const previousById = new Map(input.previousSignals.map(signal => [signal.id, signal]))
  return input.currentSignals
    .map((signal): SignalDelta => {
      const previous = previousById.get(signal.id)
      const previousHits = previous?.occurrences ?? 0
      const previousSessions = previous?.sessions ?? 0
      return {
        id: signal.id,
        kind: signal.kind,
        category: signal.category,
        title: signal.title,
        change: changeOf({ previousHits, currentHits: signal.occurrences, previousSessions, currentSessions: signal.sessions }),
        previousHits,
        currentHits: signal.occurrences,
        previousSessions,
        currentSessions: signal.sessions,
        score: signal.score,
        recurring: signal.recurring,
      }
    })
    .sort((left, right) => right.score - left.score)
}

const CHANGE_PRIORITY = new Map<SignalChange, number>([
  ['new', 2],
  ['worse', 1.8],
  ['steady', 1],
  ['better', 0],
])

/** A signal that just appeared outranks one that grew: nothing has been tried on it yet. */
const CHANGE_RANK = new Map<SignalChange, number>([
  ['new', 2],
  ['worse', 1],
  ['steady', 0],
  ['better', 0],
])

const candidatesOf = (input: {
  readonly deltas: readonly SignalDelta[]
  readonly currentSignals: readonly Signal[]
  readonly ledger: readonly { readonly key: string; readonly status: string }[]
  readonly top: number
}): readonly ReviewCandidate[] => {
  const statusByKey = new Map(input.ledger.map(entry => [entry.key, entry.status]))
  const byId = new Map(input.currentSignals.map(signal => [signal.id, signal]))
  return input.deltas
    .filter(delta => CHANGE_PRIORITY.get(delta.change) !== 0)
    .filter(delta => delta.change !== 'steady' || (delta.recurring && delta.currentHits >= 10))
    .map(delta => {
      const signal = byId.get(delta.id)
      // Spread matters more than raw volume: a file re-edited 87x in ONE Session is
      // an incident to explain, while the same failure across 20 Sessions is a pattern.
      const spread = 1 + Math.log2(Math.max(1, delta.currentSessions))
      const priority = delta.score * (CHANGE_PRIORITY.get(delta.change) ?? 1) * spread
      return { delta, signal, priority }
    })
    .filter((entry): entry is { readonly delta: SignalDelta; readonly signal: Signal; readonly priority: number } => entry.signal !== undefined)
    .sort((left, right) => {
      const rank = (CHANGE_RANK.get(right.delta.change) ?? 0) - (CHANGE_RANK.get(left.delta.change) ?? 0)
      return rank === 0 ? right.priority - left.priority : rank
    })
    .slice(0, input.top)
    .map(entry => ({
      delta: entry.delta,
      hint: entry.signal.hint,
      evidence: entry.signal.evidence,
      sessionIds: entry.signal.sessionIds,
      ledgerStatus: statusByKey.get(entry.delta.id) ?? null,
    }))
}

const buildReview = (input: ReviewInput): ReviewReport => {
  const currentSignals = SessionMiner.aggregate(input.current.facts, input.now)
  const previousSignals = SessionMiner.aggregate(input.previous.facts, input.now)
  const currentVitals = vitalsOf(input.current.facts)
  const previousVitals = vitalsOf(input.previous.facts)
  const deltas = deltasOf({ currentSignals, previousSignals })
  const windowDays = Math.max(1, Math.round((input.currentWindow.to - input.currentWindow.from) / 86_400_000))
  const caveats = [
    'Derived from DSH Session logs only: cost, provider billing, live trace spans, Activity Timeline events and Memory analytics are not consulted, so a claim about any of those needs its own source.',
    'Windows are selected by Session log mtime. A thread opened before the window and still active inside it is counted here, and a log touched after the window closes moves to the later window.',
    'Correction counts are lexical matches on human messages; open every one before treating it as pushback.',
    'Token totals come from assistant usage records; an attempt that recorded no usage understates the window.',
    'Trace retention (72 h or 100k spans, whichever binds first) is shorter than a weekly window, so traces explain individual turns but cannot support week-over-week comparisons.',
    `Noise floor: with one week per window, a change under about 1.5x on a small count is not distinguishable from normal variation.`,
  ]
  const notes: string[] = [
    `Extractor version ${String(SessionMiner.EXTRACTOR_VERSION)}; the previous window was re-aggregated from the same logs, not copied from an older report.`,
    `Unreadable logs: ${String(input.current.failed)} current, ${String(input.previous.failed)} previous.`,
  ]
  return {
    generatedAt: input.now,
    since: input.since,
    windowDays,
    current: {
      from: input.currentWindow.from,
      to: input.currentWindow.to,
      sessions: currentVitals.sessions,
      projects: currentVitals.projects,
      unreadable: input.current.failed,
    },
    previous: {
      from: input.previousWindow.from,
      to: input.previousWindow.to,
      sessions: previousVitals.sessions,
      projects: previousVitals.projects,
      unreadable: input.previous.failed,
    },
    currentVitals,
    previousVitals,
    deltas,
    candidates: candidatesOf({ deltas, currentSignals, ledger: input.ledger, top: input.top }),
    caveats,
    notes,
  }
}

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|')

const isoDay = (value: number): string => new Date(value).toISOString().slice(0, 10)

const ratio = (current: number, previous: number): string => {
  if (previous === 0) return current === 0 ? '—' : 'new'
  const change = (current - previous) / previous
  const sign = change > 0 ? '+' : ''
  return `${sign}${(change * 100).toFixed(0)}%`
}

const per100 = (value: number, turns: number): string => (turns === 0 ? '—' : ((value / turns) * 100).toFixed(1))

const vitalRows = (report: ReviewReport): readonly (readonly [string, string, string, string])[] => {
  const current = report.currentVitals
  const previous = report.previousVitals
  return [
    ['Sessions', String(previous.sessions), String(current.sessions), ratio(current.sessions, previous.sessions)],
    ['Projects', String(previous.projects), String(current.projects), ratio(current.projects, previous.projects)],
    ['Turns', String(previous.turns), String(current.turns), ratio(current.turns, previous.turns)],
    ['Tool calls', String(previous.toolCalls), String(current.toolCalls), ratio(current.toolCalls, previous.toolCalls)],
    ['Tool errors', String(previous.toolErrors), String(current.toolErrors), ratio(current.toolErrors, previous.toolErrors)],
    ['Tool errors / 100 turns', per100(previous.toolErrors, previous.turns), per100(current.toolErrors, current.turns), '—'],
    ['Corrections', String(previous.corrections), String(current.corrections), ratio(current.corrections, previous.corrections)],
    ['Compactions', String(previous.compactions), String(current.compactions), ratio(current.compactions, previous.compactions)],
    ['Skill loads', String(previous.skillLoads), String(current.skillLoads), ratio(current.skillLoads, previous.skillLoads)],
    ['Peer messages', String(previous.peerMessages), String(current.peerMessages), ratio(current.peerMessages, previous.peerMessages)],
    ['jj failures', String(previous.jjFailures), String(current.jjFailures), ratio(current.jjFailures, previous.jjFailures)],
    ['Job failures', String(previous.jobFailures), String(current.jobFailures), ratio(current.jobFailures, previous.jobFailures)],
    ['Provider retries', String(previous.providerRetries), String(current.providerRetries), ratio(current.providerRetries, previous.providerRetries)],
    ['Input tokens', String(previous.tokens.input), String(current.tokens.input), ratio(current.tokens.input, previous.tokens.input)],
    ['Cache-read tokens', String(previous.tokens.cacheRead), String(current.tokens.cacheRead), ratio(current.tokens.cacheRead, previous.tokens.cacheRead)],
    ['Output tokens', String(previous.tokens.output), String(current.tokens.output), ratio(current.tokens.output, previous.tokens.output)],
  ]
}

const renderCandidate = (candidate: ReviewCandidate, index: number): readonly string[] => {
  const delta = candidate.delta
  const known =
    candidate.ledgerStatus === null ? 'not in the ledger yet' : `already tracked as \`${candidate.ledgerStatus}\` — work that entry instead of adding another`
  return [
    `### ${String(index + 1)}. ${delta.title}`,
    '',
    `- signal \`${delta.id}\` · ${delta.change} · ${delta.kind} · ${delta.category} · score ${delta.score.toFixed(1)} · ${known}`,
    `- hits ${String(delta.previousHits)} → ${String(delta.currentHits)}, Sessions ${String(delta.previousSessions)} → ${String(delta.currentSessions)}`,
    `- why it matters: ${candidate.hint}`,
    `- Sessions: ${candidate.sessionIds
      .slice(0, 6)
      .map(id => `\`${id}\``)
      .join(', ')}`,
    ...candidate.evidence.map(entry => `  - \`${entry.sessionId}#${String(entry.seq)}\` ${new Date(entry.time).toISOString()} — ${escapeCell(entry.excerpt)}`),
    '',
  ]
}

const renderReview = (report: ReviewReport): string => {
  const lines: string[] = []
  lines.push('# Self-improve weekly review', '')
  lines.push(`- generated: ${new Date(report.generatedAt).toISOString()}`)
  lines.push(
    `- current window: ${isoDay(report.current.from)} → ${isoDay(report.current.to)} (${String(report.windowDays)}d, ${String(report.current.sessions)} Sessions)`,
  )
  lines.push(`- previous window: ${isoDay(report.previous.from)} → ${isoDay(report.previous.to)} (${String(report.previous.sessions)} Sessions)`)
  lines.push(`- unreadable logs: ${String(report.current.unreadable)} current, ${String(report.previous.unreadable)} previous`)
  lines.push('')
  lines.push('Every number below comes from Session logs. Treat a candidate as a question to investigate, never as a diagnosis.', '')

  lines.push('## Vitals', '')
  lines.push('| metric | previous | current | change |', '| --- | --- | --- | --- |')
  for (const [metric, previous, current, change] of vitalRows(report)) lines.push(`| ${metric} | ${previous} | ${current} | ${change} |`)
  lines.push('')

  const worse = report.deltas.filter(delta => delta.change === 'new' || delta.change === 'worse').slice(0, 15)
  lines.push('## What got worse', '')
  if (worse.length === 0) lines.push('No signal crossed the regression threshold this window.', '')
  else {
    lines.push('| # | change | kind | hits (prev → now) | sessions | signal |', '| --- | --- | --- | --- | --- | --- |')
    worse.forEach((delta, index) => {
      lines.push(
        `| ${String(index + 1)} | ${delta.change} | ${delta.kind} | ${String(delta.previousHits)} → ${String(delta.currentHits)} | ${String(delta.currentSessions)} | ${escapeCell(delta.title)} |`,
      )
    })
    lines.push('')
  }

  const better = report.deltas.filter(delta => delta.change === 'better').slice(0, 10)
  lines.push('## What got better', '')
  if (better.length === 0) lines.push('Nothing dropped by half or more with enough volume to be believable.', '')
  else {
    lines.push('| # | kind | hits (prev → now) | signal |', '| --- | --- | --- | --- |')
    better.forEach((delta, index) => {
      lines.push(`| ${String(index + 1)} | ${delta.kind} | ${String(delta.previousHits)} → ${String(delta.currentHits)} | ${escapeCell(delta.title)} |`)
    })
    lines.push('')
  }

  lines.push('## Investigate next', '')
  lines.push(`At most one of these becomes a change this week. The other two stay in the ledger as deferred or rejected, with the reason.`, '')
  if (report.candidates.length === 0) lines.push('No candidate cleared the bar; a quiet week is a valid result.', '')
  report.candidates.forEach((candidate, index) => lines.push(...renderCandidate(candidate, index)))

  lines.push('## Limits of this report', '')
  for (const caveat of report.caveats) lines.push(`- ${caveat}`)
  lines.push('')
  if (report.notes.length > 0) {
    lines.push('## Notes', '')
    for (const note of report.notes) lines.push(`- ${note}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

const renderReviewSummary = (report: ReviewReport): string => {
  const lines: string[] = []
  lines.push(`review: ${isoDay(report.current.from)} → ${isoDay(report.current.to)} vs ${isoDay(report.previous.from)} → ${isoDay(report.previous.to)}`)
  lines.push(
    `  sessions ${String(report.previous.sessions)} → ${String(report.current.sessions)} · turns ${String(report.previousVitals.turns)} → ${String(report.currentVitals.turns)} · tool errors ${String(report.previousVitals.toolErrors)} → ${String(report.currentVitals.toolErrors)} · corrections ${String(report.previousVitals.corrections)} → ${String(report.currentVitals.corrections)}`,
  )
  const counted = { new: 0, worse: 0, better: 0, steady: 0 }
  for (const delta of report.deltas) counted[delta.change] += 1
  lines.push(`  signals: ${String(counted.new)} new · ${String(counted.worse)} worse · ${String(counted.better)} better · ${String(counted.steady)} steady`)
  if (report.candidates.length === 0) lines.push('  candidates: none')
  else {
    lines.push('  candidates:')
    report.candidates.forEach((candidate, index) => {
      const tracked = candidate.ledgerStatus === null ? '' : ` [ledger: ${candidate.ledgerStatus}]`
      lines.push(
        `    ${String(index + 1)}. ${candidate.delta.change} · ${candidate.delta.title} (${String(candidate.delta.previousHits)} → ${String(candidate.delta.currentHits)})${tracked}`,
      )
    })
  }
  return `${lines.join('\n')}\n`
}

export class SessionReview {
  static readonly build = buildReview
  static readonly render = renderReview
  static readonly renderSummary = renderReviewSummary
}
