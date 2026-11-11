import { Context, Duration, Effect, FileSystem, Layer, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { CatalogPlugin } from './catalog-model.js'
import { DshfilesCheckout } from './dshfiles-checkout.js'
import { isMissingExecutable } from './github-auth.js'
import { TtlCell } from './ttl-cell.js'
import type { PackManagerSurface } from './plugin-manager-promise.js'
import {
  COMMITS_URL,
  FIELD,
  WhatsNewModel,
  type Upstream,
  type UpstreamTarget,
  type WhatsNew,
  type WhatsNewEntry,
  type WhatsNewInput,
} from './whats-new-model.js'

const COMMAND_TIMEOUT = Duration.seconds(5)
const LOCAL_SCAN = 400
const UPSTREAM_SCAN = 100
const UPSTREAM_KEEP = 50
const READY_TTL = Duration.seconds(60)
const FAILED_TTL = Duration.seconds(5)

/** jj and git both print `<commit>␟<committer time>␟<title>`; the ISO instant parses the same either way. */
const JJ_LOG_TEMPLATE = `commit_id ++ "\\x1f" ++ committer.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ") ++ "\\x1f" ++ description.first_line() ++ "\\n"`
const JJ_REF_TEMPLATE = `name ++ "\\x1f" ++ remote ++ "\\x1f" ++ if(normal_target, normal_target.commit_id(), "") ++ "\\n"`
const JJ_TITLES = 'description(regex:"^(feat|fix)[(]")'
const JJ_FLAGS = ['--ignore-working-copy', '--no-pager', '--color', 'never'] as const
const GIT_LOG_FORMAT = `--format=%H${FIELD}%cI${FIELD}%s`
const GIT_TITLES = ['--extended-regexp', '--grep=^(feat|fix)\\('] as const

type CommandResult = { readonly kind: 'ok'; readonly stdout: string } | { readonly kind: 'missing' } | { readonly kind: 'failed'; readonly detail: string }

/** A repository read before the request's slice: newest first, owned plugins only. */
type HistoryRead =
  | {
      readonly state: 'ready'
      readonly vcs: 'jj' | 'git'
      readonly bookmark: string | null
      readonly entries: readonly WhatsNewEntry[]
      readonly upstream: readonly Upstream[]
    }
  | { readonly state: 'unreadable'; readonly reason: string }

/**
 * What's new, read on the Host from the dshfiles checkout this bundle is linked from: `jj log` (or `git log` without jj)
 * with an explicit line format, five seconds per command, cached a minute. It never fetches, so upstream is as of the
 * last fetch, and it opens one `onboarding history read` span per read. Nothing else leaves the process.
 */
export class WhatsNewHistory extends Context.Service<WhatsNewHistory, { readonly read: (request: WhatsNewInput) => Effect.Effect<WhatsNew> }>()(
  '@dshfiles/onboarding/WhatsNewHistory',
) {
  static readonly layerFrom = <Id extends string>(input: {
    readonly manager: () => PackManagerSurface<Id> | undefined
    readonly plugins: readonly CatalogPlugin[]
    readonly jjExecutable: string
    readonly gitExecutable: string
  }) =>
    Layer.effect(
      WhatsNewHistory,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const owned = new Set(input.plugins.map(plugin => plugin.name))
        const pluginInfo = new Map(input.plugins.map(plugin => [plugin.name, plugin] as const))
        const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))

        const run = (command: { readonly executable: string; readonly args: readonly string[]; readonly cwd: string }): Effect.Effect<CommandResult> =>
          Effect.scoped(
            Effect.gen(function* () {
              const process = yield* spawner.spawn(
                ChildProcess.make(command.executable, [...command.args], {
                  cwd: command.cwd,
                  stdin: 'ignore',
                  env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
                  extendEnv: true,
                  forceKillAfter: Duration.seconds(1),
                }),
              )
              const [stdout, , exitCode] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(process.stdout)), Stream.runDrain(process.stderr), process.exitCode],
                {
                  concurrency: 'unbounded',
                },
              )
              return exitCode === 0 ? ({ kind: 'ok', stdout } as const) : ({ kind: 'failed', detail: `exit ${String(exitCode)}` } as const)
            }),
          ).pipe(
            Effect.timeoutOrElse({ duration: COMMAND_TIMEOUT, orElse: () => Effect.succeed({ kind: 'failed', detail: 'no answer within 5 s' } as const) }),
            Effect.catch(error =>
              Effect.succeed(isMissingExecutable(error) ? ({ kind: 'missing' } as const) : ({ kind: 'failed', detail: 'could not start' } as const)),
            ),
          )

        const unreadable = (tool: 'jj' | 'git', detail: string): HistoryRead => ({
          state: 'unreadable',
          reason: `${tool} log failed (${detail}). Run ${tool === 'jj' ? '`jj log`' : '`git log`'} in your dshfiles checkout to see why, then try again.`,
        })

        const upstreamOf = (input: { readonly target: UpstreamTarget; readonly result: CommandResult; readonly fetchCommand: string }): readonly Upstream[] => {
          if (input.result.kind !== 'ok') return []
          const entries = WhatsNewModel.parseLog({ output: input.result.stdout, owned })
          return [
            {
              remote: input.target.remote,
              bookmark: input.target.bookmark,
              entries: entries.slice(0, UPSTREAM_KEEP),
              more: entries.length > UPSTREAM_KEEP,
              fetchCommand: input.fetchCommand,
            },
          ]
        }

        const readJj = Effect.fnUntraced(function* (root: string) {
          const jj = (args: readonly string[]) => run({ executable: input.jjExecutable, args: [...JJ_FLAGS, ...args], cwd: root })
          const refs = yield* jj(['bookmark', 'list', '--all-remotes', '-T', JJ_REF_TEMPLATE])
          if (refs.kind !== 'ok') return refs
          const { bookmark, targets } = WhatsNewModel.upstreamTargets({ refs: WhatsNewModel.parseJjRefs(refs.stdout), current: null })
          const history = bookmark === null ? '::@' : `::"${bookmark}"`
          const log = (revset: string, limit: number) =>
            jj(['log', '--no-graph', '-n', String(limit), '-r', `(${revset}) & ${JJ_TITLES}`, '-T', JJ_LOG_TEMPLATE])
          const [local, remote] = yield* Effect.all(
            [
              log(history, LOCAL_SCAN),
              Effect.forEach(targets, target => log(`::"${target.bookmark}"@"${target.remote}" ~ ${history}`, UPSTREAM_SCAN), { concurrency: 4 }),
            ],
            { concurrency: 'unbounded' },
          )
          if (local.kind !== 'ok') return local
          return {
            kind: 'read',
            value: {
              state: 'ready',
              vcs: 'jj',
              bookmark,
              entries: WhatsNewModel.parseLog({ output: local.stdout, owned }),
              upstream: targets.flatMap((target, index) =>
                upstreamOf({ target, result: remote[index] ?? { kind: 'missing' }, fetchCommand: `jj git fetch --remote ${target.remote}` }),
              ),
            },
          } as const
        })

        const readGit = Effect.fnUntraced(function* (root: string) {
          const git = (args: readonly string[]) => run({ executable: input.gitExecutable, args: ['--no-pager', ...args], cwd: root })
          const [head, remotes, refs] = yield* Effect.all(
            [
              git(['symbolic-ref', '--quiet', '--short', 'HEAD']),
              git(['remote']),
              git(['for-each-ref', `--format=%(refname)%1f%(objectname)`, 'refs/heads', 'refs/remotes']),
            ],
            { concurrency: 'unbounded' },
          )
          if (refs.kind !== 'ok') return refs
          const current = head.kind === 'ok' ? head.stdout.trim() : null
          const { bookmark, targets } = WhatsNewModel.upstreamTargets({
            refs: WhatsNewModel.parseGitRefs({ refs: refs.stdout, remotes: remotes.kind === 'ok' ? remotes.stdout : '' }),
            current,
          })
          const history = bookmark === null ? 'HEAD' : `refs/heads/${bookmark}`
          const log = (revisions: readonly string[], limit: number) => git(['log', '-n', String(limit), ...GIT_TITLES, GIT_LOG_FORMAT, ...revisions, '--'])
          const [local, remote] = yield* Effect.all(
            [
              log([history], LOCAL_SCAN),
              Effect.forEach(targets, target => log([`refs/remotes/${target.remote}/${target.bookmark}`, `^${history}`], UPSTREAM_SCAN), { concurrency: 4 }),
            ],
            { concurrency: 'unbounded' },
          )
          if (local.kind !== 'ok') return local
          return {
            kind: 'read',
            value: {
              state: 'ready',
              vcs: 'git',
              bookmark,
              entries: WhatsNewModel.parseLog({ output: local.stdout, owned }),
              upstream: targets.flatMap((target, index) =>
                upstreamOf({ target, result: remote[index] ?? { kind: 'missing' }, fetchCommand: `git fetch ${target.remote}` }),
              ),
            },
          } as const
        })

        /** jj first when the checkout has `.jj`; git when it has only `.git`, or when jj is not on this Host's PATH. */
        const readRepository = (root: string): Effect.Effect<HistoryRead> =>
          Effect.gen(function* () {
            const [hasJj, hasGit] = yield* Effect.all([exists(path.join(root, '.jj')), exists(path.join(root, '.git'))], { concurrency: 'unbounded' })
            if (hasJj) {
              const viaJj = yield* readJj(root)
              if (viaJj.kind === 'read') return viaJj.value
              if (viaJj.kind === 'failed') return unreadable('jj', viaJj.detail)
              if (!hasGit)
                return {
                  state: 'unreadable',
                  reason: 'jj is not on the PATH DSH runs with. Install jj, or start DSH from a shell that has it, then try again.',
                } as const
            }
            if (!hasGit) return { state: 'unreadable', reason: 'The dshfiles checkout has neither .jj nor .git, so it holds no history to read.' } as const
            const viaGit = yield* readGit(root)
            if (viaGit.kind === 'read') return viaGit.value
            if (viaGit.kind === 'failed') return unreadable('git', viaGit.detail)
            return { state: 'unreadable', reason: 'git is not on the PATH DSH runs with. Install jj or git, then try again.' } as const
          }).pipe(
            Effect.tap(read =>
              Effect.annotateCurrentSpan(
                read.state === 'ready'
                  ? {
                      'onboarding.history.state': read.state,
                      'onboarding.history.vcs': read.vcs,
                      'onboarding.history.entries': read.entries.length,
                      'onboarding.history.upstreams': read.upstream.length,
                    }
                  : { 'onboarding.history.state': read.state },
              ),
            ),
            Effect.withSpan('onboarding history read', { kind: 'client' }),
          )

        // A failed read retries soon, so Try again after fixing PATH or the checkout answers within seconds.
        const history = yield* TtlCell.make({ read: readRepository, timeToLive: (read: HistoryRead) => (read.state === 'ready' ? READY_TTL : FAILED_TTL) })

        const plugins = (entries: readonly WhatsNewEntry[]) =>
          [...new Set(entries.map(entry => entry.plugin))].flatMap(name => {
            const plugin = pluginInfo.get(name)
            return plugin === undefined ? [] : [{ name, description: plugin.description, features: plugin.features }]
          })

        const read = (request: WhatsNewInput): Effect.Effect<WhatsNew> =>
          Effect.gen(function* () {
            const checkout = yield* DshfilesCheckout.locate({ manager: input.manager() }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            )
            if (checkout.kind === 'missing') return { state: 'no-checkout', reason: checkout.reason, commitsUrl: COMMITS_URL } as const
            const value = yield* history(checkout.root)
            if (value.state === 'unreadable') return { state: 'unreadable', reason: value.reason, commitsUrl: COMMITS_URL } as const
            const slice = WhatsNewModel.select({ entries: value.entries, request })
            const upstream = value.upstream.map(target => {
              const picked = WhatsNewModel.select({ entries: target.entries, request })
              return { ...target, entries: picked.entries, more: target.more || picked.more }
            })
            return {
              state: 'ready',
              vcs: value.vcs,
              bookmark: value.bookmark,
              entries: slice.entries,
              more: slice.more,
              upstream,
              plugins: plugins([...slice.entries, ...upstream.flatMap(target => target.entries)]),
              commitsUrl: COMMITS_URL,
            } as const
          })

        return WhatsNewHistory.of({ read })
      }),
    )
}
