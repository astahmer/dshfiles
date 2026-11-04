import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Clock, Context, Duration, Effect, FileSystem, Layer, Path, Ref, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { attachmentSchema, nameSchema, referenceSchema } from './reference-schema.js'

export type Reference = typeof referenceSchema.Type

export class InvalidReferenceSource extends Schema.TaggedError<InvalidReferenceSource>()(
  'InvalidReferenceSource',
  { problem: Schema.Literals(['unrecognized', 'ref-on-directory']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-source' },
) {
  override get message(): string {
    return this.problem === 'ref-on-directory'
      ? 'Only a git reference takes a ref.'
      : 'A reference is an absolute directory path (or ~/…) or a git URL (https://, ssh://, git@host:…, file://).'
  }
}

export class NotADirectory extends Schema.TaggedError<NotADirectory>()(
  'NotADirectory',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-directory' },
) {
  override get message(): string {
    return `${this.path} is not a directory on this Host.`
  }
}

export class CloneFailed extends Schema.TaggedError<CloneFailed>()(
  'CloneFailed',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'clone-failed' },
) {
  override get message(): string {
    return `git clone failed: ${this.detail}. Check the URL, ref and your git credentials.`
  }
}

export class UnknownReference extends Schema.TaggedError<UnknownReference>()(
  'UnknownReference',
  { name: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'unknown-reference' },
) {
  override get message(): string {
    return `No reference is named ${this.name}; save it first or list the saved ones.`
  }
}

const GIT_SOURCE = /^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/u
const CLONE_TIMEOUT = Duration.minutes(5)
const MAX_STDERR_CHARACTERS = 400

/** Where git references are cloned, read per save: `$DSH_HOME/references`. */
const clonesDirectoryNow = Effect.sync(() => `${process.env.DSH_HOME?.trim() || `${homedir()}/.dsh`}/references`)

const domain = defineDomain({
  name: 'dshfiles_references',
  version: 1,
  layout: 'per-record',
  tables: {
    references: { valueSchema: zodSchemaFromEffect(referenceSchema), __key: 'references' },
    attachments: { valueSchema: zodSchemaFromEffect(attachmentSchema), __key: 'attachments' },
  },
})

/** A git URL (scheme or scp-like `user@host:path`) is cloned; an absolute or `~/` path is read where it is. */
const kindOf = (source: string): Reference['kind'] | undefined => {
  if (GIT_SOURCE.test(source)) return 'git'
  if (isAbsolute(source) || source.startsWith('~/')) return 'directory'
  return undefined
}

const promptText = (references: readonly Reference[]): string => {
  if (references.length === 0) return ''
  return [
    'Attached references: read-only material outside the working directory. Read them through their absolute paths when the task needs them; never edit them.',
    ...references.map(reference => {
      const origin = reference.kind === 'git' ? ` (clone of ${reference.source}${reference.ref === null ? '' : ` at ${reference.ref}`})` : ''
      return `- ${reference.name}: ${reference.path}${origin}${reference.description === null ? '' : ` — ${reference.description}`}`
    }),
  ].join('\n')
}

interface LibraryState {
  readonly references: ReadonlyMap<string, Reference>
  readonly attachments: ReadonlyMap<string, readonly string[]>
}

const attachedOf = (state: LibraryState, sessionId: string): Reference[] =>
  (state.attachments.get(sessionId) ?? []).flatMap(name => {
    const found = state.references.get(name)
    return found === undefined ? [] : [found]
  })

export interface ReferenceDraft {
  readonly name: string
  readonly source: string
  readonly ref?: string | undefined
  readonly description?: string | undefined
}

/** Named outside directories and git repositories, and which Sessions read them. */
export class References extends Context.Service<
  References,
  {
    readonly list: Effect.Effect<Reference[]>
    readonly get: (name: string) => Effect.Effect<Reference | undefined>
    readonly attached: (sessionId: string) => Effect.Effect<Reference[]>
    /** The same read as `attached`, for the synchronous prompt context. */
    readonly attachedNow: (sessionId: string) => Reference[]
    readonly save: (draft: ReferenceDraft) => Effect.Effect<Reference, InvalidReferenceSource | NotADirectory | CloneFailed>
    readonly remove: (name: string) => Effect.Effect<boolean>
    readonly attach: (sessionId: string, name: string) => Effect.Effect<void, UnknownReference>
    readonly detach: (sessionId: string, name: string) => Effect.Effect<boolean>
  }
>()('@dshfiles/references/References') {
  static readonly nameSchema = nameSchema
  static readonly referenceSchema = referenceSchema
  static readonly domain = domain
  static readonly kindOf = kindOf
  static readonly promptText = promptText

  static readonly layer = Layer.effect(
    References,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const opened = yield* storage.open(domain)
      const referenceRows = opened.table('references')
      const attachmentRows = opened.table('attachments')
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const persist = (write: Effect.Effect<unknown, StorageDomainWriteFailed>) =>
        write.pipe(Effect.catchTag('StorageDomainWriteFailed', error => Effect.logError('References write failed', error)))

      const state = yield* Ref.make<LibraryState>({
        references: new Map(yield* referenceRows.entries),
        attachments: new Map((yield* attachmentRows.entries).map(([sessionId, attachment]) => [sessionId, attachment.names])),
      })

      const setNames = Effect.fnUntraced(function* (sessionId: string, names: readonly string[]) {
        yield* Ref.update(state, current => {
          const attachments = new Map(current.attachments)
          if (names.length === 0) attachments.delete(sessionId)
          else attachments.set(sessionId, names)
          return { ...current, attachments }
        })
        yield* persist(names.length === 0 ? attachmentRows.delete(sessionId) : attachmentRows.put(sessionId, { sessionId, names: [...names] }))
      })

      const gitClone = (input: { readonly source: string; readonly ref: string | null; readonly path: string }) => {
        const args = ['clone', '--depth', '1', ...(input.ref === null ? [] : ['--branch', input.ref]), '--', input.source, input.path]
        const attributes = commandAttributes({ executable: 'git', args, valueFlags: ['--depth', '--branch'] })
        return Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make('git', args, { stdin: 'ignore', env: { GIT_TERMINAL_PROMPT: '0' }, forceKillAfter: Duration.seconds(1) }),
          )
          const [stderr, exitCode] = yield* Effect.all(
            [
              handle.stderr.pipe(
                Stream.decodeText(),
                Stream.runFold(
                  () => '',
                  (text, chunk) => (text + chunk).slice(-4_000),
                ),
              ),
              handle.exitCode,
              Stream.runDrain(handle.stdout),
            ],
            { concurrency: 'unbounded' },
          )
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
          if (exitCode !== 0) return yield* new CloneFailed({ detail: stderr.trim().slice(0, MAX_STDERR_CHARACTERS) || `exit ${String(exitCode)}` })
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({ duration: CLONE_TIMEOUT, orElse: () => Effect.fail(new CloneFailed({ detail: 'it did not finish within 5 minutes' })) }),
          Effect.catchTag('PlatformError', cause => Effect.fail(new CloneFailed({ detail: 'git could not be started', cause }))),
          Effect.withSpan('git clone', { kind: 'client', attributes }),
        )
      }

      /** Validates a source and readies it: a directory must exist; a git URL is shallow-cloned into `<clones>/<name>`. */
      const prepare = Effect.fn('references prepare')(function* (draft: ReferenceDraft) {
        const kind = kindOf(draft.source)
        if (kind === undefined) return yield* new InvalidReferenceSource({ problem: 'unrecognized' })
        if (kind === 'directory' && draft.ref !== undefined) return yield* new InvalidReferenceSource({ problem: 'ref-on-directory' })
        const clonesDirectory = yield* clonesDirectoryNow
        const target =
          kind === 'git' ? path.join(clonesDirectory, draft.name) : draft.source.startsWith('~/') ? path.join(homedir(), draft.source.slice(2)) : draft.source
        if (kind === 'directory') {
          const info = yield* fs.stat(target).pipe(Effect.mapError(cause => new NotADirectory({ path: target, cause })))
          if (info.type !== 'Directory') return yield* new NotADirectory({ path: target })
        } else {
          yield* fs
            .makeDirectory(clonesDirectory, { recursive: true })
            .pipe(Effect.mapError(cause => new CloneFailed({ detail: 'the clones directory could not be created', cause })))
          yield* fs
            .remove(target, { recursive: true, force: true })
            .pipe(Effect.mapError(cause => new CloneFailed({ detail: 'the earlier clone could not be removed', cause })))
          yield* gitClone({ source: draft.source, ref: draft.ref ?? null, path: target })
        }
        const reference: Reference = {
          name: draft.name,
          kind,
          source: draft.source,
          ref: draft.ref ?? null,
          path: target,
          description: draft.description ?? null,
          createdAt: yield* Clock.currentTimeMillis,
        }
        return reference
      })

      /** Cloning runs outside the write lock: a slow clone never holds back attach or detach. */
      const save = Effect.fn('references save')(function* (draft: ReferenceDraft) {
        const reference = yield* prepare(draft)
        yield* opened.withWriteLock(
          Effect.gen(function* () {
            yield* Ref.update(state, current => ({ ...current, references: new Map(current.references).set(reference.name, reference) }))
            yield* persist(referenceRows.put(reference.name, reference))
          }),
        )
        return reference
      })

      const remove = Effect.fn('references remove')(function* (name: string) {
        const current = yield* Ref.get(state)
        const existing = current.references.get(name)
        if (existing === undefined) return false
        if (existing.kind === 'git')
          yield* fs
            .remove(existing.path, { recursive: true, force: true })
            .pipe(Effect.ignore({ log: 'Warn', message: `the clone of ${name} could not be deleted` }))
        const references = new Map(current.references)
        references.delete(name)
        yield* Ref.set(state, { ...current, references })
        yield* persist(referenceRows.delete(name))
        for (const [sessionId, names] of current.attachments) {
          if (names.includes(name))
            yield* setNames(
              sessionId,
              names.filter(candidate => candidate !== name),
            )
        }
        return true
      }, opened.withWriteLock)

      const attach = Effect.fn('references attach')(function* (sessionId: string, name: string) {
        const current = yield* Ref.get(state)
        if (!current.references.has(name)) return yield* new UnknownReference({ name })
        const names = current.attachments.get(sessionId) ?? []
        if (!names.includes(name)) yield* setNames(sessionId, [...names, name])
      }, opened.withWriteLock)

      const detach = Effect.fn('references detach')(function* (sessionId: string, name: string) {
        const names = (yield* Ref.get(state)).attachments.get(sessionId) ?? []
        if (!names.includes(name)) return false
        yield* setNames(
          sessionId,
          names.filter(candidate => candidate !== name),
        )
        return true
      }, opened.withWriteLock)

      return References.of({
        list: Effect.map(Ref.get(state), current => [...current.references.values()].sort((left, right) => left.name.localeCompare(right.name))),
        get: name => Effect.map(Ref.get(state), current => current.references.get(name)),
        attached: sessionId => Effect.map(Ref.get(state), current => attachedOf(current, sessionId)),
        attachedNow: sessionId => attachedOf(Ref.getUnsafe(state), sessionId),
        save,
        remove,
        attach,
        detach,
      })
    }),
  )
}
