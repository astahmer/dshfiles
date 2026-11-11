import type { Context } from '@deepseek-ai/cordis'
import { HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Layer, ManagedRuntime } from 'effect'
import { detectTailnet, serveTailnet } from './tailnet.ts'

/**
 * The one Promise edge the Cordis `apply` calls: one runtime per activation, spawning through the Host's `subprocess`
 * service; the Tailscale actions themselves are Effects in `tailnet.ts`.
 */
export const tailnetCommands = (ctx: Context) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(DshChildProcessSpawner.layer, tracerLayer).pipe(Layer.provide(HostContext.layer({ ctx, packageId: '@dshfiles/phone-access' }))),
  )
  return {
    detect: () => runtime.runPromise(detectTailnet),
    serve: (port: number) => runtime.runPromise(serveTailnet(port)),
    dispose: () => runtime.dispose(),
  }
}
