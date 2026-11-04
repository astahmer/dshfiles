import { Context as CordisContext } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Cause, Effect, type Exit, Layer, Option, Schema, SchemaAST } from 'effect'
import { Ssh } from '../../src/ssh.js'

/** A Cordis context with DSH's local subprocess runtime, the one service the DSH spawner needs. */
export const subprocessHost = Layer.effect(
  HostContext,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const ctx = new CordisContext()
      await ctx.plugin(LocalSubprocessRuntime)
      return ctx
    }),
    ctx => Effect.promise(() => ctx.fiber.dispose()),
  ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/multi-host-test' }))),
)

export const spawnerLayer = DshChildProcessSpawner.layer.pipe(Layer.provide(subprocessHost))

export const sshLayer = Ssh.layer.pipe(Layer.provide(spawnerLayer))

const wireCodeAt = SchemaAST.resolveAt<string>('dshxWireCode')

/** The wire code an exposed error class declares, as a caller of the Host API would read it. */
export const wireCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !Schema.isSchema(error.constructor)) return undefined
  return wireCodeAt(error.constructor.ast)
}

/** `cancelled` for an interrupted run, the failure's wire code, or `no-error`. */
export const exitCode = (exit: Exit.Exit<unknown, unknown>): string => {
  if (exit._tag === 'Success') return 'no-error'
  if (Cause.hasInterruptsOnly(exit.cause)) return 'cancelled'
  return Option.match(Cause.findErrorOption(exit.cause), { onNone: () => 'defect', onSome: error => wireCode(error) ?? 'unexpected' })
}
