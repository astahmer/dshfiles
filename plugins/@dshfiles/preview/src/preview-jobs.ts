import type {} from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'

const STOP_REASON = 'stopped from the thread dev-server list'

/** The Host job registry, so stopping a dev server stops the job that owns it. */
export class PreviewJobs extends Context.Service<
  PreviewJobs,
  { readonly kill: (input: { readonly jobId: string; readonly sessionId: string }) => Effect.Effect<boolean> }
>()('@dshfiles/preview/PreviewJobs') {
  static readonly layer = Layer.effect(
    PreviewJobs,
    Effect.map(HostContext, host =>
      PreviewJobs.of({
        kill: input =>
          Effect.sync(() => {
            const registry = host.ctx.get('jobs')
            if (registry === undefined) return false
            return registry.kill(JobId(input.jobId), SessionId(input.sessionId), STOP_REASON) === 'requested'
          }),
      }),
    ),
  )
}

/** SIGTERM one pid the probe attributed to this Host; the Host never signals anything else. */
export const signalProcess = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    return false
  }
}
