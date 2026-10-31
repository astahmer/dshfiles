import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineApi, method, PluginApiError } from '@dshfiles/dshx/api'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Effect, Layer } from 'effect'
import { z } from 'zod'
import { createGitWorktrees } from './git-worktrees.js'
import { gitWorktreesSettings } from './settings.js'

type GitWorktreesSettings = SettingsValue<typeof gitWorktreesSettings.schema>

const defaults: GitWorktreesSettings = gitWorktreesSettings.schema({})
let settingsScope: SettingsScope<GitWorktreesSettings> | undefined

const readSettings = (): GitWorktreesSettings => {
  try {
    return settingsScope?.get() ?? defaults
  } catch {
    return defaults
  }
}

const worktrees = createGitWorktrees({
  threadsDirectory: repoRoot => {
    const configured = readSettings().threadsDirectory.trim()
    if (configured === '') return `${repoRoot}-threads`
    return join(configured.startsWith('~/') ? join(homedir(), configured.slice(2)) : configured, basename(repoRoot))
  },
})

const registry = (context: Context) => {
  const found = context.get('workspaceRegistry')
  if (found === undefined) throw new PluginApiError('The DSH workspace registry is unavailable; restart DSH and retry.', { code: 'registry-missing' })
  return found
}

const worktreeSchema = z.object({ name: z.string(), path: z.string(), branch: z.string().nullable() }).strict()

const gitWorktreesApi = defineApi({
  id: 'git-worktrees',
  version: 1,
  owner: '@dshfiles/git-worktrees',
  methods: {
    worktrees: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ worktrees: z.array(worktreeSchema) }).strict(),
      description: 'List the thread worktrees this plugin created for the git repository holding a path. Read-only.',
      tool: {
        name: 'git_thread_worktrees',
        readOnly: true,
        render: output =>
          output.worktrees.map(worktree => `${worktree.name} · ${worktree.path}${worktree.branch === null ? '' : ` · ${worktree.branch}`}`).join('\n') ||
          'No thread worktrees.',
      },
    }),
    remove: method({
      input: z.object({ path: z.string().min(1), force: z.boolean() }).strict(),
      output: z.object({ removed: z.literal(true) }).strict(),
      description:
        'Remove one thread worktree with `git worktree remove` and drop its DSH project registration; its `dsh/thread-…` branch stays. With force false git refuses a worktree holding uncommitted changes; pass force true only when the user explicitly agreed to lose them. Call only when the user asked to remove that worktree.',
      tool: { name: 'git_thread_worktree_remove', render: () => 'Removed that thread worktree; its branch is kept.' },
    }),
  },
})

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: Layer.empty, setup: () => Effect.void })

const api = hostApi(gitWorktreesApi, {
  worktrees: Effect.fn('git worktrees list')(({ input }) =>
    Effect.tryPromise({
      try: async () => {
        const location = await worktrees.locate(input.path)
        return { worktrees: location === undefined ? [] : [...(await worktrees.worktrees(location.repoRoot))] }
      },
      catch: error => error,
    }),
  ),
  remove: Effect.fn('git worktree remove')(({ input, ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const workspaceRegistry = registry(ctx)
        const registered = await workspaceRegistry.resolveByPath(input.path)
        await worktrees.remove(input.path, input.force)
        if (registered !== undefined) await workspaceRegistry.delete(registered.id)
        return { removed: true as const }
      },
      catch: error => error,
    }),
  ),
})

const vcsProvider = DshxEffect.host(VcsProviders.contract('@dshfiles/git-worktrees'), {
  detect: Effect.fn('git worktree detect')(({ input }) =>
    Effect.tryPromise({
      try: async () => {
        const location = await worktrees.locate(input.path)
        if (location === undefined) return { match: null }
        return {
          match: {
            vcs: 'git' as const,
            priority: 10,
            repoRoot: location.repoRoot,
            workspaceRoot: location.workspaceRoot,
            isolated: location.threadName !== undefined,
          },
        }
      },
      catch: error => error,
    }),
  ),
  provision: Effect.fn('git worktree provision')(({ input, ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const workspaceRegistry = registry(ctx)
        const source = workspaceRegistry.get(WorkspaceId(input.workspaceId))
        if (source === undefined) throw new PluginApiError(`Unknown workspace ${input.workspaceId}; refresh and retry.`, { code: 'workspace-not-found' })
        const location = await worktrees.locate(source.path)
        if (location === undefined || !readSettings().isolate || input.isolate === false) return { workspaceId: source.id, isolated: false }
        const project = await workspaceRegistry.resolveByPath(location.repoRoot)
        const thread = await worktrees.provision(location.repoRoot, input.base)
        const workspace = await workspaceRegistry.create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)
        return { workspaceId: workspace.id, isolated: true }
      },
      catch: error => error,
    }),
  ),
  snapshot: Effect.fn('git worktree snapshot')(({ input }) =>
    Effect.tryPromise({ try: async () => ({ snapshot: await worktrees.snapshot(input.path) }), catch: error => error }),
  ),
  restore: Effect.fn('git worktree restore')(({ input }) =>
    Effect.tryPromise({ try: async () => ({ previous: await worktrees.restore(input.path, input.snapshot) }), catch: error => error }),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/git-worktrees',
  settings: [
    gitWorktreesSettings.host({
      setup: scope => {
        settingsScope = scope
        return () => {
          if (settingsScope === scope) settingsScope = undefined
        }
      },
    }),
  ],
  apis: [api, vcsProvider],
})
