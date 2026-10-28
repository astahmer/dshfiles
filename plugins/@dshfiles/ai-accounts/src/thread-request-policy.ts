import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ThreadModelPolicy } from '@dshfiles/session-controller/thread-model-api'

/** Mirror native selection's assembly boundary, not the potentially newer policy at dispatch/error time. */
export class ThreadRequestPolicy {
  private assembledRevision = 0
  readonly dispose: () => void

  constructor(agent: Agent, readPolicy: () => ThreadModelPolicy | null) {
    this.dispose = agent.ctx.on(
      'system-prompt/assemble',
      (_assembly, _context, next) => {
        this.assembledRevision = readPolicy()?.revision ?? 0
        return next()
      },
      { prepend: true },
    )
  }

  get revision(): number {
    return this.assembledRevision
  }
}
