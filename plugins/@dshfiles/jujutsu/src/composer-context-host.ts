import { Cache, Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from 'effect'
import type { ComposerBase } from './composer-context-api.js'
import {
  COMPOSER_BASE_TEMPLATE,
  COMPOSER_BOOKMARKS_TEMPLATE,
  COMPOSER_FILE_TEMPLATE,
  COMPOSER_HEAD_TEMPLATE,
  COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE,
  COMPOSER_REMOTE_BOOKMARK_LIST_TEMPLATE,
  COMPOSER_WORKSPACE_TEMPLATE,
  ComposerContextModel,
} from './composer-context-core.js'
import { JujutsuOutputModel, JujutsuPathModel } from './core.js'
import { WorkspaceNotFound, type JjRunError } from './errors.js'
import { JujutsuCommands, type JjRunResult } from './jujutsu-commands.js'

const headSchema = Schema.Struct({
  changeId: Schema.String.check(Schema.isMaxLength(64)),
  commitId: Schema.String.check(Schema.isMaxLength(64)),
  bookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(32)),
  empty: Schema.Boolean,
  conflict: Schema.Boolean,
  description: Schema.String.check(Schema.isMaxLength(20_000)),
})

const fileRowSchema = Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(2048)), status: Schema.String.check(Schema.isMaxLength(32)) })
const baseRevisionIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u))
const nameListSchema = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(64))
const baseRevisionRowSchema = Schema.Struct({ commitId: baseRevisionIdSchema, bookmarks: nameListSchema })
const remoteBookmarkListSchema = Schema.Array(
  Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(256)), remote: Schema.String.check(Schema.isMaxLength(256)) }),
).check(Schema.isMaxLength(200))
const remoteBookmarkRowSchema = Schema.String.check(Schema.isMaxLength(513))
const bookmarkNameSchema = Schema.String.check(Schema.isMaxLength(256))
const workspaceNameSchema = Schema.String.check(Schema.isMaxLength(128))
const MAX_FILES = 500
const MAX_READS = 256
const MAX_WORKSPACE_ROOTS = 256

/** A Session's cwd keeps its workspace root, so the composer resolves it once instead of spawning jj on every read. */
const WORKSPACE_ROOT_TTL = Duration.minutes(1)

/**
 * The composer bar re-reads its JJ context on every render burst; one snapshotting read per argument set serves them
 * all for two seconds. `--ignore-working-copy` reads are already answered per operation head by jj-cli.
 */
const SNAPSHOT_READ_TTL = Duration.seconds(2)

interface ComposerRead {
  readonly cwd: string
  readonly args: readonly string[]
  readonly outputLimit: number
}

const baseLabel = (base: ComposerBase, targetBookmarks: readonly string[]): string => {
  if (base.kind === 'bookmark') return base.name
  if (base.kind === 'remoteBookmark') return base.name + '@' + base.remote
  if (base.kind === 'trunk') return targetBookmarks[0] ?? 'trunk()'
  return '@-'
}

/** A failed optional read is an absent section of the composer bar, never a failed context. */
const optional = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.option(effect)

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const commands = yield* JujutsuCommands

  const reads = yield* Cache.makeWith((read: ComposerRead) => commands.run({ cwd: read.cwd, args: read.args, outputLimit: read.outputLimit }), {
    capacity: MAX_READS,
    timeToLive: exit => (Exit.isSuccess(exit) ? SNAPSHOT_READ_TTL : Duration.zero),
  })

  const run = (read: ComposerRead): Effect.Effect<JjRunResult, JjRunError> =>
    read.args[0] === '--ignore-working-copy' ? commands.run({ cwd: read.cwd, args: read.args, outputLimit: read.outputLimit }) : Cache.get(reads, read)

  const resolveRoot = (canonical: string) =>
    run({ cwd: canonical, args: ['workspace', 'root'], outputLimit: 8_000 }).pipe(
      Effect.flatMap(result => {
        const root = result.stdout.trim()
        if (result.truncated || root.length === 0 || root.includes('\n') || !path.isAbsolute(root)) return Effect.succeedNone
        return fileSystem.realPath(root).pipe(Effect.map(Option.some))
      }),
      Effect.orElseSucceed(() => Option.none<string>()),
    )

  const roots = yield* Cache.makeWith(resolveRoot, {
    capacity: MAX_WORKSPACE_ROOTS,
    timeToLive: exit => (Exit.isSuccess(exit) && Option.isSome(exit.value) ? WORKSPACE_ROOT_TTL : Duration.zero),
  })

  /** Canonical workspace root for a Session cwd, or none when the directory is not inside a JJ workspace. */
  const workspaceRoot = Effect.fnUntraced(function* (cwd: string) {
    const canonical = yield* Effect.fromResult(JujutsuPathModel.validatedRepositoryPath(cwd)).pipe(Effect.flatMap(fileSystem.realPath), Effect.option)
    if (Option.isNone(canonical)) return Option.none<string>()
    const known = yield* Cache.get(roots, canonical.value)
    if (Option.isNone(known)) return known
    // A forgotten workspace takes its directory with it; resolving the root again proves it still exists.
    const stillThere = yield* fileSystem.realPath(known.value).pipe(Effect.option)
    if (Option.isSome(stillThere)) return stillThere
    yield* Cache.invalidate(roots, canonical.value)
    return yield* Cache.get(roots, canonical.value)
  })

  const context = Effect.fn('jujutsu composer context')(function* (input: { readonly cwd: string; readonly base: ComposerBase }) {
    const located = yield* workspaceRoot(input.cwd)
    if (Option.isNone(located)) return { repository: null }
    const root = located.value
    const headResult = yield* run({ cwd: root, args: ['log', '--no-graph', '--revisions', '@', '--template', COMPOSER_HEAD_TEMPLATE], outputLimit: 64_000 })
    const head = (yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(headResult.stdout, headSchema)))[0]
    if (head === undefined) return { repository: null }
    const read = (args: readonly string[], outputLimit: number) => run({ cwd: root, args: ['--ignore-working-copy', ...args], outputLimit })
    const range = ComposerContextModel.composerDiffRange(input.base)
    const [nearest, base, stat, files, localBookmarks, remoteBookmarks, workspaces] = yield* Effect.all(
      [
        read(['log', '--no-graph', '--revisions', 'heads(::@- & bookmarks())', '--limit', '2', '--template', COMPOSER_BOOKMARKS_TEMPLATE], 16_000),
        optional(
          read(
            ['log', '--no-graph', '--revisions', ComposerContextModel.composerBaseTarget(input.base), '--limit', '2', '--template', COMPOSER_BASE_TEMPLATE],
            64_000,
          ),
        ),
        optional(read(['diff', ...range, '--stat'], 256_000)),
        optional(read(['diff', ...range, '--template', COMPOSER_FILE_TEMPLATE], 512_000)),
        optional(read(['bookmark', 'list', '--template', COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE], 32_000)),
        optional(read(['log', '--no-graph', '--revisions', 'remote_bookmarks()', '--template', COMPOSER_REMOTE_BOOKMARK_LIST_TEMPLATE], 32_000)),
        optional(read(['workspace', 'list', '--template', COMPOSER_WORKSPACE_TEMPLATE], 16_000)),
      ],
      { concurrency: 'unbounded' },
    )
    const rowsOf = <S extends Schema.ConstraintDecoder<unknown>>(output: Option.Option<JjRunResult>, schema: S) =>
      Option.isNone(output) ? Effect.succeed([]) : Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(output.value), schema))
    const nearestBookmarks = (yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(nearest), nameListSchema))).flat()
    const baseRows = yield* rowsOf(base, baseRevisionRowSchema)
    const targetBookmarks = baseRows[0]?.bookmarks ?? []
    const resolvedBaseCommitId = Option.isNone(base) || base.value.truncated || baseRows.length !== 1 ? undefined : baseRows[0]?.commitId
    const readRevisionCount = (revset: string) =>
      read(['log', '--no-graph', '--revisions', revset, '--template', '"x"'], 1_000_000).pipe(
        Effect.map(result => ComposerContextModel.parseRevisionCount(result.stdout, result.truncated)),
        Effect.orElseSucceed(() => null),
      )
    const revisionCounts =
      resolvedBaseCommitId === undefined
        ? null
        : yield* Effect.gen(function* () {
            const revsets = ComposerContextModel.revisionCountRevsets(resolvedBaseCommitId)
            const [ahead, behind] = yield* Effect.all([readRevisionCount(revsets.ahead), readRevisionCount(revsets.behind)], { concurrency: 'unbounded' })
            return ahead === null || behind === null ? null : { ahead, behind }
          })
    const fileRows = yield* rowsOf(files, fileRowSchema)
    const bookmarkNames = yield* rowsOf(localBookmarks, bookmarkNameSchema)
    // The remote-bookmark template emits plain `name@remote` lines, not JSON records.
    const remoteBookmarkRows = Option.isNone(remoteBookmarks)
      ? []
      : yield* Effect.fromResult(JujutsuOutputModel.parseLines(JujutsuOutputModel.completeLines(remoteBookmarks.value), remoteBookmarkRowSchema))
    const remoteBookmarkNames = remoteBookmarkRows.flatMap(value => {
      const separator = value.lastIndexOf('@')
      if (separator < 1 || separator === value.length - 1) return []
      return [{ name: value.slice(0, separator), remote: value.slice(separator + 1) }]
    })
    const workspaceNames = yield* rowsOf(workspaces, workspaceNameSchema)
    const remoteBookmarkList = yield* Schema.decodeUnknownEffect(remoteBookmarkListSchema)(
      [...new Map(remoteBookmarkNames.map(bookmark => [bookmark.name + '@' + bookmark.remote, bookmark])).values()].slice(0, 200),
    ).pipe(Effect.orDie)
    return {
      repository: {
        root,
        // Two workspaces sharing one @ commit both match; the first is the usual single match.
        workspace: workspaceNames[0] ?? null,
        changeId: head.changeId,
        commitId: head.commitId,
        description: head.description.slice(0, 500),
        empty: head.empty,
        conflict: head.conflict,
        bookmarks: head.bookmarks,
        nearestBookmarks: [...new Set(nearestBookmarks)].slice(0, 32),
        base: { label: baseLabel(input.base, targetBookmarks), found: resolvedBaseCommitId !== undefined },
        revisionCounts,
        totals: Option.isNone(stat) || stat.value.truncated ? null : ComposerContextModel.parseStatTotals(stat.value.stdout),
        files: fileRows.slice(0, MAX_FILES).map(row => ({ path: row.path, status: JujutsuOutputModel.fileStatusLetter(row.status) })),
        filesTruncated: Option.isNone(files) || files.value.truncated || fileRows.length > MAX_FILES,
        localBookmarks: bookmarkNames.slice(0, 200),
        remoteBookmarks: remoteBookmarkList,
      },
    }
  })

  const diff = Effect.fn('jujutsu composer diff')(function* (input: { readonly cwd: string; readonly base: ComposerBase }) {
    const located = yield* workspaceRoot(input.cwd)
    if (Option.isNone(located)) return yield* new WorkspaceNotFound({})
    const patch = yield* run({ cwd: located.value, args: ['diff', ...ComposerContextModel.composerDiffRange(input.base), '--git'], outputLimit: 1_160_000 })
    return {
      patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
      truncated: patch.truncated,
      files: ComposerContextModel.parsePatchFileStats(patch.stdout).slice(0, 2000),
    }
  })

  return { context, diff }
})

/** Read-only JJ context for a Session's composer: one snapshotting read of `@`, then reads that skip the working copy. */
export class ComposerContext extends Context.Service<ComposerContext>()('@dshfiles/jujutsu/ComposerContext', { make }) {
  static readonly layer = Layer.effect(ComposerContext, ComposerContext.make)
}
