/**
 * What the composer's Jujutsu readings say, decided apart from the components so each rule has a test. Client-only on
 * purpose: `composer-context-core.ts` is bundled into the Host half too, and a wording rule must not ask for a restart.
 */

/** What the workspace diff of a Session's folder holds, as the header pill and the workspace menu may state it. */
export interface WorkspaceChangesReading {
  readonly files: number
  readonly totals: { readonly additions: number; readonly deletions: number } | null
  readonly conflict: boolean
}

interface WorkspaceChangesInput extends WorkspaceChangesReading {
  /** Whether the Session edits its own jj workspace; false in the project checkout, which every thread there shares. */
  readonly ownWorkspace: boolean
}

/**
 * The header pill's reading, or null for no pill. The diff is read per folder, not per thread: only a thread's own
 * workspace holds that thread's work alone, so the project checkout never gets a `+N −M` in a thread's header. A
 * workspace with nothing changed has no pill either: the header shows a control only while it carries state.
 */
const changesPill = (input: WorkspaceChangesInput): WorkspaceChangesReading | null => {
  if (!input.ownWorkspace) return null
  if (input.files === 0 && !input.conflict) return null
  return { files: input.files, totals: input.totals, conflict: input.conflict }
}

/** The project checkout's changes, stated as the project's in the workspace menu; null in an own workspace or when clean. */
const projectChanges = (input: WorkspaceChangesInput): WorkspaceChangesReading | null => {
  if (input.ownWorkspace) return null
  if (input.files === 0 && !input.conflict) return null
  return { files: input.files, totals: input.totals, conflict: input.conflict }
}

/** "3 files, +21 −0": the size of a workspace diff in one phrase. */
const changesSize = (reading: WorkspaceChangesReading): string => {
  const files = reading.files === 0 ? 'no file changes' : `${String(reading.files)} ${reading.files === 1 ? 'file' : 'files'}`
  return reading.totals === null ? files : `${files}, +${String(reading.totals.additions)} −${String(reading.totals.deletions)}`
}

/**
 * The meter-line location reading: where the working copy stands, in the workspace picker's two words.
 *
 * An own workspace states no "N ahead": that count includes the empty working-copy revision, so it disagreed with the
 * header's "N to land" for the same thread (H5, unslop). The header and the thread list own that count.
 */
const locationLabel = (input: {
  readonly ownWorkspace: boolean
  readonly bookmark: string | undefined
  /** The working copy carries the bookmark itself; otherwise `bookmark` is its nearest ancestor. */
  readonly onBookmark: boolean
  readonly counts: { readonly ahead: number; readonly behind: number } | null | undefined
}): string => {
  const counts = input.counts ?? undefined
  const ahead = counts === undefined || counts.ahead === 0 ? '' : `${String(counts.ahead)} `
  const stand = (): string | undefined => {
    if (input.bookmark === undefined) return undefined
    if (input.onBookmark) return `on ${input.bookmark}`
    if (input.ownWorkspace) return undefined
    return `${ahead}ahead of ${input.bookmark}`
  }
  return [
    input.ownWorkspace ? 'Own workspace' : 'In the project',
    stand(),
    counts === undefined || counts.behind === 0 ? undefined : `${String(counts.behind)} behind`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ')
}

/**
 * The state the location chip flags for a phone's meter line (council round 13 C5), which rich-composer hides unless an
 * entry carries one: a conflict first, then no bookmark to stand on, then commits behind the base.
 */
const meterAlert = (input: { readonly conflict: boolean; readonly bookmark: string | undefined; readonly behind: number }): 'conflict' | 'detached' | 'behind' | undefined => {
  if (input.conflict) return 'conflict'
  if (input.bookmark === undefined) return 'detached'
  return input.behind > 0 ? 'behind' : undefined
}

export class ComposerViewModel {
  static readonly changesPill = changesPill
  static readonly projectChanges = projectChanges
  static readonly changesSize = changesSize
  static readonly locationLabel = locationLabel
  static readonly meterAlert = meterAlert
}
