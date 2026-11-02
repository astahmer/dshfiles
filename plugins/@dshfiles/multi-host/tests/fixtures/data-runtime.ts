import { NodeServices } from '@effect/platform-node'
import { Cause, ConfigProvider, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect'
import { HostDirectory } from '../../src/host-directory.js'
import { RuntimeIdentity } from '../../src/identity.js'
import { LaunchFile } from '../../src/launch-file.js'
import { MultiHostPaths } from '../../src/paths.js'
import { RemoteThreads } from '../../src/remote-threads.js'
import { wireCode } from './ssh-runtime.js'

export interface DataEnvironment {
  readonly DSH_HOME: string
  readonly DSH_PROFILE?: string
}

/**
 * The plugin's data services over the real file system, configured only by `environment`: a test names its own
 * temporary `DSH_HOME` and never reaches the shell's real DSH home.
 */
export const dataLayer = (environment: DataEnvironment) =>
  Layer.mergeAll(HostDirectory.layer, RemoteThreads.layer, LaunchFile.layer, RuntimeIdentity.layer({ configuredProfile: undefined })).pipe(
    Layer.provideMerge(MultiHostPaths.layer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ ...environment }))),
  )

export type DataServices = Layer.Success<ReturnType<typeof dataLayer>>

/** A failed run as an Error carrying the wire `code` a Host API caller would read. */
const rejection = (cause: Cause.Cause<unknown>): Error => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  const message = error instanceof Error ? error.message : Cause.pretty(cause)
  return Object.assign(new Error(message), { code: wireCode(error) ?? 'unexpected' })
}

/** Run data-service effects as Promises against one runtime, for tests written against the old Promise stores. */
export const dataRunner = (environment: DataEnvironment) => {
  const runtime = ManagedRuntime.make(dataLayer(environment))
  const run = async <A, E>(effect: Effect.Effect<A, E, DataServices>): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw rejection(exit.cause)
  }
  return { run, dispose: () => runtime.dispose() }
}
