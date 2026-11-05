import { Jj } from '@dshfiles/jj-cli'
import { Cache, Context, Duration, Effect, Exit, Layer, Option, Redacted } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const githubRemotePattern = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@\s]+@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/u

/** `owner/repo` of a github.com remote URL (https, ssh or scp-like), or undefined for any other host. */
const githubRepositoryOfUrl = (url: string): string | undefined => {
  const match = githubRemotePattern.exec(url.trim())
  return match?.[1] === undefined || match[2] === undefined ? undefined : `${match[1]}/${match[2]}`
}

/** The GitHub repository `jj git remote list` names: `origin` first, then `upstream`, then the first github.com remote. */
const githubRepositoryOfRemotes = (remoteList: string): string | undefined => {
  const remotes = remoteList.split('\n').flatMap(line => {
    const [name, url] = line.trim().split(/\s+/u)
    const repository = url === undefined ? undefined : githubRepositoryOfUrl(url)
    return name === undefined || repository === undefined ? [] : [{ name, repository }]
  })
  return (remotes.find(remote => remote.name === 'origin') ?? remotes.find(remote => remote.name === 'upstream') ?? remotes[0])?.repository
}

const CLI_TOKEN_TTL = Duration.minutes(5)

/**
 * What the Host machine already knows about a project's tracker: the GitHub repository of its git remote and the token
 * of a signed-in `gh` CLI. Both stay on the Host; a missing tool or remote answers `none`, never an error.
 */
export class SyncLocalProbes extends Context.Service<
  SyncLocalProbes,
  {
    readonly githubRepository: (projectPath: string) => Effect.Effect<Option.Option<string>>
    readonly githubCliToken: Effect.Effect<Option.Option<Redacted.Redacted>>
  }
>()('@dshfiles/backlog/SyncLocalProbes') {
  static readonly layer = Layer.effect(
    SyncLocalProbes,
    Effect.gen(function* () {
      const jj = yield* Jj
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const githubRepository = Effect.fn('backlog sync detect repository')((projectPath: string) =>
        jj.exec({ cwd: projectPath, args: ['--ignore-working-copy', 'git', 'remote', 'list'], timeout: '10 seconds', maxStdoutBytes: 64_000 }).pipe(
          Effect.map(output => Option.fromUndefinedOr(githubRepositoryOfRemotes(output.stdout))),
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      )
      const readCliToken = spawner.string(ChildProcess.make('gh', ['auth', 'token'], { stdin: 'ignore' })).pipe(
        Effect.timeout('5 seconds'),
        Effect.map(output => output.trim()),
        Effect.map(token => (token === '' || /\s/u.test(token) ? Option.none<Redacted.Redacted>() : Option.some(Redacted.make(token)))),
        Effect.orElseSucceed(() => Option.none<Redacted.Redacted>()),
        Effect.withSpan('backlog sync gh token', { kind: 'client', attributes: { 'dshx.plugin.package': '@dshfiles/backlog' } }),
      )
      const cliTokenCache = yield* Cache.makeWith(() => readCliToken, {
        capacity: 1,
        timeToLive: exit => (Exit.isSuccess(exit) ? CLI_TOKEN_TTL : Duration.zero),
      })
      return SyncLocalProbes.of({ githubRepository, githubCliToken: Cache.get(cliTokenCache, undefined) })
    }),
  )

  /** Fixed answers, standing in for jj and the gh CLI in tests. */
  static readonly layerTest = (input: { readonly repository?: string | undefined; readonly cliToken?: string | undefined }) =>
    Layer.succeed(
      SyncLocalProbes,
      SyncLocalProbes.of({
        githubRepository: () => Effect.succeed(Option.fromUndefinedOr(input.repository)),
        githubCliToken: Effect.succeed(Option.map(Option.fromUndefinedOr(input.cliToken), token => Redacted.make(token))),
      }),
    )
}

export class GithubRemotes {
  static readonly repositoryOfUrl = githubRepositoryOfUrl
  static readonly repositoryOfRemotes = githubRepositoryOfRemotes
}
