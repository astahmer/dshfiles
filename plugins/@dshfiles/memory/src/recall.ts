import { basename } from 'node:path'

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Utf8 } from '@dshfiles/optmem-core'
import { Clock, Context, Effect, FiberSet, Layer, Option, Ref } from 'effect'

import { AgentScopes } from './agent-scopes.ts'
import { renderStartBlock } from './block.ts'
import { redact, ThreadDigestRules, type ThreadHeader } from './digest.ts'
import { Embedder, MemorySettingsTag, type RetrievalStatus } from './embedder.ts'
import {
  CrossProjectDisabled,
  JevDisabled,
  JevUnavailable,
  type FinderError,
  type MemoryInactive,
  type MemoryStoreFailed,
  type SessionLogUnavailable,
} from './errors.ts'
import { MemoryGuidance } from './guidance.ts'
import { MemoryJev } from './memory-jev.ts'
import { memoryReferenceKey } from './memory-reference.ts'
import { MemoryRepo, type NoteCategory, type SearchHit } from './memory-repo.ts'
import { ProjectPaths } from './project-path.ts'
import { SessionActivity } from './session-activity.ts'
import { SessionReads } from './session-reads-promise.ts'
import {
  ThreadFinder,
  type ThreadFinderDeps,
  type ThreadFinderMemoryHit,
  type ThreadFinderPage,
  type ThreadFinderRecord,
  type ThreadFinderRelations,
} from './thread-finder.ts'

export type Caller = { readonly id: string; readonly session: { readonly header: ThreadHeader } }

export type FindThreadsArgs = {
  readonly query: string
  readonly project?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly availability?: readonly ('live' | 'persisted')[] | undefined
  readonly createdFrom?: number | undefined
  readonly createdTo?: number | undefined
  readonly includeNotes?: boolean | undefined
}

export type NoteArgs = {
  readonly action?: 'add' | 'update' | 'forget' | undefined
  readonly text?: string | undefined
  readonly category?: NoteCategory | undefined
  readonly scope?: string | undefined
  readonly confidence?: 'stated' | 'inferred' | undefined
  readonly id?: string | number | undefined
  readonly reason?: string | undefined
}

type StoreError = MemoryInactive | MemoryStoreFailed

/** The user asking the agent to remember something, in English or French. */
const rememberRequest =
  /\b(?:remember|keep in mind|don'?t forget|note (?:that|this|it)|save (?:that|this) (?:as a )?note|retiens|souviens-toi|n'oublie pas|note que)\b/i

const credentialPath =
  /(?:^|\/)(?:\.env(?:\.[\w-]+)?|[^/\s]*\.(?:pem|key|p12|pfx)|id_[a-z0-9]+|\.netrc|\.npmrc|credentials(?:\.[\w-]+)?|\.credentials\.ya?ml)(?:$|[\s"'])/i

/** Folded session titles are read for the newest sessions only: older ones still match by digest title, identifier, or indexed message. */
const titleReadLimit = 80

const finderSpan = { attributes: { 'dshx.plugin.package': '@dshfiles/memory' } }

const day = (time: number): string => new Date(time).toISOString().slice(0, 10)

/** A Client caller is the user's own UI; it has no project of its own to scope a search to. */
const isClientCaller = (caller: Caller): boolean => caller.id.startsWith('api:')

const hitId = (hit: SearchHit): string => {
  if (hit.kind === 'note') return `n:${hit.id}`
  if (hit.kind === 'thread') return `t:${ThreadDigestRules.shortId(hit.id)}`
  return `t:${ThreadDigestRules.shortId(hit.thread)}#${hit.seq}`
}

const snippet = (text: string, query: string, bytes = 240): string => {
  const flat = text.replace(/\s+/g, ' ')
  const terms = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._:/-]*/gu) ?? []
  const lower = flat.toLowerCase()
  const at = terms.map(term => lower.indexOf(term)).find(index => index >= 0) ?? 0
  const start = Math.max(0, at - 80)
  return `${start > 0 ? '…' : ''}${Utf8.clip(flat.slice(start), bytes)}`
}

const blocksText = (blocks: readonly { readonly type: string; readonly text?: string }[]): string =>
  blocks.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n')

const eventText = (event: SessionEvent): string | undefined => {
  if (event.type === 'user/message') return blocksText(event.data.content)
  if (event.type === 'assistant/message') return blocksText(event.data.message.content)
  return undefined
}

/**
 * What agents and the panel ask of memory: the frozen start block, `memory_search`, `memory_read`, `memory_note`,
 * the note review and the thread finder. Every read records which ids it returned, so citations can be counted.
 */
export class Recall extends Context.Service<
  Recall,
  {
    readonly projectOf: (header: ThreadHeader) => Effect.Effect<string>
    readonly startBlock: (caller: Caller, firstUserText: Effect.Effect<string | undefined>) => Effect.Effect<string, StoreError>
    readonly previewStartBlock: (cwd: string, agentScope?: string | null) => Effect.Effect<{ readonly project: string; readonly text: string }, StoreError>
    readonly countBlockRequest: (bytes: number) => Effect.Effect<void, StoreError>
    readonly search: (
      caller: Caller,
      args: { readonly query: string; readonly project?: string | undefined; readonly limit?: number | undefined },
    ) => Effect.Effect<string, StoreError>
    readonly read: (args: { readonly id: string; readonly range?: string | undefined }, caller?: Caller) => Effect.Effect<string, StoreError>
    readonly note: (caller: Caller, args: NoteArgs) => Effect.Effect<string, StoreError>
    readonly reviewNotes: (
      caller: Caller,
      input: { readonly project?: string | undefined; readonly afterId?: number | undefined; readonly limit: number },
    ) => Effect.Effect<
      {
        readonly results: readonly { readonly id: number; readonly text: string; readonly probability: number | null; readonly candidate: boolean }[]
        readonly nextAfterId: number | null
      },
      StoreError | JevDisabled | JevUnavailable | CrossProjectDisabled
    >
    readonly threadRecords: Effect.Effect<readonly ThreadFinderRecord[], StoreError>
    readonly findThreads: (caller: Caller, args: FindThreadsArgs) => Effect.Effect<ThreadFinderPage & { readonly project: string }, FinderError | StoreError>
    readonly relatedThreads: (
      caller: Caller,
      args: { readonly sessionId: string; readonly project?: string | undefined; readonly limit?: number | undefined },
    ) => Effect.Effect<ThreadFinderRelations & { readonly project: string }, FinderError | StoreError>
    readonly threadDetail: (
      sessionId: string,
    ) => Effect.Effect<{ readonly messages: number; readonly createdAt: number; readonly updatedAt: number }, SessionLogUnavailable>
    readonly retrievalStatus: Effect.Effect<RetrievalStatus>
  }
>()('@dshfiles/memory/Recall') {
  static readonly layer = Layer.effect(
    Recall,
    Effect.gen(function* () {
      const settings = yield* MemorySettingsTag
      const repo = yield* MemoryRepo
      const sessions = yield* SessionReads
      const projects = yield* ProjectPaths
      const scopes = yield* AgentScopes
      const jev = yield* MemoryJev
      const embedder = yield* Embedder
      const activity = yield* SessionActivity
      const blockCache = yield* Ref.make<ReadonlyMap<string, { readonly version: number; readonly text: string }>>(new Map())
      const background = yield* FiberSet.make()
      const warming = yield* Ref.make(false)

      const projectOf = (header: ThreadHeader) => projects.of(header.cwd)

      /**
       * Which projects a caller may search. An Agent stays inside its own project unless cross-project memory is on;
       * a Client caller (the user's own UI, `api:client`) has no project of its own, so an unscoped request from it
       * covers every project the user can already open.
       */
      const projectsFilterFor = (own: string, wanted: string | undefined, clientCaller: boolean) =>
        Effect.map(settings.get, (current): readonly string[] => {
          if (wanted !== undefined && wanted.length > 0 && wanted !== 'all' && wanted !== 'current') return [wanted]
          if (wanted === 'current' && !clientCaller) return [own]
          return clientCaller || current.crossProject ? [] : [own]
        })

      const recallGate = Effect.fn('memory recall gate')(function* (firstUserText: string | undefined) {
        const credential = yield* jev.credential
        if (Option.isNone(credential) || firstUserText === undefined) return true
        const verdict = yield* Effect.result(jev.ask({ question: 'recall', text: firstUserText, credential: credential.value, recordOutput: false }))
        if (verdict._tag === 'Failure') return true
        return verdict.success.probability >= (yield* settings.get).jevThreshold
      })

      /**
       * The block a thread starts with, frozen on first use so the thread's system prompt never changes because of memory.
       * Threads of a project share one rendering per memory version, so they also share the provider's prefix cache.
       */
      const startBlock = Effect.fn('memory start block')(function* (caller: Caller, firstUserText: Effect.Effect<string | undefined>) {
        const current = yield* settings.get
        if (!current.enabled) return ''
        const frozen = yield* repo.frozenBlock(caller.id)
        if (frozen !== undefined) return frozen
        const project = yield* projectOf(caller.session.header)
        const agentScope = yield* scopes.of(caller.id)
        const withThreads = yield* recallGate(yield* firstUserText.pipe(Effect.orElseSucceed(() => undefined)))
        const key = `${project}|${withThreads}|${agentScope ?? ''}`
        const version = yield* repo.version
        const cached = (yield* Ref.get(blockCache)).get(key)
        const text =
          cached !== undefined && cached.version === version
            ? cached.text
            : yield* renderStartBlock({
                project,
                budgetBytes: current.blockBytes,
                crossProject: current.crossProject,
                staleDays: current.blockStaleDays,
                agentScope,
                withThreads,
              }).pipe(Effect.provideService(MemoryRepo, repo))
        yield* Ref.update(blockCache, entries => new Map(entries).set(key, { version, text }))
        return yield* repo.freezeBlock(caller.id, text)
      })

      /** What a new thread in the folder would start with now: rendered fresh, frozen for no thread, and empty when memory is off. */
      const previewStartBlock = Effect.fn('memory preview start block')(function* (cwd: string, agentScope?: string | null) {
        const project = yield* projects.of(cwd)
        const current = yield* settings.get
        if (!current.enabled) return { project, text: '' }
        const text = yield* renderStartBlock({
          project,
          budgetBytes: current.blockBytes,
          crossProject: current.crossProject,
          staleDays: current.blockStaleDays,
          agentScope: agentScope ?? null,
        }).pipe(Effect.provideService(MemoryRepo, repo))
        return { project, text }
      })

      const countBlockRequest = (bytes: number) => Effect.andThen(repo.bumpDaily('block.requests'), repo.bumpDaily('block.bytes', bytes))

      /** Searches the store with the query embedded when hybrid retrieval serves, starting a background embedding pass. */
      const searchStore = (request: { readonly query: string; readonly projects: readonly string[]; readonly ownProject: string; readonly limit: number }) =>
        Effect.gen(function* () {
          const { embedder: active } = yield* embedder.retrieval
          const query = active === undefined ? undefined : yield* embedder.queryVector(request.query)
          if (active !== undefined) yield* embedder.embedMissingInBackground
          return yield* repo.search({
            query: request.query,
            projects: [...request.projects],
            ownProject: request.ownProject,
            limit: request.limit,
            ranker: query === undefined ? 'bm25' : 'hybrid',
            queryVector: query?.vector,
            embeddingModel: query?.model,
          })
        })

      /**
       * A message hit's text: its stored excerpt, else one read of the whole Session log, which then fills the excerpts of
       * every indexed message of that thread so the next search does not read it again.
       */
      const messageText = (hit: { readonly thread: string; readonly seq: number; readonly excerpt: string | null }) =>
        Effect.gen(function* () {
          if (hit.excerpt !== null) return hit.excerpt
          const log = yield* Effect.option(sessions.readRecent(hit.thread))
          if (Option.isNone(log)) return undefined
          const messages = log.value.events.flatMap(event => {
            const text = eventText(event)
            return text === undefined ? [] : [{ seq: event.seq, text }]
          })
          yield* repo.backfillExcerpts({ thread: hit.thread, messages })
          return messages.find(message => message.seq === hit.seq)?.text
        })

      const search = Effect.fn('memory search')(function* (
        caller: Caller,
        args: { readonly query: string; readonly project?: string | undefined; readonly limit?: number | undefined },
      ) {
        const own = yield* projectOf(caller.session.header)
        const limit = Math.max(1, Math.min(args.limit ?? 6, 20))
        const hits = yield* searchStore({
          query: args.query,
          projects: yield* projectsFilterFor(own, args.project?.trim(), isClientCaller(caller)),
          ownProject: own,
          limit,
        })
        const lineOf = (hit: SearchHit) =>
          Effect.gen(function* () {
            const where = hit.project === own ? '' : `, ${basename(hit.project)}`
            if (hit.kind === 'thread') {
              const thread = yield* repo.thread(hit.id)
              return thread === undefined
                ? []
                : [`${hitId(hit)} (${day(thread.updatedAt)}${where}) ${thread.title} — ${thread.decision}\n  ${snippet(thread.digest, args.query)}`]
            }
            if (hit.kind === 'note') {
              const note = yield* repo.note(hit.id)
              return note === undefined
                ? []
                : [
                    `${hitId(hit)} (${day(note.createdAt)}${where}, ${note.category}, ${note.scope}${note.sourceThread === null ? '' : `, from t:${ThreadDigestRules.shortId(note.sourceThread)}`}) ${note.text}`,
                  ]
            }
            const text = yield* messageText(hit)
            return text === undefined
              ? []
              : [`${hitId(hit)} (${day(hit.updatedAt)}${where}, ${hit.role} message) ${snippet(ThreadDigestRules.redact(text), args.query)}`]
          })
        const lines = (yield* Effect.forEach(hits, lineOf)).flat()
        yield* repo.recordToolCall({
          thread: caller.id,
          tool: 'memory_search',
          results: lines.length,
          ids: hits.flatMap(hit => [hitId(hit), hitId(hit).replace(/#\d+$/, '')]),
        })
        if (lines.length === 0) return `No memory matches "${args.query}". Try fewer or different words, or an exact identifier.`
        return [
          `${lines.length} hit(s). ${MemoryGuidance.untrusted}`,
          ...lines,
          'memory_read(id) opens a digest or note; memory_read("t:<id>", "<from>-<to>") shows raw messages around #seq.',
        ].join('\n')
      })

      const read = Effect.fn('memory read')(function* (args: { readonly id: string; readonly range?: string | undefined }, caller?: Caller) {
        const recordRead = (results: number, ids: readonly string[]) =>
          caller === undefined ? Effect.void : repo.recordToolCall({ thread: caller.id, tool: 'memory_read', results, ids })
        const id = args.id.trim().replace(/^`|`$/g, '')
        const key = memoryReferenceKey(args)
        if (key === null) return `Unknown memory reference ${id}.`
        if (key.kind === 'note') {
          const note = yield* repo.note(key.noteId)
          yield* recordRead(note === undefined ? 0 : 1, [id.toLowerCase()])
          if (!note) return `No valid note ${id} (it may have been updated or forgotten; search for its topic).`
          return `${id} [${note.category}, ${note.scope}, ${note.confidence}] ${day(note.createdAt)}${note.sourceThread === null ? '' : ` from t:${ThreadDigestRules.shortId(note.sourceThread)}`}${note.supersedes === null ? '' : `, supersedes n:${note.supersedes}`}\n${note.text}`
        }
        const thread = yield* repo.thread(key.threadKey)
        const sessionId = thread?.id ?? (key.threadKey.startsWith('session-') ? key.threadKey : undefined)
        const ids = [`t:${ThreadDigestRules.shortId(sessionId ?? key.threadKey)}`]
        if (key.kind === 'digest') {
          yield* recordRead(thread === undefined ? 0 : 1, ids)
          if (!thread) return `No digest for ${id}. It may still be running, trivial, or past retention; memory_search finds its messages.`
          return `${ids[0]} digest (${day(thread.updatedAt)}, ${basename(thread.project)}, ${thread.source === 'model' ? 'written by a model' : 'from the thread record'}). ${MemoryGuidance.untrusted}\n${thread.digest}`
        }
        if (sessionId === undefined) return `Unknown thread ${id}.`
        const match = /^(\d+)\s*-\s*(\d+)$/.exec(key.range.trim()) ?? /^(\d+)$/.exec(key.range.trim())
        if (!match) return 'range must look like "120-180" (event sequence numbers from memory_search hits).'
        const from = Number(match[1])
        const to = Math.min(Number(match[2] ?? match[1]), from + 60)
        const log = yield* Effect.option(sessions.readRecent(sessionId))
        if (Option.isNone(log)) return `The log of ${ids[0]} is not readable any more.`
        const callPaths = new Map<string, boolean>()
        const lines: string[] = []
        let bytes = 0
        for (const event of log.value.events) {
          if (event.seq < from || event.seq > to) continue
          let line: string | undefined
          if (event.type === 'user/message' && event.data.source.kind === 'user') line = `#${event.seq} user: ${blocksText(event.data.content)}`
          if (event.type === 'assistant/message') {
            const text = blocksText(event.data.message.content)
            if (text.length > 0) line = `#${event.seq} assistant: ${text}`
          }
          if (event.type === 'tool/call') {
            const sensitive = credentialPath.test(event.data.arguments)
            callPaths.set(event.data.callId, sensitive)
            line = `#${event.seq} tool ${event.data.name}: ${sensitive ? '[omitted: names a credential file]' : Utf8.clip(event.data.arguments, 300)}`
          }
          if (event.type === 'tool/result') {
            const result = blocksText(event.data.message.content)
            line = `#${event.seq} result: ${callPaths.get(event.data.message.toolCallId) === true ? '[omitted: credential file]' : Utf8.clip(result, 600)}`
          }
          if (line === undefined) continue
          const clipped = Utf8.clip(ThreadDigestRules.redact(line), 1_500)
          if (bytes + Utf8.byteLength(clipped) > 8_000) {
            lines.push(`(cut at 8 KB; continue from #${event.seq})`)
            break
          }
          lines.push(clipped)
          bytes += Utf8.byteLength(clipped)
        }
        yield* recordRead(lines.length, ids)
        if (lines.length === 0) return `No messages in ${ids[0]} between #${from} and #${to}.`
        return [`${ids[0]} #${from}-#${to}. ${MemoryGuidance.untrusted}`, ...lines].join('\n')
      })

      const note = Effect.fn('memory note')(function* (caller: Caller, args: NoteArgs) {
        const action = args.action ?? 'add'
        const project = yield* projectOf(caller.session.header)
        const text = args.text === undefined ? undefined : ThreadDigestRules.redact(args.text.trim())
        yield* repo.recordToolCall({ thread: caller.id, tool: `memory_note.${action}`, results: 1, ids: [] })
        const source = Option.getOrUndefined(yield* activity.lastUserMessage(caller.id))
        const provenance = {
          sourceThread: caller.id,
          sourceSeq: source?.seq ?? null,
          origin: source !== undefined && rememberRequest.test(source.text) ? ('user-requested' as const) : ('agent' as const),
        }
        if (action === 'add') {
          if (text === undefined || text.length === 0) return 'memory_note add needs text.'
          if (Utf8.byteLength(text) > 600) return 'A note is one or two sentences (at most 600 bytes); split it or keep only the durable part.'
          const saved = yield* repo.addNote({
            project,
            text,
            category: args.category ?? 'project',
            scope: args.scope ?? 'repo',
            confidence: args.confidence ?? 'stated',
            ...provenance,
          })
          yield* embedder.embedMissingInBackground
          return saved.duplicate ? `Already noted as n:${saved.note.id}.` : `Saved n:${saved.note.id}. It appears in the start block of later threads.`
        }
        const id = Number(String(args.id ?? '').replace(/^n:/i, ''))
        if (!Number.isSafeInteger(id) || id <= 0) return `memory_note ${action} needs the note id (n:<id>).`
        if (args.reason === undefined || args.reason.trim().length === 0) return `memory_note ${action} needs a reason.`
        if (action === 'forget') return (yield* repo.forgetNote({ id, reason: args.reason.trim() })) ? `Forgot n:${id}.` : `No valid note n:${id}.`
        if (text === undefined || text.length === 0) return 'memory_note update needs the new text.'
        const replacement = yield* repo.updateNote({
          id,
          text,
          reason: args.reason.trim(),
          ...provenance,
          category: args.category,
          scope: args.scope,
          confidence: args.confidence,
        })
        yield* embedder.embedMissingInBackground
        return replacement === undefined ? `No valid note n:${id}.` : `n:${id} is superseded by n:${replacement.id}.`
      })

      const reviewNotes = Effect.fn('memory review notes')(function* (
        caller: Caller,
        input: { readonly project?: string | undefined; readonly afterId?: number | undefined; readonly limit: number },
      ) {
        const current = yield* settings.get
        if (!current.jevEnabled) return yield* new JevDisabled({})
        const clientCaller = isClientCaller(caller)
        const ownProject = yield* projectOf(caller.session.header)
        const requestedProject = input.project?.trim()
        if (!clientCaller && !current.crossProject && requestedProject !== undefined && requestedProject !== ownProject)
          return yield* new CrossProjectDisabled({ project: requestedProject })
        const project = clientCaller || current.crossProject ? requestedProject : ownProject
        const credential = yield* jev.credential
        if (Option.isNone(credential)) return yield* new JevUnavailable({})
        const notes = yield* repo.listNotes({ project, beforeId: input.afterId, limit: input.limit + 1 })
        const page = notes.slice(0, input.limit)
        const results = yield* Effect.forEach(page, note =>
          jev.ask({ question: 'relevance', text: `${note.category}: ${note.text}`, credential: credential.value, recordOutput: true }).pipe(
            Effect.map(verdict => ({ id: note.id, text: note.text, probability: verdict.probability, candidate: verdict.probability < current.jevThreshold })),
            Effect.orElseSucceed(() => ({ id: note.id, text: note.text, probability: null, candidate: false })),
          ),
        )
        return { results, nextAfterId: notes.length > input.limit ? (page.at(-1)?.id ?? null) : null }
      })

      const threadRecords = Effect.gen(function* () {
        const listed = yield* sessions.list.pipe(
          Effect.orElseSucceed(() => []),
          Effect.tap(result => Effect.annotateCurrentSpan('dshx.memory.finder.session_count', result.length)),
          Effect.withSpan('thread finder list sessions', finderSpan),
        )
        const titled = yield* sessions.titles(listed.slice(0, titleReadLimit).map(session => session.header.id)).pipe(
          Effect.tap(result => Effect.annotateCurrentSpan({ 'dshx.memory.finder.title_count': result.length, 'dshx.memory.finder.title_read_failed': false })),
          Effect.withSpan('thread finder read titles', finderSpan),
        )
        const titles = new Map(titled.map(entry => [entry.sessionId, entry]))
        const projectList = yield* Effect.forEach(listed, session => projectOf(session.header)).pipe(
          Effect.tap(result =>
            Effect.annotateCurrentSpan({
              'dshx.memory.finder.project_resolution_count': result.length,
              'dshx.memory.finder.unique_cwd_count': new Set(listed.flatMap(session => (session.header.cwd ? [session.header.cwd] : []))).size,
            }),
          ),
          Effect.withSpan('thread finder resolve projects', finderSpan),
        )
        const records = yield* Effect.forEach(listed, (session, index) =>
          Effect.map(repo.thread(session.header.id), (digest): ThreadFinderRecord => {
            const title = titles.get(session.header.id)
            return {
              sessionId: session.header.id,
              title: title?.title ?? digest?.title ?? '',
              createdAt: session.header.createdAt,
              updatedAt: Math.max(session.header.createdAt, title?.updatedAt ?? 0, digest?.updatedAt ?? 0),
              cwd: session.header.cwd ?? null,
              project: projectList[index] ?? 'unknown',
              live: session.live,
              persisted: session.persisted,
              parentSessionId: session.header.parentSession ?? null,
            }
          }),
        )
        yield* Effect.annotateCurrentSpan('dshx.memory.finder.record_count', records.length)
        return records
      }).pipe(Effect.withSpan('thread finder prepare records', finderSpan))

      const finderMemoryHits = (request: { readonly query: string; readonly limit: number; readonly projects: readonly string[] }, own: string) =>
        Effect.gen(function* () {
          const hits = yield* searchStore({ query: request.query, projects: request.projects, ownProject: own, limit: request.limit })
          const finderHit = (hit: SearchHit) =>
            Effect.gen(function* () {
              if (hit.kind === 'thread') {
                const thread = yield* repo.thread(hit.id)
                if (thread === undefined) return []
                const digest: ThreadFinderMemoryHit = {
                  kind: 'digest',
                  sessionId: thread.id,
                  project: thread.project,
                  updatedAt: thread.updatedAt,
                  title: thread.title,
                  text: thread.digest,
                  score: hit.score,
                }
                return [digest]
              }
              if (hit.kind === 'note') {
                const note = yield* repo.note(hit.id)
                if (note === undefined) return []
                const found: ThreadFinderMemoryHit = {
                  kind: 'note',
                  noteId: note.id,
                  project: note.project,
                  updatedAt: note.createdAt,
                  text: note.text,
                  sourceThread: note.sourceThread,
                  score: hit.score,
                }
                return [found]
              }
              // The palette waits on this: a row indexed before excerpts were kept is left to the content index instead of
              // decoding its Session log here.
              if (hit.excerpt === null) return []
              const message: ThreadFinderMemoryHit = {
                kind: 'message',
                sessionId: hit.thread,
                seq: hit.seq,
                role: hit.role,
                project: hit.project,
                updatedAt: hit.updatedAt,
                text: redact(hit.excerpt),
                score: hit.score,
              }
              return [message]
            })
          return (yield* Effect.forEach(hits, finderHit)).flat()
        }).pipe(
          Effect.catchCause(cause =>
            Effect.logWarning('memory: the finder could not search memory', cause).pipe(Effect.as<readonly ThreadFinderMemoryHit[]>([])),
          ),
        )

      /** One background reconciliation per activation: the caller that timed out starts it, later pages read the result. */
      const warmContent = (query: string) =>
        Effect.gen(function* () {
          if (yield* Ref.getAndSet(warming, true)) return
          const startedAt = yield* Clock.currentTimeMillis
          const elapsed = Effect.map(Clock.currentTimeMillis, at => at - startedAt)
          yield* FiberSet.run(
            background,
            sessions.searchContent({ query, limit: 1 }).pipe(
              Effect.andThen(Effect.flatMap(elapsed, ms => Effect.logInfo(`memory: session-content index reconciled in ${ms} ms`))),
              Effect.catchCause(cause =>
                Effect.flatMap(elapsed, ms => Effect.logWarning(`memory: session-content reconciliation failed after ${ms} ms`, cause)),
              ),
            ),
          )
        })

      const finderDeps = (own: string) =>
        Effect.map(threadRecords, (records): ThreadFinderDeps<never> => ({
          records,
          warmContent,
          searchContent: sessions.searchContent,
          searchMemory: request => finderMemoryHits(request, own),
          readDigest: sessionId =>
            repo.thread(sessionId).pipe(
              Effect.map(thread => thread?.digest ?? null),
              Effect.orElseSucceed(() => null),
            ),
        }))

      const findThreads = Effect.fn('memory find threads')(function* (caller: Caller, args: FindThreadsArgs) {
        const own = yield* projectOf(caller.session.header).pipe(
          Effect.tap(() => Effect.annotateCurrentSpan('dshx.memory.finder.caller_project_resolved', true)),
          Effect.withSpan('thread finder resolve caller project', finderSpan),
        )
        const deps = yield* finderDeps(own)
        const page = yield* ThreadFinder.find({
          deps,
          query: {
            query: args.query,
            projects: yield* projectsFilterFor(own, args.project?.trim(), isClientCaller(caller)),
            ownProject: own,
            limit: args.limit ?? 8,
            cursor: args.cursor,
            availability: args.availability,
            createdFrom: args.createdFrom,
            createdTo: args.createdTo,
            includeNotes: args.includeNotes,
          },
        })
        yield* repo.recordToolCall({
          thread: caller.id,
          tool: 'find_threads',
          results: page.hits.length + page.notes.length,
          ids: page.hits.map(hit => hit.sessionId),
        })
        return { ...page, project: own }
      })

      const relatedThreads = Effect.fn('memory related threads')(function* (
        caller: Caller,
        args: { readonly sessionId: string; readonly project?: string | undefined; readonly limit?: number | undefined },
      ) {
        const own = yield* projectOf(caller.session.header)
        const deps = yield* finderDeps(own)
        const relations = yield* ThreadFinder.related({
          deps,
          query: { sessionId: args.sessionId, projects: yield* projectsFilterFor(own, args.project?.trim(), isClientCaller(caller)), limit: args.limit ?? 8 },
        })
        yield* repo.recordToolCall({
          thread: caller.id,
          tool: 'related_threads',
          results: relations.explicit.length + relations.inferred.length,
          ids: [...relations.explicit, ...relations.inferred].map(hit => hit.sessionId),
        })
        return { ...relations, project: own }
      })

      /** One thread's message count and timestamps from its Session log, for the panel's digest detail. */
      const threadDetail = Effect.fn('memory thread detail')(function* (sessionId: string) {
        const log = yield* sessions.read(sessionId)
        const now = yield* Clock.currentTimeMillis
        const own = log.events.slice(log.inheritedEventCount)
        return {
          messages: own.filter(event => event.type === 'user/message' || event.type === 'assistant/message').length,
          createdAt: log.header.createdAt ?? own[0]?.time ?? now,
          updatedAt: own.at(-1)?.time ?? log.header.createdAt ?? now,
        }
      })

      return Recall.of({
        projectOf,
        startBlock,
        previewStartBlock,
        countBlockRequest,
        search,
        read,
        note,
        reviewNotes,
        threadRecords,
        findThreads,
        relatedThreads,
        threadDetail,
        retrievalStatus: Effect.map(embedder.retrieval, retrieval => retrieval.status),
      })
    }),
  )
}
