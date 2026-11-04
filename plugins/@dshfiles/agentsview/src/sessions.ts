import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore } from 'effect'
import { SessionNotFound, SessionUnreadable } from './errors.js'
import { readLines } from './lines.js'
import { type AgentReader, AgentLogs, type ParsedItem, type SummaryState } from './parsers.js'
import {
  type AgentKind,
  agentKindValues,
  type Indexing,
  type ListInput,
  type ReadInput,
  type SearchHit,
  type SearchInput,
  type SearchResult,
  type SessionList,
  type SessionSummary,
  SNIPPET_MAX,
  type Sources,
  type Stats,
  type StatsInput,
  type StatsRow,
  type TokenTotals,
  type Transcript,
  type TranscriptItem,
} from './types.js'

/**
 * Read-only index of the session logs other agent CLIs keep on this machine. Each pass stats every log, then reads a
 * bounded number of changed ones from the byte offset where the previous pass stopped, so a growing log costs only its
 * new lines. The summaries persist under DSH_HOME so a Host restart resumes instead of re-reading gigabytes. The index
 * never writes, moves or deletes an agent's file.
 */

const DIRECTORY_CONCURRENCY = 16
const MAX_FILES = 20_000
const TRANSCRIPT_CAP = 20_000
const TRANSCRIPT_CACHE = 3
const HITS_PER_SESSION = 3
const DEADLINE_CHECK_EVERY = 64

export interface SourceRoot {
  readonly agent: AgentKind
  readonly root: string
}

export class AgentSessionsConfig extends Context.Service<
  AgentSessionsConfig,
  {
    readonly roots: readonly SourceRoot[]
    readonly statePath: string
    readonly filesPerPass: number
    readonly budgetMs: number
    readonly searchBudgetMs: number
    readonly searchMaxSessions: number
  }
>()('@dshfiles/agentsview/AgentSessionsConfig') {
  static readonly layer = (input: {
    readonly roots: readonly SourceRoot[]
    readonly statePath: string
    readonly filesPerPass?: number
    readonly budgetMs?: number
    readonly searchBudgetMs?: number
    readonly searchMaxSessions?: number
  }) =>
    Layer.succeed(
      AgentSessionsConfig,
      AgentSessionsConfig.of({
        roots: input.roots,
        statePath: input.statePath,
        filesPerPass: input.filesPerPass ?? 60,
        budgetMs: input.budgetMs ?? 4_000,
        searchBudgetMs: input.searchBudgetMs ?? 4_000,
        searchMaxSessions: input.searchMaxSessions ?? 400,
      }),
    )

  /** Where each agent CLI keeps its logs, honouring the same environment overrides the CLIs themselves read. */
  static readonly defaultRoots = (input: {
    readonly home: string
    readonly env: { readonly CLAUDE_CONFIG_DIR?: string | undefined; readonly CODEX_HOME?: string | undefined }
    readonly join: (...parts: string[]) => string
  }): readonly SourceRoot[] => {
    const claudeHome = input.env.CLAUDE_CONFIG_DIR ?? input.join(input.home, '.claude')
    const codexHome = input.env.CODEX_HOME ?? input.join(input.home, '.codex')
    return [
      { agent: 'claude-code', root: input.join(claudeHome, 'projects') },
      { agent: 'codex', root: input.join(codexHome, 'sessions') },
    ]
  }
}

interface LogFile {
  readonly agent: AgentKind
  readonly path: string
  readonly sessionId: string
  readonly size: number
  readonly mtimeMs: number
}

interface Entry {
  readonly agent: AgentKind
  readonly path: string
  readonly sessionId: string
  size: number
  mtimeMs: number
  offset: number
  state: SummaryState
}

const keyOf = (agent: AgentKind, sessionId: string): string => `${agent}:${sessionId}`

const tokenSchema = Schema.Struct({ input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number })
const nullableString = Schema.NullOr(Schema.String)
const persistedSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Array(
    Schema.Struct({
      agent: Schema.Literals(agentKindValues),
      path: Schema.String,
      sessionId: Schema.String,
      size: Schema.Number,
      mtimeMs: Schema.Number,
      offset: Schema.Number,
      state: Schema.Struct({
        title: nullableString,
        firstPrompt: nullableString,
        cwd: nullableString,
        gitBranch: nullableString,
        models: Schema.Array(Schema.String),
        agentVersion: nullableString,
        startedAt: Schema.NullOr(Schema.Number),
        updatedAt: Schema.NullOr(Schema.Number),
        userMessages: Schema.Number,
        assistantMessages: Schema.Number,
        toolCalls: Schema.Number,
        tokens: tokenSchema,
        lastMessageId: nullableString,
      }),
    }),
  ),
})
const persistedJson = Schema.fromJsonString(persistedSchema)
const decodePersisted = Schema.decodeUnknownEffect(persistedJson)
const encodePersisted = Schema.encodeEffect(persistedJson)

const cloneState = (state: SummaryState): SummaryState => ({ ...state, models: [...state.models], tokens: { ...state.tokens } })

const summaryOf = (entry: Entry): SessionSummary => ({
  key: keyOf(entry.agent, entry.sessionId).slice(0, 300),
  agent: entry.agent,
  sessionId: entry.sessionId.slice(0, 256),
  title: AgentLogs.displayTitle(entry.state, entry.sessionId).slice(0, 300),
  firstPrompt: entry.state.firstPrompt,
  cwd: entry.state.cwd?.slice(0, 1000) ?? null,
  gitBranch: entry.state.gitBranch,
  models: entry.state.models,
  agentVersion: entry.state.agentVersion,
  startedAt: entry.state.startedAt,
  updatedAt: Math.floor(entry.state.updatedAt ?? entry.mtimeMs),
  userMessages: entry.state.userMessages,
  assistantMessages: entry.state.assistantMessages,
  toolCalls: entry.state.toolCalls,
  tokens: entry.state.tokens,
  sizeBytes: entry.size,
})

const updatedOf = (entry: Entry): number => entry.state.updatedAt ?? entry.mtimeMs
const byRecent = (left: Entry, right: Entry): number => updatedOf(right) - updatedOf(left)

const matchesText = (entry: Entry, needle: string): boolean =>
  [entry.state.title, entry.state.firstPrompt, entry.state.cwd, entry.state.gitBranch, entry.sessionId, ...entry.state.models].some(
    value => value !== null && value.toLowerCase().includes(needle),
  )

const isUnder = (cwd: string | null, root: string): boolean => {
  if (cwd === null) return false
  const base = root.endsWith('/') ? root.slice(0, -1) : root
  return cwd === base || cwd.startsWith(`${base}/`)
}

const snippetAround = (text: string, needle: string): string => {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(needle)
  if (at === -1) return flat.slice(0, SNIPPET_MAX)
  const lead = Math.max(0, at - 100)
  const body = flat.slice(lead, lead + SNIPPET_MAX - 2)
  return `${lead > 0 ? '…' : ''}${body}${lead + body.length < flat.length ? '…' : ''}`.slice(0, SNIPPET_MAX)
}

const addTokens = (left: TokenTotals, right: TokenTotals): TokenTotals => ({
  input: left.input + right.input,
  output: left.output + right.output,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
})

const emptyRow = (name: string): StatsRow => ({
  name,
  sessions: 0,
  userMessages: 0,
  toolCalls: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})
const addEntry = (row: StatsRow, entry: Entry): StatsRow => ({
  name: row.name,
  sessions: row.sessions + 1,
  userMessages: row.userMessages + entry.state.userMessages,
  toolCalls: row.toolCalls + entry.state.toolCalls,
  tokens: addTokens(row.tokens, entry.state.tokens),
})

interface CachedTranscript {
  readonly stamp: string
  readonly items: readonly ParsedItem[]
  readonly capped: boolean
}

export class AgentSessions extends Context.Service<
  AgentSessions,
  {
    readonly pass: Effect.Effect<Indexing>
    readonly sources: Effect.Effect<Sources>
    readonly list: (input: ListInput) => Effect.Effect<SessionList>
    readonly read: (input: ReadInput) => Effect.Effect<Transcript, SessionNotFound | SessionUnreadable>
    readonly search: (input: SearchInput) => Effect.Effect<SearchResult>
    readonly stats: (input: StatsInput) => Effect.Effect<Stats>
  }
>()('@dshfiles/agentsview/AgentSessions') {
  static readonly layer = Layer.effect(
    AgentSessions,
    Effect.gen(function* () {
      const config = yield* AgentSessionsConfig
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const entries = new Map<string, Entry>()
      const transcripts: Array<{ readonly key: string; readonly value: CachedTranscript }> = []
      const indexing = yield* Ref.make<Indexing>({ totalFiles: 0, indexedFiles: 0, caughtUp: false, lastPassAt: null, lastError: null })
      const lock = yield* Semaphore.make(1)
      const loaded = yield* Ref.make(false)
      const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.provideService(effect, FileSystem.FileSystem, fileSystem)

      const load = Effect.gen(function* () {
        if (yield* Ref.getAndSet(loaded, true)) return
        const text = yield* fileSystem.readFileString(config.statePath).pipe(Effect.option)
        if (Option.isNone(text)) return
        const decoded = yield* decodePersisted(text.value).pipe(Effect.option)
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning('agentsview: ignoring an unreadable session index; re-reading the logs')
          return
        }
        for (const entry of decoded.value.entries) {
          entries.set(entry.path, { ...entry, state: { ...entry.state, models: [...entry.state.models], tokens: { ...entry.state.tokens } } })
        }
      })

      const persist = Effect.gen(function* () {
        const text = yield* encodePersisted({ schemaVersion: 1, entries: [...entries.values()] })
        yield* fileSystem.makeDirectory(path.dirname(config.statePath), { recursive: true })
        const temporary = `${config.statePath}.tmp`
        yield* fileSystem.writeFileString(temporary, text)
        yield* fileSystem.rename(temporary, config.statePath)
      }).pipe(Effect.catch(error => Effect.logWarning('agentsview: could not save the session index', String(error))))

      const entriesOf = (directory: string) =>
        fileSystem.readDirectoryEntries(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<FileSystem.DirectoryEntry> => []))

      const statFile = (input: { readonly agent: AgentKind; readonly parser: AgentReader; readonly path: string; readonly name: string }) =>
        fileSystem.stat(input.path).pipe(
          Effect.map(info =>
            info.type === 'File'
              ? Option.some<LogFile>({
                  agent: input.agent,
                  path: input.path,
                  sessionId: input.parser.sessionIdOf(input.name),
                  size: Number(info.size),
                  mtimeMs: Option.match(info.mtime, { onNone: () => 0, onSome: date => date.getTime() }),
                })
              : Option.none(),
          ),
          Effect.orElseSucceed(() => Option.none<LogFile>()),
        )

      /** Claude Code: `<root>/<project>/<id>.jsonl` (subagent logs one level deeper are left out). Codex: `<root>/YYYY/MM/DD/*.jsonl`. */
      const discover = (source: SourceRoot) =>
        Effect.gen(function* () {
          const parser = AgentLogs.forAgent(source.agent)
          const depth = source.agent === 'codex' ? 3 : 1
          let directories: readonly string[] = [source.root]
          for (let level = 0; level < depth; level += 1) {
            const next = yield* Effect.forEach(
              directories,
              directory =>
                Effect.map(entriesOf(directory), list => list.filter(entry => entry.type === 'Directory').map(entry => path.join(directory, entry.name))),
              { concurrency: DIRECTORY_CONCURRENCY },
            )
            directories = next.flat()
          }
          const files = yield* Effect.forEach(
            directories,
            directory =>
              Effect.flatMap(entriesOf(directory), list =>
                Effect.forEach(
                  list.filter(entry => entry.type === 'File' && entry.name.endsWith('.jsonl')),
                  entry => statFile({ agent: source.agent, parser, path: path.join(directory, entry.name), name: entry.name }),
                ),
              ),
            { concurrency: DIRECTORY_CONCURRENCY },
          )
          return files.flat().flatMap(file => Option.toArray(file))
        })

      const ingest = (file: LogFile, entry: Entry | undefined) =>
        Effect.gen(function* () {
          const fresh = entry === undefined || file.size < entry.offset
          const next: Entry = fresh
            ? {
                agent: file.agent,
                path: file.path,
                sessionId: file.sessionId,
                size: file.size,
                mtimeMs: file.mtimeMs,
                offset: 0,
                state: AgentLogs.emptySummary(),
              }
            : entry
          const parser = AgentLogs.forAgent(file.agent)
          const state = cloneState(next.state)
          const read = yield* provided(readLines({ path: file.path, offset: next.offset, onLine: line => void parser.summarizeLine(state, line) }))
          next.state = state
          next.offset = read.offset
          next.size = file.size
          next.mtimeMs = file.mtimeMs
          entries.set(file.path, next)
        }).pipe(Effect.catch(error => Effect.logDebug('agentsview: skipped an unreadable log', file.path, String(error))))

      const runPass = Effect.gen(function* () {
        yield* load
        const startedAt = yield* Clock.currentTimeMillis
        const files = (yield* Effect.forEach(config.roots, discover, { concurrency: 2 })).flat().slice(0, MAX_FILES)
        const present = new Set(files.map(file => file.path))
        let changed = false
        for (const known of [...entries.keys()]) {
          if (present.has(known)) continue
          entries.delete(known)
          changed = true
        }
        const stale = files
          .filter(file => {
            const entry = entries.get(file.path)
            return entry === undefined || entry.size !== file.size || entry.mtimeMs !== file.mtimeMs
          })
          .sort((left, right) => right.mtimeMs - left.mtimeMs)
        let done = 0
        for (const file of stale) {
          if (done >= config.filesPerPass) break
          if ((yield* Clock.currentTimeMillis) - startedAt > config.budgetMs && done > 0) break
          yield* ingest(file, entries.get(file.path))
          done += 1
          changed = true
          yield* Effect.yieldNow
        }
        if (changed) yield* persist
        const finishedAt = yield* Clock.currentTimeMillis
        const state: Indexing = {
          totalFiles: files.length,
          indexedFiles: files.length - (stale.length - done),
          caughtUp: done >= stale.length,
          lastPassAt: finishedAt,
          lastError: null,
        }
        yield* Ref.set(indexing, state)
        return state
      }).pipe(
        Effect.catchCause(cause =>
          Effect.flatMap(
            Ref.updateAndGet(indexing, current => ({ ...current, lastError: String(cause).slice(0, 500) })),
            current => Effect.as(Effect.logError('agentsview: indexing pass failed', cause), current),
          ),
        ),
        Effect.withSpan('agentsview index pass', { attributes: pluginAttributes({ plugin: 'agentsview', attributes: { roots: config.roots.length } }) }),
      )

      const pass = lock.withPermits(1)(runPass)

      /** Reads are served from whatever the index holds; the first one waits for a pass so a cold Host is not empty. */
      const ready = Effect.gen(function* () {
        if ((yield* Ref.get(indexing)).lastPassAt === null) yield* pass
        return yield* Ref.get(indexing)
      })

      const sorted = (agent: AgentKind | undefined) => [...entries.values()].filter(entry => agent === undefined || entry.agent === agent).sort(byRecent)

      const findEntry = (key: string) =>
        Effect.gen(function* () {
          yield* ready
          const split = key.indexOf(':')
          const agent = key.slice(0, split)
          const sessionId = key.slice(split + 1)
          const found = [...entries.values()].find(entry => entry.agent === agent && entry.sessionId === sessionId)
          if (found === undefined) return yield* new SessionNotFound({ key })
          return found
        })

      const transcriptOf = (entry: Entry) =>
        Effect.gen(function* () {
          const key = keyOf(entry.agent, entry.sessionId)
          const stamp = `${String(entry.size)}:${String(entry.mtimeMs)}`
          const cached = transcripts.find(candidate => candidate.key === key)
          if (cached?.value.stamp === stamp) return cached.value
          const parser = AgentLogs.forAgent(entry.agent)
          const items: ParsedItem[] = []
          let capped = false
          yield* provided(
            readLines({
              path: entry.path,
              offset: 0,
              onLine: line => {
                for (const parsed of parser.itemsOfLine(line) ?? []) {
                  if (items.length >= TRANSCRIPT_CAP) {
                    capped = true
                    return false
                  }
                  items.push(parsed)
                }
                return true
              },
            }),
          ).pipe(Effect.mapError(cause => new SessionUnreadable({ key, cause })))
          const value: CachedTranscript = { stamp, items, capped }
          const at = transcripts.findIndex(candidate => candidate.key === key)
          if (at !== -1) transcripts.splice(at, 1)
          transcripts.unshift({ key, value })
          transcripts.length = Math.min(transcripts.length, TRANSCRIPT_CACHE)
          return value
        })

      const sources = Effect.gen(function* () {
        const state = yield* ready
        const rows = yield* Effect.forEach(config.roots, root =>
          Effect.map(
            Effect.orElseSucceed(fileSystem.exists(root.root), () => false),
            available => ({
              agent: root.agent,
              label: AgentLogs.label(root.agent),
              root: root.root.slice(0, 1000),
              available,
              sessions: [...entries.values()].filter(entry => entry.agent === root.agent).length,
            }),
          ),
        )
        return { sources: rows, indexing: state }
      })

      const list = (input: ListInput) =>
        Effect.gen(function* () {
          const state = yield* ready
          const needle = input.filter?.toLowerCase()
          const cwd = input.cwd
          const matched = sorted(input.agent).filter(
            entry => (needle === undefined || matchesText(entry, needle)) && (cwd === undefined || isUnder(entry.state.cwd, cwd)),
          )
          const offset = input.offset ?? 0
          return { sessions: matched.slice(offset, offset + (input.limit ?? 50)).map(summaryOf), total: matched.length, indexing: state }
        })

      const read = (input: ReadInput) =>
        Effect.gen(function* () {
          const entry = yield* findEntry(input.key)
          const transcript = yield* transcriptOf(entry)
          const kinds = input.kinds === undefined ? undefined : new Set(input.kinds)
          const numbered = transcript.items.map((parsed, index): TranscriptItem => ({ index, ...parsed }))
          const visible = kinds === undefined ? numbered : numbered.filter(entryItem => kinds.has(entryItem.kind))
          const offset = input.offset ?? 0
          return {
            session: summaryOf(entry),
            items: visible.slice(offset, offset + (input.limit ?? 100)),
            total: visible.length,
            offset,
            capped: transcript.capped,
          }
        }).pipe(
          Effect.withSpan('agentsview session read', {
            attributes: pluginAttributes({ plugin: 'agentsview', attributes: { agent: input.key.split(':')[0] ?? '' } }),
          }),
        )

      const search = (input: SearchInput) =>
        Effect.gen(function* () {
          yield* ready
          const needle = input.query.toLowerCase()
          const limit = input.limit ?? 30
          const candidates = sorted(input.agent)
          const hits: SearchHit[] = []
          for (const entry of candidates) {
            if (hits.length >= limit) break
            if (matchesText(entry, needle)) {
              hits.push({
                session: summaryOf(entry),
                itemIndex: null,
                kind: null,
                snippet: snippetAround(AgentLogs.displayTitle(entry.state, entry.sessionId), needle),
              })
            }
          }
          const clock = yield* Clock.Clock
          const deadline = clock.currentTimeMillisUnsafe() + config.searchBudgetMs
          let scanned = 0
          let complete = true
          let checked = 0
          /** One huge log can hold the whole budget, so the deadline is also checked inside a file. */
          const outOfTime = (): boolean => {
            checked += 1
            if (checked % DEADLINE_CHECK_EVERY !== 0 || clock.currentTimeMillisUnsafe() <= deadline) return false
            complete = false
            return true
          }
          for (const entry of candidates) {
            if (hits.length >= limit || !complete) break
            if (scanned >= config.searchMaxSessions || clock.currentTimeMillisUnsafe() > deadline) {
              complete = false
              break
            }
            scanned += 1
            const parser = AgentLogs.forAgent(entry.agent)
            const summary = summaryOf(entry)
            let index = 0
            let inSession = 0
            yield* provided(
              readLines({
                path: entry.path,
                offset: 0,
                onLine: line => {
                  if (outOfTime()) return false
                  for (const parsed of parser.itemsOfLine(line) ?? []) {
                    index += 1
                    if (parsed.kind === 'meta' || parsed.kind === 'tool-result') continue
                    const haystack = parsed.kind === 'tool-call' ? `${parsed.toolName ?? ''} ${parsed.text}` : parsed.text
                    if (!haystack.toLowerCase().includes(needle)) continue
                    hits.push({ session: summary, itemIndex: index - 1, kind: parsed.kind, snippet: snippetAround(haystack, needle) })
                    inSession += 1
                    if (inSession >= HITS_PER_SESSION || hits.length >= limit) return false
                  }
                  return true
                },
              }),
            ).pipe(Effect.catch(error => Effect.logDebug('agentsview: search skipped an unreadable log', entry.path, String(error))))
            yield* Effect.yieldNow
          }
          return { hits: hits.slice(0, limit), scannedSessions: scanned, totalSessions: candidates.length, complete }
        }).pipe(Effect.withSpan('agentsview search', { attributes: pluginAttributes({ plugin: 'agentsview', attributes: { agent: input.agent ?? 'all' } }) }))

      const stats = (input: StatsInput) =>
        Effect.gen(function* () {
          const state = yield* ready
          const days = input.days ?? 30
          const now = yield* Clock.currentTimeMillis
          const since = now - days * 86_400_000
          const inWindow = [...entries.values()].filter(entry => updatedOf(entry) >= since)
          const byAgent = new Map<string, StatsRow>()
          const byModel = new Map<string, StatsRow>()
          const byDay = new Map<string, { sessions: number; outputTokens: number }>()
          let totals = emptyRow('all')
          for (const entry of inWindow) {
            totals = addEntry(totals, entry)
            const label = AgentLogs.label(entry.agent)
            byAgent.set(label, addEntry(byAgent.get(label) ?? emptyRow(label), entry))
            const model = entry.state.models[0] ?? 'unknown'
            byModel.set(model, addEntry(byModel.get(model) ?? emptyRow(model), entry))
            const day = new Date(entry.state.startedAt ?? updatedOf(entry)).toISOString().slice(0, 10)
            const bucket = byDay.get(day) ?? { sessions: 0, outputTokens: 0 }
            byDay.set(day, { sessions: bucket.sessions + 1, outputTokens: bucket.outputTokens + entry.state.tokens.output })
          }
          const bySessions = (left: StatsRow, right: StatsRow) => right.sessions - left.sessions
          return {
            days,
            totals,
            byAgent: [...byAgent.values()].sort(bySessions),
            byModel: [...byModel.values()].sort(bySessions).slice(0, 40),
            byDay: [...byDay.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .slice(-366)
              .map(([day, bucket]) => ({ day, ...bucket })),
            indexing: state,
          }
        })

      return AgentSessions.of({ pass, sources, list, read, search, stats })
    }),
  )
}
