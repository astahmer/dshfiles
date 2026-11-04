import { randomUUID } from 'node:crypto'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, FileSystem, Layer } from 'effect'
import { whiteboardApi } from '../src/api.js'
import { createWhiteboardPlugin } from '../src/host.js'

export const owner = '@dshfiles/whiteboard'
export const platformLayer = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

const restoreDshHome = (previous: string | undefined) =>
  Effect.sync(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env['DSH_HOME'] = previous
  })

/** A private DSH_HOME for the test, so the board store never resolves the live `~/.dsh`. */
export const isolatedDshHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const home = yield* fs.makeTempDirectoryScoped({ prefix: 'whiteboard-home-' })
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env['DSH_HOME']
      process.env['DSH_HOME'] = home
      return previous
    }),
    restoreDshHome,
  )
  return home
})

/** A real in-memory Cordis Host disposed with the test scope. */
export const testHost = Effect.acquireRelease(
  Effect.promise(() => createTestHost()),
  host => Effect.promise(() => host.dispose()),
)

export type TestHostInstance = Effect.Success<typeof testHost>

export const mount = (host: TestHostInstance, plugin = createWhiteboardPlugin()) => Effect.promise(() => host.mount(plugin, { packageId: owner }))

/** A mounted whiteboard plugin and a typed client as another Host plugin would hold it. */
export const mountedWhiteboard = Effect.gen(function* () {
  const home = yield* isolatedDshHome
  const host = yield* testHost
  const mounted = yield* mount(host)
  return { home, host, mounted, client: createHostApiClient(host.ctx, whiteboardApi, '@test/reader') }
})

/** The browser transport: malformed payloads reach the real API validator; tests decode the envelope they expect. */
// oxlint-disable-next-line antislop/no-unknown-parameters -- malformed wire input is the boundary under test.
export const requestApi = (host: TestHostInstance, method: string, input: unknown) =>
  Effect.promise(async () => {
    const response = await host.connection.requestApi({ packageId: owner, apiId: whiteboardApi.id, version: whiteboardApi.version, method, input })
    return response.json()
  })

// oxlint-disable-next-line antislop/no-unknown-parameters -- the native tool pipeline is the boundary under test, including malformed arguments.
export const tool = (host: TestHostInstance, name: string, args: unknown) =>
  Effect.promise(() =>
    host.tools.execute({
      // SAFETY: ToolCallId is an opaque string brand; a generated UUID is unique and no Agent structure is asserted.
      callId: randomUUID() as ToolExecutionInput['callId'],
      name,
      arguments: args,
      signal: new AbortController().signal,
    }),
  )
