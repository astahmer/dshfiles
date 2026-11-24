import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'

/** The thread workspace fields the Land card reads; jj-integration's `ThreadView` satisfies it. */
export interface LandThread {
  readonly canRebase?: boolean | undefined
  readonly behind: boolean
  readonly behindCount?: number | undefined
  readonly unlanded: readonly { readonly description: string; readonly conflict: boolean }[]
}

/** Whether Land is enabled, and when not, the reason the card shows under it. */
export interface LandReadiness {
  readonly canLand: boolean
  /** The thread is busy but its work is otherwise ready: offer to land once it is idle. */
  readonly canQueue: boolean
  readonly conflicts: number
  readonly undescribed: number
  readonly reason: string | undefined
}

/** Why Land is not offered yet, checked in the order the card explains them; undefined once nothing blocks. */
const blockingReason = (
  thread: LandThread,
  facts: { readonly conflicts: number; readonly undescribed: number; readonly busy: boolean },
): string | undefined => {
  if (thread.unlanded.length === 0) return undefined
  if (facts.conflicts > 0) return 'Resolve the conflicts first.'
  if (facts.undescribed > 0) return 'Describe every revision first.'
  if (facts.busy) return 'The thread is working or waiting for an answer. Land once it is idle, or queue it with Land when idle.'
  if (thread.canRebase === undefined) return 'Could not tell whether the thread is idle; Land checks again when you click it.'
  return undefined
}

/**
 * The client's preview of jj-integration's own land guard, so the button explains itself before the Host refuses:
 * conflicts and undescribed revisions block, and a thread that is working or waiting on a question blocks until idle.
 * The Host still re-checks every guard when Land is clicked.
 */
const readiness = (input: { readonly thread: LandThread | null; readonly threadBusy: boolean; readonly pending: boolean }): LandReadiness => {
  const thread = input.thread
  if (thread === null) return { canLand: false, canQueue: false, conflicts: 0, undescribed: 0, reason: undefined }
  const conflicts = thread.unlanded.filter(revision => revision.conflict).length
  const undescribed = thread.unlanded.filter(revision => revision.description.trim().length === 0).length
  const busy = input.threadBusy || thread.canRebase === false
  const blockedByContent = conflicts > 0 || undescribed > 0
  const reason = blockingReason(thread, { conflicts, undescribed, busy })
  return {
    canLand: thread.unlanded.length > 0 && !blockedByContent && !busy && !input.pending,
    canQueue: thread.unlanded.length > 0 && !blockedByContent && busy,
    conflicts,
    undescribed,
    reason,
  }
}

const behindText = (thread: LandThread, bookmark: string): string => {
  const count = thread.behindCount ?? (thread.behind ? 1 : 0)
  if (count === 0) return `Up to date with ${bookmark}`
  if (thread.behindCount === undefined) return `Behind ${bookmark}`
  return `Behind ${bookmark} by ${String(count)}`
}

interface CheckReceipt {
  readonly label: string
  readonly status: 'passed' | 'failed' | 'cancelled' | 'timed-out'
  readonly freshness: 'current' | 'stale' | 'unknown'
}

/** The thread's latest project-check result per check, or undefined when none ran. */
const checks = (receipts: readonly CheckReceipt[] | undefined): { readonly status: WorkStatus; readonly text: string; readonly hint?: string } | undefined => {
  if (receipts === undefined || receipts.length === 0) return undefined
  const latest = new Map<string, CheckReceipt>()
  for (const receipt of receipts) if (!latest.has(receipt.label)) latest.set(receipt.label, receipt)
  const all = [...latest.values()]
  const failed = all.filter(receipt => receipt.status !== 'passed')
  const stale = all.filter(receipt => receipt.freshness === 'stale')
  if (failed.length > 0) return { status: 'failed', text: `Checks: ${failed.map(receipt => receipt.label).join(', ')} did not pass` }
  if (stale.length > 0)
    return { status: 'idle', text: 'Checks passed on older files', hint: `${String(stale.length)} ran on older files; run them again before landing` }
  return { status: 'done', text: `Checks passed (${all.map(receipt => receipt.label).join(', ')})` }
}

/** The thread workspace fields "Land & next" reads from jj-integration's repository view. */
export interface LandCandidate extends LandThread {
  readonly path: string
  readonly missing: boolean
  readonly sessionIds: readonly string[]
  readonly integrationQueuedAt?: number | undefined
}

/**
 * The thread "Land & next" opens after this one lands: another workspace with described, conflict-free work that its
 * Host says it can land now and no land already queued, in the repository's own order (the same repository first).
 * Undefined when none is ready, so the card offers plain Land only.
 */
const nextReady = (input: {
  readonly repositories: readonly { readonly repoRoot: string; readonly threads: readonly LandCandidate[] }[]
  readonly currentPath: string
}): { readonly path: string; readonly sessionId: string } | undefined => {
  const comparable = (path: string): string => path.replace(/[\\/]+$/u, '')
  const current = comparable(input.currentPath)
  const ordered = [...input.repositories].sort(
    (left, right) =>
      Number(!left.threads.some(thread => comparable(thread.path) === current)) - Number(!right.threads.some(thread => comparable(thread.path) === current)),
  )
  for (const repository of ordered)
    for (const thread of repository.threads) {
      if (comparable(thread.path) === current || thread.missing || thread.sessionIds.length === 0) continue
      if (thread.integrationQueuedAt !== undefined || thread.canRebase !== true || thread.unlanded.length === 0) continue
      if (thread.unlanded.some(revision => revision.conflict || revision.description.trim().length === 0)) continue
      const sessionId = thread.sessionIds[0]
      if (sessionId !== undefined) return { path: thread.path, sessionId }
    }
  return undefined
}

/** What landing moves: the first titles, how many more, and the size in one line. */
export interface ChangeSummary {
  readonly titles: readonly { readonly changeId: string; readonly title: string }[]
  readonly more: number
  readonly stat: string | undefined
}

/** What landing moves, in one line the card reads before the checks: titles first, then the size. */
const changeSummary = (input: {
  readonly revisions: readonly { readonly changeId: string; readonly description: string }[]
  readonly files?: readonly { readonly additions: number; readonly deletions: number }[] | undefined
  readonly shown?: number
}): ChangeSummary => {
  const shown = input.shown ?? 3
  const titles = input.revisions.slice(0, shown).map(revision => ({
    changeId: revision.changeId.slice(0, 8),
    title: revision.description.split('\n')[0]?.trim() || '(no description)',
  }))
  const files = input.files
  const stat =
    files === undefined
      ? undefined
      : `${files.length === 1 ? '1 file' : `${String(files.length)} files`} · +${String(files.reduce((sum, file) => sum + file.additions, 0))} −${String(files.reduce((sum, file) => sum + file.deletions, 0))}`
  return { titles, more: Math.max(0, input.revisions.length - shown), stat }
}

/** One precondition that holds, said in a few words on the card's muted line. */
export interface LandFact {
  readonly id: string
  readonly text: string
}

/** One precondition that needs the user: the only kind that earns a chip. */
export interface LandAttention {
  readonly id: string
  readonly label: string
  readonly status: 'warning' | 'failed'
  readonly summary?: string | undefined
}

const counted = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/**
 * The card's preconditions, split by whether anything is wrong. What holds is one muted line ("2 revisions to land ·
 * up to date with main · described"); only a precondition that fails or asks for attention becomes
 * a chip. Three green ticks to say "nothing is wrong" spent colour on a healthy state (DESIGN.md: a healthy system is
 * quiet).
 */
/** What the land card states as done, and what still needs the user's attention before a land. */
export interface LandPreconditions {
  readonly facts: readonly LandFact[]
  readonly attention: readonly LandAttention[]
}

const preconditions = (input: {
  readonly thread: LandThread
  readonly bookmark: string
  readonly readiness: LandReadiness
  readonly checkSummary: ReturnType<typeof checks>
}): LandPreconditions => {
  const revisions = input.thread.unlanded.length
  const behind = (input.thread.behindCount ?? (input.thread.behind ? 1 : 0)) > 0
  const facts: LandFact[] = [{ id: 'revisions', text: revisions === 0 ? 'Nothing to land' : `${counted(revisions, 'revision')} to land` }]
  const attention: LandAttention[] = []
  if (behind) attention.push({ id: 'behind', label: behindText(input.thread, input.bookmark), status: 'warning', summary: 'Land moves this work onto its tip' })
  else facts.push({ id: 'behind', text: `up to date with ${input.bookmark}` })
  if (input.readiness.conflicts > 0)
    attention.push({
      id: 'conflicts',
      label: `Conflicts in ${counted(input.readiness.conflicts, 'revision')}`,
      status: 'failed',
      summary: 'Resolve them in this workspace, or open History.',
    })
  if (input.readiness.undescribed > 0)
    attention.push({
      id: 'undescribed',
      label: `${String(input.readiness.undescribed)} revision${input.readiness.undescribed === 1 ? ' needs' : 's need'} a description`,
      status: 'warning',
      summary: 'Ask the thread to describe its work, or describe it in History.',
    })
  else if (revisions > 0) facts.push({ id: 'described', text: 'described' })
  const summary = input.checkSummary
  if (summary !== undefined) {
    if (summary.status === 'done') facts.push({ id: 'checks', text: summary.text.charAt(0).toLowerCase() + summary.text.slice(1) })
    else attention.push({ id: 'checks', label: summary.text, status: summary.status === 'failed' ? 'failed' : 'warning', summary: summary.hint })
  }
  return { facts, attention }
}

export class LandCardModel {
  static readonly preconditions = preconditions
  static readonly readiness = readiness
  static readonly behindText = behindText
  static readonly checks = checks
  static readonly nextReady = nextReady
  static readonly changeSummary = changeSummary
}
