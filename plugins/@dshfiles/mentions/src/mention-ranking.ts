/**
 * `skill`, `mcp` and `backlog` belong to the skill (thread-sidebar), MCP (mcp-servers) and backlog `@` sources; this
 * one stays empty for them.
 */
export type MentionScope = 'all' | 'thread' | 'file' | 'skill' | 'mcp' | 'backlog'

export interface MentionQuery {
  readonly scope: MentionScope
  /** The text after the scope prefix, sent to the Host lookups. */
  readonly text: string
  /** The prefix the user typed (`t:`, `thread:`, …), kept so a drill stays inside its scope. */
  readonly prefix: string
}

export interface FileEntry {
  readonly kind: 'file'
  readonly path: string
  /** Position in the Host's own fuzzy ranking. */
  readonly hostRank: number
}

export interface ThreadEntry {
  readonly kind: 'thread'
  readonly title: string
  readonly updatedAt: number
  readonly sameWorkspace: boolean
  readonly sameProject: boolean
}

export type MentionEntry = FileEntry | ThreadEntry

const SCOPE_PREFIXES: readonly (readonly [string, MentionScope])[] = [
  ['thread:', 'thread'],
  ['t:', 'thread'],
  ['file:', 'file'],
  ['f:', 'file'],
  ['skill:', 'skill'],
  ['mcp:', 'mcp'],
  ['backlog:', 'backlog'],
  ['b:', 'backlog'],
]

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A file has no recency of its own; it ranks as if touched today, so only a thread from the last hour outranks it.
const FILE_RECENCY_BUCKET = 1

/** Ranking rules for the `@` menu: match quality first, then recency, then workspace affinity. */
export class MentionRanking {
  static readonly limit = 40

  static parseQuery(query: string): MentionQuery {
    const lower = query.toLowerCase()
    for (const [prefix, scope] of SCOPE_PREFIXES) {
      if (lower.startsWith(prefix)) return { scope, text: query.slice(prefix.length), prefix: query.slice(0, prefix.length) }
    }
    return { scope: 'all', text: query, prefix: '' }
  }

  /**
   * 4 exact, 3 prefix, 2 substring on the title or basename; 1 for a substring of the whole path or a fuzzy name;
   * 0 when only the Host's wider match (cwd, id) holds.
   */
  static matchTier(input: { readonly text: string; readonly name: string; readonly path: string | undefined }): number {
    if (input.text === '') return 0
    const needle = input.text.toLowerCase()
    const name = input.name.toLowerCase()
    const stem = name.replace(/\.[^.]+$/u, '')
    if (name === needle || stem === needle) return 4
    if (name.startsWith(needle)) return 3
    if (name.includes(needle)) return 2
    if (input.path?.toLowerCase().includes(needle) === true) return 1
    return MentionRanking.isSubsequence(needle, name) ? 1 : 0
  }

  static recencyBucket(updatedAt: number, now: number): number {
    const age = now - updatedAt
    if (age < HOUR) return 0
    if (age < DAY) return 1
    if (age < 7 * DAY) return 2
    if (age < 30 * DAY) return 3
    return 4
  }

  static nameOf(entry: MentionEntry): string {
    if (entry.kind === 'thread') return entry.title
    const trimmed = entry.path.replace(/\/+$/u, '')
    return trimmed.slice(trimmed.lastIndexOf('/') + 1)
  }

  /**
   * One interleaved order across files and threads. Equal keys fall back to each kind's own rank, so the best file and
   * the best thread of a tier sit next to each other instead of one kind always winning.
   */
  static rank<Entry extends MentionEntry>(input: { readonly text: string; readonly entries: readonly Entry[]; readonly now: number }): Entry[] {
    const threadRank = new Map<Entry, number>()
    const threads = input.entries.filter(entry => entry.kind === 'thread')
    threads
      .toSorted((left, right) => (left.kind === 'thread' && right.kind === 'thread' ? right.updatedAt - left.updatedAt : 0))
      .forEach((entry, index) => threadRank.set(entry, index))
    const keyed = input.entries.map(entry => ({
      entry,
      tier: MentionRanking.matchTier({ text: input.text, name: MentionRanking.nameOf(entry), path: entry.kind === 'file' ? entry.path : undefined }),
      recency: entry.kind === 'thread' ? MentionRanking.recencyBucket(entry.updatedAt, input.now) : FILE_RECENCY_BUCKET,
      affinity: entry.kind === 'file' || entry.sameWorkspace ? 2 : entry.sameProject ? 1 : 0,
      ownRank: entry.kind === 'file' ? entry.hostRank : (threadRank.get(entry) ?? 0),
    }))
    keyed.sort(
      (left, right) =>
        right.tier - left.tier ||
        left.recency - right.recency ||
        right.affinity - left.affinity ||
        left.ownRank - right.ownRank ||
        (left.entry.kind === right.entry.kind ? 0 : left.entry.kind === 'file' ? -1 : 1),
    )
    return keyed.slice(0, MentionRanking.limit).map(item => item.entry)
  }

  private static isSubsequence(needle: string, haystack: string): boolean {
    let index = 0
    for (const character of needle) {
      index = haystack.indexOf(character, index)
      if (index < 0) return false
      index += 1
    }
    return true
  }
}
