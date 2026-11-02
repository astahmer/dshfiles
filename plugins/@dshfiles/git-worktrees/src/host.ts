// Registers the dshx Effect Schema adapter `defineApi` needs before this module publishes its contracts.
import '@dshfiles/dshx/effect'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineApi, method, PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { Schema } from 'effect'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createGitWorktrees } from './git-worktrees.js'
import { gitWorktreesSettings } from './settings.js'

type GitWorktreesSettings = SettingsValue<typeof gitWorktreesSettings.schema>

const defaults: GitWorktreesSettings = gitWorktreesSettings.schema({})
let settingsScope: SettingsScope<GitWorktreesSettings> | undefined
let hostContext: Context | undefined

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

const registry = () => {
  const found = hostContext?.get('workspaceRegistry')
  if (found === undefined) throw new PluginApiError('The DSH workspace registry is unavailable; restart DSH and retry.', { code: 'registry-missing' })
  return found
}

const worktreeSchema = Schema.Struct({ name: Schema.String, path: Schema.String, branch: Schema.NullOr(Schema.String) })
const pathInputSchema = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) })
const worktreesOutputSchema = Schema.Struct({ worktrees: Schema.Array(worktreeSchema) })
const removeInputSchema = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)), force: Schema.Boolean })
const removedOutputSchema = Schema.Struct({ removed: Schema.Literal(true) })

const gitWorktreesApi = defineApi({
  id: 'git-worktrees',
  version: 1,
  owner: '@dshfiles/git-worktrees',
  methods: {
    worktrees: method({
      input: pathInputSchema,
      output: worktreesOutputSchema,
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
      input: removeInputSchema,
      output: removedOutputSchema,
      description:
        'Remove one thread worktree with `git worktree remove` and drop its DSH project registration; its `dsh/thread-…` branch stays. With force false git refuses a worktree holding uncommitted changes; pass force true only when the user explicitly agreed to lose them. Call only when the user asked to remove that worktree.',
      tool: { name: 'git_thread_worktree_remove', render: () => 'Removed that thread worktree; its branch is kept.' },
    }),
  },
})

const api = gitWorktreesApi.host({
  worktrees: async ({ input }) => {
    const location = await worktrees.locate(input.path)
    return { worktrees: location === undefined ? [] : [...(await worktrees.worktrees(location.repoRoot))] }
  },
  remove: async ({ input }) => {
    const registered = await registry().resolveByPath(input.path)
    await worktrees.remove(input.path, input.force)
    if (registered !== undefined) await registry().delete(registered.id)
    return { removed: true }
  },
})

const vcsProvider = VcsProviders.contract('@dshfiles/git-worktrees').host({
  detect: async ({ input }) => {
    const location = await worktrees.locate(input.path)
    if (location === undefined) return { match: null }
    return {
      match: { vcs: 'git', priority: 10, repoRoot: location.repoRoot, workspaceRoot: location.workspaceRoot, isolated: location.threadName !== undefined },
    }
  },
  provision: async ({ input }) => {
    const source = registry().get(WorkspaceId(input.workspaceId))
    if (source === undefined) throw new PluginApiError(`Unknown workspace ${input.workspaceId}; refresh and retry.`, { code: 'workspace-not-found' })
    const location = await worktrees.locate(source.path)
    if (location === undefined || !readSettings().isolate || input.isolate === false) return { workspaceId: source.id, isolated: false }
    const project = await registry().resolveByPath(location.repoRoot)
    const thread = await worktrees.provision(location.repoRoot, input.base)
    const workspace = await registry().create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)
    return { workspaceId: workspace.id, isolated: true }
  },
  snapshot: async ({ input }) => ({ snapshot: await worktrees.snapshot(input.path) }),
  restore: async ({ input }) => ({ previous: await worktrees.restore(input.path, input.snapshot) }),
})

export default defineHost({
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
  setup: context => {
    hostContext = context
  },
})
