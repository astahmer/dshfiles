import { createTestHost } from '@dshfiles/dshx/testing'
import { Effect, FileSystem } from 'effect'
import { resourcePacksApi } from '../src/api.js'

export const owner = '@dshfiles/resource-packs'

const restoreDshHome = (previous: string | undefined) =>
  Effect.sync(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env['DSH_HOME'] = previous
  })

/** A private DSH_HOME for the test, so the plugin's registry never resolves the live `~/.dsh`. */
export const isolatedDshHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const home = yield* fs.makeTempDirectoryScoped({ prefix: 'resource-packs-home-' })
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

/** The browser transport: deliberately malformed payloads reach the real API validator; tests decode the envelope they expect. */
// oxlint-disable-next-line antislop/no-unknown-parameters -- malformed wire input is the boundary under test.
export const requestApi = (host: TestHostInstance, method: string, input: unknown) =>
  Effect.promise(async () => {
    const response = await host.connection.requestApi({ packageId: owner, apiId: resourcePacksApi.id, version: resourcePacksApi.version, method, input })
    return response.json()
  })
