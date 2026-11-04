import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-working-directory'
import { HostContext, DshxPlugin } from '@dshfiles/dshx/effect'
import { createHostApiClient, defineCommand, type CommandInvocation, type CommandResult } from '@dshfiles/dshx/host'
import type {} from '@dshfiles/project-checks/completion-event'
import { Effect, Layer } from 'effect'
import { jjIntegrationApi } from './api.js'
import { AutoIntegration } from './auto-integration.js'
import { ThreadLifecycle } from './thread-lifecycle.js'

/**
 * The Cordis hooks whose emitter awaits the listener: Project Checks' verified-turn event (emitted with `serial`) and
 * prompt assembly, which must restore a deleted thread folder before DSH's working-directory check fails the turn.
 */
export const HostHooksLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const autoIntegration = yield* AutoIntegration
    const lifecycle = yield* ThreadLifecycle
    const integrate = yield* DshxPlugin.callback(autoIntegration.handle)
    const restore = yield* DshxPlugin.callback((input: { readonly path: string; readonly sessionId: string }) =>
      lifecycle
        .restoreMissing(input)
        .pipe(Effect.catch(error => Effect.logWarning(`jj-integration: could not restore thread workspace ${input.path}: ${error.message}`))),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.on('dshfiles/project-checks/verified', turn => integrate(turn))),
      dispose => Effect.sync(dispose),
    )
    // Prepended so it runs before DSH's working-directory check, which fails the turn when the Session's folder is gone.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on(
          'system-prompt/assemble',
          async (_assembly, promptContext, next) => {
            const agent = promptContext.agent
            if (agent === undefined) return next()
            const directories = new Set([host.ctx.get('workingDirectory')?.get(agent.session), agent.session.header.cwd])
            for (const directory of directories) {
              if (directory === undefined || directory === null || directory.length === 0) continue
              await restore({ path: directory, sessionId: String(agent.session.id) })
            }
            return next()
          },
          { prepend: true },
        ),
      ),
      dispose => Effect.sync(dispose),
    )
  }),
)

/** `/rebase` in a thread's composer: the same guarded land as the Integrate button, for the Session that typed it. */
export const rebaseCommand = defineCommand({
  name: 'rebase',
  description: 'Rebase this thread workspace onto the configured bookmark.',
  handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
    if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: 'Usage: /rebase' }
    const controller = invocation.agent.ctx.get('sessionController')
    if (controller === undefined) return { kind: 'error', text: 'The Session controller is unavailable.' }
    const sessions = await controller.list({ projections: [] }, invocation.signal)
    const path = sessions.items.find(session => session.sessionId === invocation.agent.id)?.cwd
    if (path === undefined || path.length === 0) return { kind: 'error', text: 'This Session has no working directory; there is nothing to rebase.' }
    const api = createHostApiClient(invocation.agent.ctx, jjIntegrationApi, '@dshfiles/jj-integration')
    const { thread } = await api.threadAt({ path }, { signal: invocation.signal })
    if (thread === null) return { kind: 'error', text: 'This Session is not in a managed thread workspace. Use an isolated thread workspace to run /rebase.' }
    const result = await api.land({ path: thread.path, sessionId: String(invocation.agent.id) }, { signal: invocation.signal })
    if (result.status === 'landed') return { kind: 'success', text: `Landed ${String(result.revisions.length)} revision(s) on ${result.bookmark}.` }
    if (result.status === 'nothing-to-land') return { kind: 'success', text: `Nothing to land; the workspace now sits on ${result.bookmark}.` }
    if (result.status === 'needs-description')
      return {
        kind: 'error',
        text: `Rebase refused: ${String(result.revisions.length)} revision(s) need real descriptions. Describe them and run /rebase again.`,
      }
    const agentAsked = result.agentAsked ? " The thread's agent was asked to fix them and rebase again." : ''
    return {
      kind: 'error',
      text: `Rebase onto ${result.bookmark} stopped with conflicts in ${String(result.files.length)} file(s). Resolve them in the thread workspace and run /rebase again.${agentAsked}`,
    }
  },
})
