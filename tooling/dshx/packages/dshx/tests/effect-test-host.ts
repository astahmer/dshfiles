import { Context, Effect, Layer } from 'effect'
import { createTestHost, type TestHost as Host } from '../src/testing/index.js'

/** A real in-memory DSH Host for one test block, disposed when the block's scope closes. */
export class TestHost extends Context.Service<TestHost, Host>()('@dshfiles/dshx/tests/TestHost') {
  static readonly layer = Layer.effect(
    TestHost,
    Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      host => Effect.promise(() => host.dispose()),
    ),
  )
}
