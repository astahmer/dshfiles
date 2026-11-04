import { Context as CordisContext } from '@deepseek-ai/cordis'
import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { SessionControllerHostRuntime, sessionControllerRootLayer } from '../../src/effect-runtime.ts'

test('reads the native controller when a handler runs, not once at setup', async () => {
  const ctx = new CordisContext()
  const runtime = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SessionControllerHostRuntime
    }).pipe(Effect.provide(sessionControllerRootLayer(ctx))),
  )
  expect(runtime.sessionController).toBeUndefined()
  const controller = { started: true }
  ctx.provide('sessionController', controller as never)
  expect(runtime.sessionController).toBe(controller)
})
