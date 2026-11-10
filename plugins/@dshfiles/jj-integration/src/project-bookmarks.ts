import { JjViewReads } from '@dshfiles/jj-cli'
import { loadProjectConfig } from '@dshfiles/workspace-folder-picker/project-config'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Ref, Schedule, Stream } from 'effect'
import { HostCallFailed } from './errors.js'
import { JjSettings } from './jj-settings.js'
import { RepositoryBookmarks, type JjIntegrationSettings, type ProjectBookmarkSource } from './settings.js'

/** How long a detected default branch is trusted; a fetch rarely changes which branch origin calls its default. */
const DETECTION_TTL_MS = 2 * 60_000

/**
 * A choice is written against the settings revision it read. A concurrent save (another window, an agent) conflicts;
 * the snapshot refreshes when the Host announces that save, so each retry waits a moment before reading it again.
 */
const CHOICE_CONFLICT_RETRY = Schedule.spaced('50 millis').pipe(Schedule.upTo({ duration: '5 seconds' }))

/** One project's main branch, and every layer that could have decided it, for the settings UI and agent tools. */
export interface ResolvedProjectBookmark {
  readonly repositoryRoot: string
  readonly bookmark: string
  readonly source: ProjectBookmarkSource
  /** The profile's per-project choice, or null when none is set. */
  readonly override: string | null
  /** What `dsh.project.json` declares, or null. */
  readonly declared: string | null
  /** The branch origin names as its default and that exists here, or null. */
  readonly detected: string | null
  /** The global setting every project without a choice of its own falls back to. */
  readonly fallback: string
}

/**
 * `ref: refs/remotes/origin/main` (the symbolic `origin/HEAD` file `git clone` writes) or `main@origin` (the `trunk()`
 * alias `jj git clone` records) both name origin's default branch `main`.
 */
const parseDetectedName = (text: string, form: 'git-origin-head' | 'jj-trunk-alias'): string | null => {
  const value = text.trim().replace(/^"(.*)"$/u, '$1')
  const name = (form === 'git-origin-head' ? /^ref:\s*refs\/remotes\/origin\/(\S+)$/u : /^([^@\s()|&~:]+)@origin$/u).exec(value)?.[1]
  return name === undefined || name === 'HEAD' ? null : RepositoryBookmarks.usableName(name)
}

/** Whether `packed-refs` lists `ref`: one `<object id> <ref>` line per packed ref. */
const packedRefsList = (packedRefs: string, ref: string): boolean => packedRefs.split('\n').some(line => line.trimEnd().endsWith(` ${ref}`))

/**
 * One tick per settings change that can move any project's main branch (the global fallback or a per-project choice),
 * none for the current value: the Host's cached repository and thread views compare against the old branch until then.
 */
const mainBranchChanges = <E, R>(changes: Stream.Stream<JjIntegrationSettings, E, R>): Stream.Stream<void, E, R> =>
  changes.pipe(
    Stream.map(current => JSON.stringify([current.bookmark, current.repositoryBookmarks])),
    Stream.changes,
    Stream.drop(1),
    Stream.as(undefined),
  )

export const ProjectBookmarkModel = { parseDetectedName, packedRefsList, mainBranchChanges } as const

const make = Effect.gen(function* () {
  const settings = yield* JjSettings
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const jjReads = yield* JjViewReads
  const detections = yield* Ref.make<ReadonlyMap<string, { readonly at: number; readonly name: string | null }>>(new Map())

  const readText = (file: string) => fileSystem.readFileString(file).pipe(Effect.option)
  const exists = (file: string) => fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false))

  /**
   * A linked worktree's git directory (`.git/worktrees/<name>`) holds only its own HEAD and index; refs, `packed-refs`
   * and `config` live in the common directory its `commondir` file names.
   */
  const commonDirectoryOf = Effect.fnUntraced(function* (gitDirectory: string) {
    const common = yield* readText(path.join(gitDirectory, 'commondir'))
    return Option.isSome(common) && common.value.trim().length > 0 ? path.resolve(gitDirectory, common.value.trim()) : gitDirectory
  })

  /**
   * The git directory holding a repository's refs: its own `.git` (git, or jj colocated; a `gitdir:` file is followed to
   * its common directory), else the store a jj repository names in `.jj/repo/store/git_target`. Detection reads these
   * files directly: spawning git beside jj while it writes refs is slower and contends for the same ref files.
   */
  const gitDirectoryOf = Effect.fnUntraced(function* (repositoryRoot: string) {
    const dotGit = path.join(repositoryRoot, '.git')
    const info = yield* fileSystem.stat(dotGit).pipe(Effect.option)
    if (Option.isSome(info) && info.value.type === 'Directory') return Option.some(dotGit)
    if (Option.isSome(info)) {
      const pointer = /^gitdir:\s*(.+)$/mu.exec(Option.getOrElse(yield* readText(dotGit), () => ''))?.[1]
      return pointer === undefined ? Option.none<string>() : Option.some(yield* commonDirectoryOf(path.resolve(repositoryRoot, pointer.trim())))
    }
    const storeDirectory = path.join(repositoryRoot, '.jj', 'repo', 'store')
    const target = yield* readText(path.join(storeDirectory, 'git_target'))
    return Option.map(target, value => path.resolve(storeDirectory, value.trim()))
  })

  /** A loose ref file or a `packed-refs` line: either is how git stores a branch. */
  const refExists = Effect.fnUntraced(function* (gitDirectory: string, ref: string) {
    if (yield* exists(path.join(gitDirectory, ...ref.split('/')))) return true
    return packedRefsList(
      Option.getOrElse(yield* readText(path.join(gitDirectory, 'packed-refs')), () => ''),
      ref,
    )
  })

  /**
   * `jj git clone` records origin's default branch only as the `trunk()` alias of its per-repository config, which lives
   * outside the repository. Reading it costs a jj process, so it is asked only of a jj repository with an origin, and
   * only at the repository level: a user-wide `trunk()` alias is a revset preference, not what origin calls its default.
   * `jj config` loads no operation, so it never imports or writes git refs beside a running `jj workspace add`.
   */
  const jjTrunkAlias = Effect.fnUntraced(function* (repositoryRoot: string, gitDirectory: string) {
    if (!(yield* exists(path.join(repositoryRoot, '.jj')))) return null
    const config = Option.getOrElse(yield* readText(path.join(gitDirectory, 'config')), () => '')
    if (!/^\s*\[remote "origin"\]/mu.test(config)) return null
    const args = ['--ignore-working-copy', 'config', 'list', '--repo', '-T', 'value ++ "\\n"', 'revset-aliases."trunk()"']
    const alias = yield* jjReads.read({ args, cwd: repositoryRoot }).pipe(
      Effect.map(output => (output.exitCode === 0 ? output.stdout : '')),
      Effect.orElseSucceed(() => ''),
    )
    return parseDetectedName(alias, 'jj-trunk-alias')
  })

  /**
   * origin's default branch (git's `origin/HEAD`, else jj's `trunk()` alias), when a local branch of that name exists:
   * status, cleanup's unlanded check and the graph compare against the local bookmark, so a branch only on origin would
   * make every revision look unlanded. Such a project keeps the global setting until the branch is fetched and tracked.
   */
  const detectUncached = Effect.fnUntraced(function* (repositoryRoot: string) {
    const gitDirectory = yield* gitDirectoryOf(repositoryRoot)
    if (Option.isNone(gitDirectory)) return null
    const head = yield* readText(path.join(gitDirectory.value, 'refs', 'remotes', 'origin', 'HEAD'))
    const name = (Option.isSome(head) ? parseDetectedName(head.value, 'git-origin-head') : null) ?? (yield* jjTrunkAlias(repositoryRoot, gitDirectory.value))
    if (name === null) return null
    return (yield* refExists(gitDirectory.value, `refs/heads/${name}`)) ? name : null
  })

  const detect = Effect.fnUntraced(function* (repositoryRoot: string) {
    const now = yield* Clock.currentTimeMillis
    const cached = (yield* Ref.get(detections)).get(repositoryRoot)
    if (cached !== undefined && now - cached.at < DETECTION_TTL_MS) return cached.name
    const name = yield* detectUncached(repositoryRoot)
    yield* Ref.update(detections, current => new Map(current).set(repositoryRoot, { at: now, name }))
    return name
  })

  /**
   * One repository root (the owning checkout, never one of its thread workspaces) through every layer. `layers: 'all'`
   * reads each layer even when a stronger one decides, so Settings can show what each would choose; `'deciding'` stops
   * at the first that decides, which is all the many rebase and comparison callers need.
   */
  const read = Effect.fnUntraced(function* (repositoryRoot: string, layers: 'all' | 'deciding') {
    const current = yield* settings.get
    const override = RepositoryBookmarks.overrideFor({ repositoryRoot, entries: current.repositoryBookmarks })
    const declared =
      layers === 'all' || override === null ? RepositoryBookmarks.usableName((yield* loadProjectConfig(fileSystem, repositoryRoot)).config?.bookmark) : null
    const detected = layers === 'all' || (override === null && declared === null) ? yield* detect(repositoryRoot) : null
    const chosen = RepositoryBookmarks.resolve({ override, declared, detected, fallback: current.bookmark })
    return { repositoryRoot, ...chosen, override, declared, detected, fallback: current.bookmark } satisfies ResolvedProjectBookmark
  })

  const resolve = Effect.fn('project bookmark resolve')((repositoryRoot: string) => read(repositoryRoot, 'deciding'))
  const describe = Effect.fn('project bookmark describe')((repositoryRoot: string) => read(repositoryRoot, 'all'))

  /** Settings › Projects and `jj_set_project_bookmark`: one project's choice, without dropping another's saved meanwhile. */
  const choose = Effect.fn('project bookmark choose')(function* (input: { readonly repositoryRoot: string; readonly bookmark: string | null }) {
    yield* Effect.gen(function* () {
      const snapshot = yield* settings.snapshot
      const entries = RepositoryBookmarks.withOverride({
        entries: snapshot.value.repositoryBookmarks,
        repositoryRoot: input.repositoryRoot,
        bookmark: input.bookmark,
      })
      yield* settings.update({ repositoryBookmarks: entries }, snapshot.revision)
    }).pipe(
      Effect.retry({ while: error => error._tag === 'SettingsConflict', schedule: CHOICE_CONFLICT_RETRY }),
      Effect.mapError(cause => new HostCallFailed({ service: 'settings', operation: 'save this project’s main branch', cause })),
    )
    return yield* describe(input.repositoryRoot)
  })

  return {
    resolve,
    describe,
    choose,
    /** Just the name, for the many callers that only rebase onto it or compare against it. */
    bookmarkFor: (repositoryRoot: string) => Effect.map(resolve(repositoryRoot), resolved => resolved.bookmark),
  }
})

/** The main branch of each project: the bookmark thread workspaces start from, Land advances and views compare against. */
export class ProjectBookmarks extends Context.Service<ProjectBookmarks, Effect.Success<typeof make>>()('@dshfiles/jj-integration/ProjectBookmarks') {
  static readonly layer = Layer.effect(ProjectBookmarks, make)
}
