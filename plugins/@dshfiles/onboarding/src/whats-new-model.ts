import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/** Where a registry install (no checkout on this Host) reads the same history. */
export const COMMITS_URL = 'https://github.com/astahmer/dshfiles/commits/main'

/** Separates the fields of one history line; neither jj nor git puts it in a title. */
export const FIELD = '\u001f'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

const TITLE = /^(feat|fix)\(([^)]+)\)(!)?:\s*(\S.*)$/u
const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,99}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u

const isoInstant = Schema.String.check(Schema.isPattern(TIMESTAMP))
const commitId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{12,64}$/u))

/** `<commit id>␟<committer time, ISO 8601>␟<first line>`: the line format both `jj log -T` and `git log --format` print here. */
const logLineSchema = Schema.Tuple([commitId, isoInstant, Schema.String])
const decodeLogLine = Schema.decodeUnknownOption(logLineSchema)

/** `<name>␟<remote, empty when local>␟<commit id>`: one jj bookmark or git ref. */
const refLineSchema = Schema.Tuple([Schema.String.check(Schema.isPattern(SAFE_REF)), Schema.String, commitId])
const decodeRefLine = Schema.decodeUnknownOption(refLineSchema)

export const whatsNewEntrySchema = Schema.Struct({
  commit: Schema.String,
  plugin: Schema.String,
  kind: Schema.Literals(['feat', 'fix']),
  breaking: Schema.Boolean,
  summary: Schema.String,
  /** Committer time, so a change reads as new when it landed, not when it was first written. */
  date: Schema.String,
})

export type WhatsNewEntry = typeof whatsNewEntrySchema.Type

export const upstreamSchema = Schema.Struct({
  remote: Schema.String,
  bookmark: Schema.String,
  entries: Schema.Array(whatsNewEntrySchema),
  more: Schema.Boolean,
  fetchCommand: Schema.String,
})

export type Upstream = typeof upstreamSchema.Type

export const whatsNewPluginSchema = Schema.Struct({ name: Schema.String, description: Schema.String, features: Schema.Number })

export type WhatsNewPlugin = typeof whatsNewPluginSchema.Type

export const whatsNewSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('off') }),
  Schema.Struct({ state: Schema.Literal('no-checkout'), reason: Schema.String, commitsUrl: Schema.String }),
  Schema.Struct({ state: Schema.Literal('unreadable'), reason: Schema.String, commitsUrl: Schema.String }),
  Schema.Struct({
    state: Schema.Literal('ready'),
    vcs: Schema.Literals(['jj', 'git']),
    /** The local bookmark or branch the history was read from; null reads `@` (jj) or `HEAD` (git). */
    bookmark: Schema.NullOr(Schema.String),
    entries: Schema.Array(whatsNewEntrySchema),
    more: Schema.Boolean,
    upstream: Schema.Array(upstreamSchema),
    plugins: Schema.Array(whatsNewPluginSchema),
    commitsUrl: Schema.String,
  }),
])

export type WhatsNew = typeof whatsNewSchema.Type
export type WhatsNewReady = Extract<WhatsNew, { readonly state: 'ready' }>

export const whatsNewInputSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_LIMIT }))),
  plugin: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u))),
  /** Only changes that landed after this instant (ISO 8601). */
  since: Schema.optional(isoInstant),
})

export type WhatsNewInput = typeof whatsNewInputSchema.Type

/** One local or remote ref as either VCS lists it. */
interface RefFact {
  readonly name: string
  readonly remote: string | null
  readonly commit: string
}

export interface UpstreamTarget {
  readonly remote: string
  readonly bookmark: string
}

/** The local trunk history is read from, and the remotes compared with it. */
interface UpstreamPlan {
  readonly bookmark: string | null
  readonly targets: readonly UpstreamTarget[]
}

/** One entry per owned plugin a `feat(…)` / `fix(…)` title scopes; any other line is dropped. */
const parseLog = (input: { readonly output: string; readonly owned: ReadonlySet<string> }): readonly WhatsNewEntry[] => {
  const seen = new Set<string>()
  const entries = input.output.split('\n').flatMap(line => {
    const decoded = decodeLogLine(line.split(FIELD))
    if (Option.isNone(decoded)) return []
    const [commit, date, title] = decoded.value
    const match = TITLE.exec(title.trim())
    if (match === null) return []
    const [, kind, scopes = '', bang, summary = ''] = match
    const instant = new Date(date).toISOString()
    return scopes
      .split(/[,\s]+/u)
      .filter(scope => input.owned.has(scope))
      .flatMap(plugin => {
        const key = `${commit}:${plugin}`
        if (seen.has(key)) return []
        seen.add(key)
        return [
          { commit: commit.slice(0, 12), plugin, kind: kind === 'fix' ? ('fix' as const) : ('feat' as const), breaking: bang === '!', summary, date: instant },
        ]
      })
  })
  return entries.toSorted((left, right) => right.date.localeCompare(left.date))
}

/** jj bookmark lines as printed; jj's `git` pseudo-remote mirrors the colocated repository, so it is not a remote. */
const parseJjRefs = (output: string): readonly RefFact[] =>
  output.split('\n').flatMap(line => {
    const decoded = decodeRefLine(line.split(FIELD))
    if (Option.isNone(decoded)) return []
    const [name, remote, commit] = decoded.value
    if (remote === 'git' || (remote !== '' && !SAFE_REF.test(remote))) return []
    return [{ name, remote: remote === '' ? null : remote, commit }]
  })

/** `git for-each-ref` lines (`<refname>␟<commit>`), split on the remote names `git remote` printed. */
const parseGitRefs = (input: { readonly refs: string; readonly remotes: string }): readonly RefFact[] => {
  const remotes = input.remotes
    .split('\n')
    .map(remote => remote.trim())
    .filter(remote => SAFE_REF.test(remote))
    .toSorted((left, right) => right.length - left.length)
  return input.refs.split('\n').flatMap((line): readonly RefFact[] => {
    const [refname = '', commit = ''] = line.split(FIELD)
    if (refname.startsWith('refs/heads/')) {
      const decoded = decodeRefLine([refname.slice('refs/heads/'.length), '', commit])
      return Option.isNone(decoded) ? [] : [{ name: decoded.value[0], remote: null, commit }]
    }
    const remote = remotes.find(candidate => refname.startsWith(`refs/remotes/${candidate}/`))
    if (remote === undefined) return []
    const decoded = decodeRefLine([refname.slice(`refs/remotes/${remote}/`.length), remote, commit])
    if (Option.isNone(decoded) || decoded.value[0] === 'HEAD') return []
    return [{ name: decoded.value[0], remote, commit }]
  })
}

const TRUNK_NAMES = ['main', 'master', 'trunk'] as const

/**
 * The local bookmark history is read from (git: the checked-out branch; jj: the first of main, master, trunk that
 * exists locally), and every remote whose bookmark of that name points elsewhere. Remote names come from the
 * repository; none is assumed.
 */
const upstreamTargets = (input: { readonly refs: readonly RefFact[]; readonly current: string | null }): UpstreamPlan => {
  const local = new Map(input.refs.filter(ref => ref.remote === null).map(ref => [ref.name, ref.commit] as const))
  const bookmark = input.current !== null && local.has(input.current) ? input.current : (TRUNK_NAMES.find(name => local.has(name)) ?? null)
  if (bookmark === null) return { bookmark, targets: [] }
  const targets = input.refs.flatMap(ref =>
    ref.remote !== null && ref.name === bookmark && ref.commit !== local.get(bookmark) ? [{ remote: ref.remote, bookmark }] : [],
  )
  return { bookmark, targets: targets.slice(0, 4) }
}

/** The request's slice of the newest entries: one plugin, after one instant, bounded. */
const select = (input: { readonly entries: readonly WhatsNewEntry[]; readonly request: WhatsNewInput }) => {
  const since = input.request.since === undefined ? null : new Date(input.request.since).toISOString()
  const matching = input.entries.filter(
    entry => (input.request.plugin === undefined || entry.plugin === input.request.plugin) && (since === null || entry.date > since),
  )
  const limit = input.request.limit ?? DEFAULT_LIMIT
  return { entries: matching.slice(0, limit), more: matching.length > limit }
}

export type WindowEntry = WhatsNewEntry & { readonly isNew: boolean }

/**
 * Since your last visit: entries after the browser's last-seen instant are new. With no instant yet (first visit),
 * none is, so the latest changes read as a list, not a wall of badges. Entries stay newest first.
 */
const windowOf = (input: { readonly value: WhatsNewReady; readonly lastSeen: string | null }) => {
  const entries: readonly WindowEntry[] = input.value.entries.map(entry => ({ ...entry, isNew: input.lastSeen !== null && entry.date > input.lastSeen }))
  return {
    newCount: entries.filter(entry => entry.isNew).length,
    newest: input.value.entries[0]?.date ?? null,
    entries,
  }
}

/** A change summary as a sentence for people: the commit title's type and scope are already gone, so only the case. */
const sentence = (summary: string): string => `${summary.charAt(0).toLocaleUpperCase()}${summary.slice(1)}`

const day = (date: string): string => date.slice(0, 10)

const entryLine = (entry: WhatsNewEntry): string =>
  `- ${day(entry.date)} ${entry.kind}${entry.breaking ? '!' : ''}(${entry.plugin}): ${entry.summary} (${entry.commit})`

const MAX_RENDER = 6_000

/** Compact text for the agent transcript; the structured value carries every entry. */
const render = (value: WhatsNew): string => {
  if (value.state === 'off') return "What's new is off (onboarding setting `whatsNew`). Turn it on in Settings › Plugins › onboarding to read history."
  if (value.state !== 'ready') return `What's new cannot read history here: ${value.reason} The same changes are listed at ${value.commitsUrl}.`
  const local = value.entries.length === 0 ? ['No feat or fix change to an owned plugin in this history.'] : value.entries.map(entryLine)
  const upstream = value.upstream.flatMap(target => [
    '',
    `## ${target.bookmark}@${target.remote}: ${String(target.entries.length)}${target.more ? '+' : ''} not in your ${target.bookmark} (as of the last fetch; \`${target.fetchCommand}\` updates it)`,
    ...target.entries.map(entryLine),
  ])
  const text = [`## What's new (${value.vcs}, ${value.bookmark ?? 'current'}${value.more ? ', newest only' : ''})`, ...local, ...upstream].join('\n')
  return text.length > MAX_RENDER ? `${text.slice(0, MAX_RENDER)}\n…` : text
}

export class WhatsNewModel {
  static readonly parseLog = parseLog
  static readonly parseJjRefs = parseJjRefs
  static readonly parseGitRefs = parseGitRefs
  static readonly upstreamTargets = upstreamTargets
  static readonly select = select
  static readonly window = windowOf
  static readonly sentence = sentence
  static readonly render = render
}
