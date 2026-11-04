import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { Clock, Context, Deferred, Effect, FiberSet, Layer, Option, Ref, Schema } from 'effect'
import { UndoHistory, type UndoHistoryRecord } from './undo-history.js'

export const PACKAGE_ID = '@dshfiles/session-undo'

export class ThreadRunning extends Schema.TaggedError<ThreadRunning>()(
  'Running',
  { verb: Schema.Literals(['undo', 'rewind', 'redo']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'running' },
) {
  override get message(): string {
    return `This thread is still running; stop it or wait for its turn to end, then ${this.verb} again.`
  }
}

export class NothingToUndo extends Schema.TaggedError<NothingToUndo>()(
  'NothingToUndo',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'nothing-to-undo' },
) {
  override get message(): string {
    return 'There is no turn to undo in this thread since this plugin started recording it.'
  }
}

export class NothingToRedo extends Schema.TaggedError<NothingToRedo>()(
  'NothingToRedo',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'nothing-to-redo' },
) {
  override get message(): string {
    return 'There is nothing to redo: this thread is not an undo, or it ran a new turn since.'
  }
}

export class TurnNotRecorded extends Schema.TaggedError<TurnNotRecorded>()(
  'TurnNotRecorded',
  { turn: Schema.Number, recorded: Schema.Array(Schema.Number), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'turn-not-recorded' },
) {
  override get message(): string {
    return this.recorded.length === 0
      ? `Turn ${String(this.turn)} has no checkpoint: this thread has no recorded turn to rewind to.`
      : `Turn ${String(this.turn)} has no checkpoint. Rewind to one of the recorded turns: ${this.recorded.join(', ')} (see session_undo_history).`
  }
}

/** Restoring files in a folder another live thread works in would clobber that thread's edits. */
export class SharedDirectory extends Schema.TaggedError<SharedDirectory>()(
  'SharedDirectory',
  { verb: Schema.Literals(['undo', 'rewind', 'redo']), cwd: Schema.String, sessionIds: Schema.Array(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'shared-directory' },
) {
  override get message(): string {
    const threads =
      this.sessionIds.length === 1 ? `thread ${this.sessionIds[0] ?? ''}` : `${String(this.sessionIds.length)} threads (${this.sessionIds.join(', ')})`
    return `Another live ${threads} works in ${this.cwd}; restoring files there would overwrite its edits. Archive or finish that thread, or give this thread its own workspace, then ${this.verb} again. To ${this.verb} anyway, pass allowSharedDirectory: true (the UI's "${this.verb === 'redo' ? 'Redo' : 'Rewind'} anyway").`
  }
}

export class LiveThreadsUnavailable extends Schema.TaggedError<LiveThreadsUnavailable>()(
  'LiveThreadsUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'shared-directory-unknown' },
) {
  override get message(): string {
    return 'The Host could not list its live threads, so it cannot tell whether another thread works in this folder. Retry; to restore the files anyway, pass allowSharedDirectory: true (the UI\'s "anyway" button).'
  }
}

export class FilesRestoreFailed extends Schema.TaggedError<FilesRestoreFailed>()(
  'FilesRestoreFailed',
  { provider: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'files-restore-failed' },
) {
  override get message(): string {
    return `The workspace files could not be restored through ${this.provider}. Check the workspace for conflicts, then retry.`
  }
}

export class SessionForkFailed extends Schema.TaggedError<SessionForkFailed>()(
  'SessionForkFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-fork-failed' },
) {
  override get message(): string {
    return 'The conversation could not be forked before the turn, so its files were put back. Retry, or restart DSH if it keeps failing.'
  }
}

export class UndoHistoryUnavailable extends Schema.TaggedError<UndoHistoryUnavailable>()(
  'UndoHistoryUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'undo-history-unavailable' },
) {
  override get message(): string {
    return 'The undo history could not be read or saved; restart DSH and retry.'
  }
}

export interface FileSnapshot {
  readonly provider: string
  readonly snapshot: string
}

/** Workspace file snapshots, taken and restored by the version-control provider that claims the folder. */
export class UndoFiles extends Context.Service<
  UndoFiles,
  {
    /** None when no provider claims the folder, or its snapshot failed. */
    readonly snapshot: (cwd: string) => Effect.Effect<Option.Option<FileSnapshot>>
    /** Restore a snapshot and return one of the files as they were just before. */
    readonly restore: (input: { readonly provider: string; readonly cwd: string; readonly snapshot: string }) => Effect.Effect<string, FilesRestoreFailed>
  }
>()('@dshfiles/session-undo/UndoFiles') {
  static readonly layer = Layer.effect(
    UndoFiles,
    Effect.gen(function* () {
      const vcs = yield* VcsProviderService
      const apis = yield* HostApis
      return UndoFiles.of({
        snapshot: Effect.fn('session undo files snapshot')(function* (cwd: string) {
          const provider = yield* vcs.resolve({ path: cwd, callerPackageId: PACKAGE_ID })
          if (Option.isNone(provider)) return Option.none()
          return yield* provider.value.client.snapshot({ path: cwd }).pipe(
            Effect.map(taken => Option.some({ provider: provider.value.owner, snapshot: taken.snapshot })),
            Effect.catch(error => Effect.as(Effect.logWarning('session-undo: the turn snapshot failed; it is recorded without files', error), Option.none())),
          )
        }),
        restore: Effect.fn('session undo files restore')(function* (input: { readonly provider: string; readonly cwd: string; readonly snapshot: string }) {
          const restored = yield* apis
            .client(VcsProviders.contract(input.provider), PACKAGE_ID)
            .restore({ path: input.cwd, snapshot: input.snapshot })
            .pipe(Effect.mapError(cause => new FilesRestoreFailed({ provider: input.provider, cause })))
          return restored.previous
        }),
      })
    }),
  )
}

/** One live, unarchived thread the Host knows of, for the shared-directory guard. */
export interface LiveThread {
  readonly sessionId: string
  readonly cwd: string
  readonly parentSessionId: string | null
}

const inside = (child: string, parent: string): boolean => {
  const trimmed = parent.endsWith('/') ? parent : `${parent}/`
  return child === parent || child.startsWith(trimmed)
}

/**
 * The live threads whose folder overlaps `cwd` (the same folder, or one inside the other), apart from the rewound
 * thread itself, the threads named in `except`, and the subagents it started: a rewind is meant to roll their edits
 * back with its own.
 */
export const sharingThreads = (input: {
  readonly sessionId: string
  readonly cwd: string
  readonly except: readonly string[]
  readonly threads: readonly LiveThread[]
}): readonly string[] => {
  const parents = new Map(input.threads.map(thread => [thread.sessionId, thread.parentSessionId]))
  const descendsFromSelf = (sessionId: string): boolean => {
    const seen = new Set<string>()
    let current = parents.get(sessionId) ?? null
    while (current !== null && !seen.has(current)) {
      if (current === input.sessionId) return true
      seen.add(current)
      current = parents.get(current) ?? null
    }
    return false
  }
  const excluded = new Set([input.sessionId, ...input.except])
  return input.threads
    .filter(
      thread => !excluded.has(thread.sessionId) && (inside(thread.cwd, input.cwd) || inside(input.cwd, thread.cwd)) && !descendsFromSelf(thread.sessionId),
    )
    .map(thread => thread.sessionId)
}

/** The Host Session controller and workspace registry operations an undo needs. */
export class UndoSessions extends Context.Service<
  UndoSessions,
  {
    readonly fork: (input: { readonly sessionId: string; readonly atSeq: number }) => Effect.Effect<string, SessionForkFailed>
    /** Best effort: the fork keeps the source thread's model when the source has one. */
    readonly copyModel: (input: { readonly from: string; readonly to: string }) => Effect.Effect<void>
    /** Best effort, like every archive change of an undo. */
    readonly archive: (sessionId: string) => Effect.Effect<void>
    readonly unarchive: (sessionId: string) => Effect.Effect<void>
    /** Live, unarchived threads with a folder. An unreadable list fails, so the guard refuses rather than guessing. */
    readonly liveThreads: Effect.Effect<readonly LiveThread[], LiveThreadsUnavailable>
  }
>()('@dshfiles/session-undo/UndoSessions') {}

export interface RewindOptions {
  /** The turn to rewind to (its start); the newest recorded turn when omitted. */
  readonly turn?: number | undefined
  /** Restore files even when another live thread works in the same folder. */
  readonly allowSharedDirectory?: boolean | undefined
}

export interface RewindResult {
  readonly sessionId: string
  readonly filesRestored: boolean
  readonly prompt: string
  readonly turn: number
  /** How many recorded turns the rewind removed from the conversation, the rewound one included. */
  readonly turnsRewound: number
}

/**
 * Undo forks the conversation back before the last turn and restores that turn's file snapshot; redo restores the
 * files the undo replaced and brings the original thread back. Each turn's snapshot finishes before any of its tool
 * calls run (`whenReady`), so a checkpoint never already contains the turn's own edits.
 */
export class SessionUndo extends Context.Service<
  SessionUndo,
  {
    /** Start taking the turn's checkpoint without waiting for it; `whenReady` waits. */
    readonly turnStarted: (input: {
      readonly sessionId: string
      readonly turn: number
      readonly forkAtSeq: number
      readonly cwd: string
    }) => Effect.Effect<void>
    /** Undo and redo refuse a thread between its turn start and turn end. */
    readonly turnRunning: (sessionId: string) => Effect.Effect<void>
    readonly turnEnded: (sessionId: string) => Effect.Effect<void>
    readonly promptEntered: (input: { readonly sessionId: string; readonly turn: number; readonly text: string }) => Effect.Effect<void, UndoHistoryUnavailable>
    /** Resolves once the thread's latest checkpoint is stored, whether or not taking it succeeded. */
    readonly whenReady: (sessionId: string) => Effect.Effect<void>
    readonly history: (sessionId: string) => Effect.Effect<
      {
        readonly checkpoints: Array<{ readonly turn: number; readonly prompt: string; readonly at: number; readonly files: boolean }>
        readonly redoTo: string | null
      },
      UndoHistoryUnavailable
    >
    /** Rewind to the start of a recorded turn (the newest by default): an undo of that turn and every later one. */
    readonly undo: (
      sessionId: string,
      options?: RewindOptions,
    ) => Effect.Effect<
      RewindResult,
      | ThreadRunning
      | NothingToUndo
      | TurnNotRecorded
      | SharedDirectory
      | LiveThreadsUnavailable
      | FilesRestoreFailed
      | SessionForkFailed
      | UndoHistoryUnavailable
    >
    readonly redo: (
      sessionId: string,
      options?: Pick<RewindOptions, 'allowSharedDirectory'>,
    ) => Effect.Effect<
      { readonly sessionId: string; readonly filesRestored: boolean },
      ThreadRunning | NothingToRedo | SharedDirectory | LiveThreadsUnavailable | FilesRestoreFailed | UndoHistoryUnavailable
    >
  }
>()('@dshfiles/session-undo/SessionUndo') {
  static readonly layer = Layer.effect(
    SessionUndo,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const files = yield* UndoFiles
      const sessions = yield* UndoSessions
      const domain = yield* storage.open(UndoHistory.domain)
      const table = domain.table('history')
      const running = yield* Ref.make<ReadonlySet<string>>(new Set())
      const prompts = yield* Ref.make<ReadonlyMap<string, { readonly turn: number; readonly text: string }>>(new Map())
      const ready = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<void>>>(new Map())
      const checkpoints = yield* FiberSet.make()

      const unavailable = (cause: unknown) => new UndoHistoryUnavailable({ cause })
      const record = (sessionId: string) =>
        table.get(sessionId).pipe(Effect.map(Option.getOrElse(() => UndoHistory.empty(sessionId))), Effect.mapError(unavailable))
      const store = (sessionId: string, value: UndoHistoryRecord) => table.put(sessionId, value).pipe(Effect.mapError(unavailable))

      const refuseWhileRunning = (sessionId: string, verb: ThreadRunning['verb']) =>
        Effect.flatMap(Ref.get(running), current => (current.has(sessionId) ? Effect.fail(new ThreadRunning({ verb })) : Effect.void))

      const turnStarted = Effect.fn('session undo turn start')(function* (input: {
        readonly sessionId: string
        readonly turn: number
        readonly forkAtSeq: number
        readonly cwd: string
      }) {
        const previous = (yield* Ref.get(ready)).get(input.sessionId)
        const done = yield* Deferred.make<void>()
        yield* Ref.update(ready, current => new Map(current).set(input.sessionId, done))
        const checkpoint = Effect.gen(function* () {
          if (previous !== undefined) yield* Deferred.await(previous)
          const taken = yield* files.snapshot(input.cwd)
          const prompt = (yield* Ref.get(prompts)).get(input.sessionId)
          const at = yield* Clock.currentTimeMillis
          yield* domain.withWriteLock(
            Effect.flatMap(record(input.sessionId), current =>
              store(
                input.sessionId,
                UndoHistory.withCheckpoint(current, {
                  turn: input.turn,
                  forkAtSeq: input.forkAtSeq,
                  cwd: input.cwd,
                  provider: Option.getOrNull(Option.map(taken, snapshot => snapshot.provider)),
                  snapshot: Option.getOrNull(Option.map(taken, snapshot => snapshot.snapshot)),
                  prompt: prompt?.turn === input.turn ? prompt.text : '',
                  at,
                }),
              ),
            ),
          )
        }).pipe(
          Effect.catchTag('UndoHistoryUnavailable', error => Effect.logWarning('session-undo: the turn checkpoint was not stored', error)),
          Effect.ensuring(Deferred.succeed(done, undefined)),
          Effect.withSpan('session undo checkpoint'),
        )
        yield* FiberSet.run(checkpoints, checkpoint)
      })

      const promptEntered = Effect.fn('session undo prompt record')(function* (input: {
        readonly sessionId: string
        readonly turn: number
        readonly text: string
      }) {
        if ((yield* Ref.get(prompts)).get(input.sessionId)?.turn === input.turn) return
        yield* Ref.update(prompts, current => new Map(current).set(input.sessionId, { turn: input.turn, text: input.text }))
        yield* domain.withWriteLock(
          Effect.gen(function* () {
            const current = yield* table.get(input.sessionId).pipe(Effect.mapError(unavailable))
            if (Option.isNone(current) || !current.value.checkpoints.some(checkpoint => checkpoint.turn === input.turn)) return
            yield* store(input.sessionId, UndoHistory.withPrompt(current.value, input.turn, input.text))
          }),
        )
      })

      const whenReady = (sessionId: string) =>
        Effect.flatMap(Ref.get(ready), current => {
          const pending = current.get(sessionId)
          return pending === undefined ? Effect.void : Deferred.await(pending)
        })

      const history = Effect.fn('session undo history read')(function* (sessionId: string) {
        const current = yield* record(sessionId)
        return {
          checkpoints: current.checkpoints.map(checkpoint => ({
            turn: checkpoint.turn,
            prompt: checkpoint.prompt,
            at: checkpoint.at,
            files: checkpoint.snapshot !== null,
          })),
          redoTo: current.redo?.sessionId ?? null,
        }
      })

      /** Restoring files is the only step that can touch another thread's work, so only a file restore is guarded. */
      const refuseSharedDirectory = Effect.fn('session undo shared directory check')(function* (input: {
        readonly sessionId: string
        readonly cwd: string
        readonly except: readonly string[]
        readonly verb: SharedDirectory['verb']
        readonly allow: boolean | undefined
      }) {
        if (input.allow === true) return
        const sharing = sharingThreads({ ...input, threads: yield* sessions.liveThreads })
        if (sharing.length > 0) return yield* new SharedDirectory({ verb: input.verb, cwd: input.cwd, sessionIds: sharing })
      })

      const undo = Effect.fn('session undo')(function* (sessionId: string, options?: RewindOptions) {
        const verb = options?.turn === undefined ? 'undo' : 'rewind'
        yield* refuseWhileRunning(sessionId, verb)
        const source = yield* record(sessionId)
        if (source.checkpoints.length === 0) return yield* new NothingToUndo({})
        const index = UndoHistory.indexOf(source, options?.turn)
        const undone = source.checkpoints[index]
        if (undone === undefined)
          return yield* new TurnNotRecorded({ turn: options?.turn ?? -1, recorded: source.checkpoints.map(checkpoint => checkpoint.turn) })
        const provider = undone.provider
        if (provider !== null && undone.snapshot !== null)
          yield* refuseSharedDirectory({ sessionId, cwd: undone.cwd, except: [], verb, allow: options?.allowSharedDirectory })
        const previous = provider === null || undone.snapshot === null ? null : yield* files.restore({ provider, cwd: undone.cwd, snapshot: undone.snapshot })
        const forkId = yield* sessions
          .fork({ sessionId, atSeq: undone.forkAtSeq })
          .pipe(
            Effect.tapError(() =>
              previous === null || provider === null ? Effect.void : Effect.ignore(files.restore({ provider, cwd: undone.cwd, snapshot: previous })),
            ),
          )
        yield* store(forkId, UndoHistory.forked({ source, forkId, undone, index, previous }))
        yield* sessions.copyModel({ from: sessionId, to: forkId })
        yield* sessions.archive(sessionId)
        return {
          sessionId: forkId,
          filesRestored: previous !== null,
          prompt: undone.prompt,
          turn: undone.turn,
          turnsRewound: source.checkpoints.length - index,
        }
      })

      const redo = Effect.fn('session redo')(function* (sessionId: string, options?: Pick<RewindOptions, 'allowSharedDirectory'>) {
        const current = yield* record(sessionId)
        const back = current.redo
        if (back === null) return yield* new NothingToRedo({})
        yield* refuseWhileRunning(sessionId, 'redo')
        if (back.provider !== null && back.snapshot !== null) {
          yield* refuseSharedDirectory({ sessionId, cwd: back.cwd, except: [back.sessionId], verb: 'redo', allow: options?.allowSharedDirectory })
          yield* files.restore({ provider: back.provider, cwd: back.cwd, snapshot: back.snapshot })
        }
        yield* store(sessionId, { ...current, redo: null })
        yield* sessions.unarchive(back.sessionId)
        yield* sessions.archive(sessionId)
        return { sessionId: back.sessionId, filesRestored: back.snapshot !== null }
      })

      return SessionUndo.of({
        turnStarted,
        turnRunning: sessionId => Ref.update(running, current => new Set(current).add(sessionId)),
        turnEnded: sessionId =>
          Ref.update(running, current => {
            const next = new Set(current)
            next.delete(sessionId)
            return next
          }),
        promptEntered,
        whenReady,
        history,
        undo,
        redo,
      })
    }),
  )
}
