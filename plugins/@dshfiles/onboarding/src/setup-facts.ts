import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Cache, Context, Duration, Effect, Exit, FileSystem, Layer, Path } from 'effect'
import { checkGithubAuth } from './github-auth.js'
import type { ChecklistFacts, PluginState } from './overview-model.js'
import { onboardingSettings, type OnboardingSettings } from './settings.js'

/** jj-integration cuts thread workspaces at `<repository>-threads/<name>`: those are work in progress, not projects. */
const isThreadWorkspace = (path: string): boolean => {
  const parts = path.replace(/\/+$/u, '').split('/')
  const parent = parts.at(-2) ?? ''
  return (parent.length > '-threads'.length && parent.endsWith('-threads')) || /^thread-[0-9a-f]{6}$/u.test(parts.at(-1) ?? '')
}

const OWNED_SCOPE = '@dshfiles/'

/**
 * What the Host can observe about a setup, read on each request and never stored: configured model providers, registered
 * projects and whether each is a jj or git repository, the GitHub CLI sign-in (cached for a minute), and which owned
 * plugins the profile enables. An absent Host service is reported as unknown (`null`), never guessed.
 */
export class SetupFacts extends Context.Service<
  SetupFacts,
  {
    readonly settings: Effect.Effect<OnboardingSettings>
    readonly checklist: Effect.Effect<ChecklistFacts>
    readonly pluginStates: Effect.Effect<ReadonlyMap<string, PluginState> | null>
  }
>()('@dshfiles/onboarding/SetupFacts') {
  static readonly make = (input: { readonly githubExecutable: string }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const settings = yield* Settings.Tag<OnboardingSettings>(onboardingSettings.namespace)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
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

      const providers = Effect.sync(() => {
        const llm = host.ctx.get('llm')
        return llm === undefined || llm === null ? null : llm.listProviders().length
      })

      const checklist = Effect.gen(function* () {
        const current = yield* settings.get
        const [providerCount, projectList, signIn] = yield* Effect.all(
          [providers, projects, current.githubCheck ? Cache.get(github, input.githubExecutable) : Effect.succeed('off' as const)],
          { concurrency: 'unbounded' },
        )
        return { providers: providerCount, projects: projectList, github: signIn } satisfies ChecklistFacts
      })

      const pluginStates = Effect.gen(function* () {
        const manager = host.ctx.get('pluginManager')
        if (manager === undefined || manager === null) return null
        const listed = yield* Effect.exit(Effect.tryPromise(() => manager.listPlugins()))
        if (Exit.isFailure(listed)) return null
        const states = new Map<string, PluginState>()
        for (const plugin of listed.value) {
          if (!plugin.moduleName.startsWith(OWNED_SCOPE)) continue
          const name = plugin.moduleName.slice(OWNED_SCOPE.length).split('/')[0] ?? ''
          if (states.get(name) !== 'enabled') states.set(name, plugin.enabled ? 'enabled' : 'disabled')
        }
        return states
      })

      return SetupFacts.of({ settings: settings.get, checklist, pluginStates })
    })

  static readonly layer = (input: { readonly githubExecutable: string }) => Layer.effect(SetupFacts, SetupFacts.make(input))
}
