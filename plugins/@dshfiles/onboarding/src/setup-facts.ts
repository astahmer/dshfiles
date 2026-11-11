import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-workspace'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Cache, Context, Duration, Effect, FileSystem, Layer, Path } from 'effect'
import { checkGithubAuth } from './github-auth.js'
import { OnboardingOverview, type AccountFacts, type ChecklistFacts } from './overview-model.js'
import { onboardingSettings, type OnboardingSettings } from './settings.js'

/** jj-integration cuts thread workspaces at `<repository>-threads/<name>`: those are work in progress, not projects. */
const isThreadWorkspace = (path: string): boolean => {
  const parts = path.replace(/\/+$/u, '').split('/')
  const parent = parts.at(-2) ?? ''
  return (parent.length > '-threads'.length && parent.endsWith('-threads')) || /^thread-[0-9a-f]{6}$/u.test(parts.at(-1) ?? '')
}

/**
 * What the Host can observe about a setup, read on each request and never stored: AI accounts' connected accounts (or the
 * model provider routes without it), registered projects and whether each is a jj or git repository, the GitHub CLI
 * sign-in (cached for a minute). An absent Host service is reported as unknown (`null`), never guessed. Every read is
 * local: no provider, quota or model request.
 */
export class SetupFacts extends Context.Service<
  SetupFacts,
  {
    readonly settings: Effect.Effect<OnboardingSettings>
    readonly checklist: Effect.Effect<ChecklistFacts>
  }
>()('@dshfiles/onboarding/SetupFacts') {
  static readonly make = (input: { readonly githubExecutable: string }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const settings = yield* Settings.Tag<OnboardingSettings>(onboardingSettings.namespace)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const apis = yield* HostApis
      // The DSH subprocess service is read per check, so a Host without one still serves every other item.
      const github = yield* Cache.make({
        capacity: 1,
        timeToLive: Duration.seconds(60),
        lookup: (executable: string) =>
          checkGithubAuth({ executable }).pipe(
            Effect.provide(DshChildProcessSpawner.layer),
            Effect.provideService(HostContext, host),
            Effect.orElseSucceed(() => 'failed' as const),
          ),
      })

      const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))
      const vcsOf = Effect.fnUntraced(function* (root: string) {
        if (yield* exists(path.join(root, '.jj'))) return 'jj' as const
        if (yield* exists(path.join(root, '.git'))) return 'git' as const
        return null
      })

      const projects = Effect.gen(function* () {
        const registry = host.ctx.get('workspaceRegistry')
        if (registry === undefined || registry === null) return null
        const roots = registry
          .list()
          .map(workspace => workspace.path)
          .filter(root => !isThreadWorkspace(root))
        return yield* Effect.forEach(roots, root => Effect.map(vcsOf(root), vcs => ({ path: root, vcs })), { concurrency: 8 })
      })

      const providerRoutes = Effect.sync((): AccountFacts => {
        const llm = host.ctx.get('llm')
        return llm === undefined || llm === null ? null : { source: 'providers', routes: llm.listProviders().length }
      })
      // `read` returns the saved file with each account's signed-in flag; it never asks a provider or sweeps quota.
      const account = Effect.gen(function* () {
        if (!(yield* apis.isServed(aiAccountsApi))) return yield* providerRoutes
        return yield* apis
          .client(aiAccountsApi)
          .read()
          .pipe(
            Effect.map(file => OnboardingOverview.accountFacts(file.accounts)),
            Effect.orElseSucceed((): AccountFacts => ({ source: 'unreadable' })),
          )
      })

      const checklist = Effect.gen(function* () {
        const current = yield* settings.get
        const [accountFacts, projectList, signIn] = yield* Effect.all(
          [account, projects, current.githubCheck ? Cache.get(github, input.githubExecutable) : Effect.succeed('off' as const)],
          { concurrency: 'unbounded' },
        )
        return { account: accountFacts, projects: projectList, github: signIn } satisfies ChecklistFacts
      })

      return SetupFacts.of({ settings: settings.get, checklist })
    })

  static readonly layer = (input: { readonly githubExecutable: string }) => Layer.effect(SetupFacts, SetupFacts.make(input))
}
