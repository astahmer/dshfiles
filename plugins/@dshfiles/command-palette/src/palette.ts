import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

/** Owned by @dshfiles/editor: `open-file` opens a workspace path, `workspace-files` streams the session's file list. */
const OPEN_FILE_EVENT = 'dshfiles:open-file'
const WORKSPACE_FILES_EVENT = 'dshfiles:workspace-files'
const GO_TO_LINE_EVENT = 'dshfiles:editor-go-to-line'

/** Query prefixes route to threads, commands, thread content, editor lines, or the prefix list. */
export type PalettePrefix = '>' | '<' | '#' | ':' | '?' | 'thread:' | 'session:'

const PALETTE_PREFIXES: readonly PalettePrefix[] = ['thread:', 'session:', '>', '<', '#', ':', '?']

const parsePaletteQuery = (query: string) => {
  const lowered = query.toLocaleLowerCase()
  const prefix = PALETTE_PREFIXES.find(candidate => lowered.startsWith(candidate)) ?? null
  return { prefix, text: prefix === null ? query : query.slice(prefix.length) }
}

export interface ThreadSearchInput {
  readonly query: string
  readonly exactId: string | undefined
}

const parseThreadSearchInput = (input: string): ThreadSearchInput => {
  const query = input.trim()
  if (/^session-[^\s/?#&]+$/u.test(query)) return { query, exactId: query }
  let url: URL
  try {
    url = new URL(query)
  } catch {
    return { query, exactId: undefined }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { query, exactId: undefined }
  const threadIds = url.searchParams.getAll('thread')
  const sessionIds = url.searchParams.getAll('session')
  const id = threadIds.length === 1 ? threadIds[0] : threadIds.length === 0 && sessionIds.length === 1 ? sessionIds[0] : undefined
  return id === undefined || id.length === 0 ? { query: `${url.origin}${url.pathname}`, exactId: undefined } : { query: id, exactId: id }
}

/** A positive line number from the text after `:`, or null. */
const parseLineNumber = (text: string): number | null => {
  const trimmed = text.trim()
  if (!/^\d{1,7}$/u.test(trimmed)) return null
  const line = Number(trimmed)
  return line > 0 ? line : null
}

export interface ContentHit {
  readonly sessionId: string
  readonly snippet: string
  /** Present when the finder answered: a hit can name a thread the sidebar does not list yet. */
  readonly title?: string
  readonly project?: string
  readonly cwd?: string
  readonly updatedAt?: number
}

export interface ThreadCandidate {
  readonly id: string
  readonly title: string
  readonly project: string
  readonly cwd: string
  readonly updatedAt: number
}

const WORD_BOUNDARY = /[\s\-_/.·:]/

const scoreLowered = (needle: string, haystack: string): number | null => {
  if (needle.length === 0) return 0
  const substringAt = haystack.indexOf(needle)
  if (substringAt >= 0) return 1000 - substringAt + (substringAt === 0 || WORD_BOUNDARY.test(haystack[substringAt - 1] ?? '') ? 200 : 0)

  let score = 0
  let cursor = 0
  let previous = -2
  for (const character of needle) {
    if (character === ' ') continue
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null
    score += 10
    if (found === previous + 1) score += 15
    if (found === 0 || WORD_BOUNDARY.test(haystack[found - 1] ?? '')) score += 20
    score -= Math.min(found - cursor, 10)
    previous = found
    cursor = found + 1
  }
  return score
}

/**
 * Subsequence score: every query character must appear in order. Consecutive
 * runs, word starts and an exact substring score higher; null means no match.
 */
const fuzzyScore = (query: string, text: string): number | null => scoreLowered(query.trim().toLocaleLowerCase(), text.toLocaleLowerCase())

interface IndexedThread {
  readonly thread: ThreadCandidate
  readonly title: string
  readonly project: string
  readonly cwd: string
  readonly id: string
}

/** Lowercased search keys, built once per thread list instead of once per keystroke. */
export interface ThreadIndex {
  readonly recent: readonly ThreadCandidate[]
  readonly entries: readonly IndexedThread[]
}

const isTopLevelThread = (session: Pick<SessionSummary, 'origin' | 'parentId'>): boolean =>
  session.origin !== 'subagent' && session.parentId === undefined

const indexThreads = (threads: readonly ThreadCandidate[]): ThreadIndex => ({
  recent: [...threads].sort((left, right) => right.updatedAt - left.updatedAt),
  entries: threads.map(thread => ({
    thread,
    title: thread.title.toLocaleLowerCase(),
    project: thread.project.toLocaleLowerCase(),
    cwd: thread.cwd.toLocaleLowerCase(),
    id: thread.id.toLocaleLowerCase(),
  })),
})

const weighted = (score: number | null, weight: number): number => (score === null ? -Infinity : score * weight)

/** Recent threads for an empty query; otherwise the best title, project, path or id matches. */
const rankThreads = ({ index, query, limit }: { index: ThreadIndex; query: string; limit: number }): ThreadCandidate[] => {
  const needle = parseThreadSearchInput(query).query.toLocaleLowerCase()
  if (needle.length === 0) return index.recent.slice(0, limit)
  const matches: Array<{ readonly thread: ThreadCandidate; readonly best: number }> = []
  for (const entry of index.entries) {
    const best = Math.max(
      weighted(scoreLowered(needle, entry.title), 3),
      weighted(scoreLowered(needle, entry.project), 2),
      weighted(scoreLowered(needle, entry.cwd), 1),
      entry.id.startsWith(needle) ? 2500 : -Infinity,
    )
    if (best !== -Infinity) matches.push({ thread: entry.thread, best })
  }
  return matches
    .sort((left, right) => right.best - left.best || right.thread.updatedAt - left.thread.updatedAt)
    .slice(0, limit)
    .map(({ thread }) => thread)
}

/** Lowercased paths and basenames, built once per file list. */
export interface FileIndex {
  readonly paths: readonly string[]
  readonly lowered: readonly string[]
  readonly basenames: readonly string[]
}

const indexFiles = (paths: readonly string[]): FileIndex => ({
  paths,
  lowered: paths.map(path => path.toLocaleLowerCase()),
  basenames: paths.map(path => path.slice(path.lastIndexOf('/') + 1).toLocaleLowerCase()),
})

/** Frecent files first for an empty query; otherwise basename matches outrank matches spread over the path. */
const rankFiles = ({ index, query, limit, boost }: { index: FileIndex; query: string; limit: number; boost: (path: string) => number }): string[] => {
  const needle = query.trim().toLocaleLowerCase()
  const matches: Array<{ readonly path: string; readonly score: number; readonly order: number }> = []
  index.paths.forEach((path, order) => {
    const bonus = boost(path)
    if (needle.length === 0) {
      if (bonus > 0) matches.push({ path, score: bonus, order })
      return
    }
    const best = Math.max(weighted(scoreLowered(needle, index.basenames[order] ?? ''), 3), weighted(scoreLowered(needle, index.lowered[order] ?? ''), 1))
    if (best !== -Infinity) matches.push({ path, score: best + bonus - path.length / 100, order })
  })
  const ranked = matches.sort((left, right) => right.score - left.score || left.order - right.order).map(({ path }) => path)
  if (needle.length > 0 || ranked.length >= limit) return ranked.slice(0, limit)
  const seen = new Set(ranked)
  for (const path of index.paths) {
    if (ranked.length >= limit) break
    if (!seen.has(path)) ranked.push(path)
  }
  return ranked
}

export interface RankableAction {
  readonly id: string
  readonly label: string
  readonly aliases?: readonly string[]
}

/** Labels weigh more than aliases; frecency breaks ties and lifts habits, and keeps source order otherwise. */
const rankActions = <Action extends RankableAction>({
  actions,
  query,
  boost,
}: {
  actions: readonly Action[]
  query: string
  boost: (id: string) => number
}): Action[] => {
  const needle = query.trim().toLocaleLowerCase()
  const matches: Array<{ readonly action: Action; readonly score: number; readonly order: number }> = []
  actions.forEach((action, order) => {
    const bonus = boost(action.id)
    if (needle.length === 0) {
      matches.push({ action, score: bonus, order })
      return
    }
    let best = weighted(scoreLowered(needle, action.label.toLocaleLowerCase()), 3)
    for (const alias of action.aliases ?? []) best = Math.max(best, weighted(scoreLowered(needle, alias.toLocaleLowerCase()), 1))
    if (best !== -Infinity) matches.push({ action, score: best + bonus, order })
  })
  return matches.sort((left, right) => right.score - left.score || left.order - right.order).map(({ action }) => action)
}

export class PaletteRules {
  static readonly OPEN_FILE_EVENT = OPEN_FILE_EVENT
  static readonly WORKSPACE_FILES_EVENT = WORKSPACE_FILES_EVENT
  static readonly GO_TO_LINE_EVENT = GO_TO_LINE_EVENT
  static readonly PALETTE_PREFIXES = PALETTE_PREFIXES
  static readonly parsePaletteQuery = parsePaletteQuery
  static readonly parseThreadSearchInput = parseThreadSearchInput
  static readonly parseLineNumber = parseLineNumber
  static readonly fuzzyScore = fuzzyScore
  static readonly indexThreads = indexThreads
  static readonly isTopLevelThread = isTopLevelThread
  static readonly rankThreads = rankThreads
  static readonly indexFiles = indexFiles
  static readonly rankFiles = rankFiles
  static readonly rankActions = rankActions
}
