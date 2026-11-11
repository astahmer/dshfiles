import type { Context } from '@deepseek-ai/cordis'
import { HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { mintNativeCookie } from './native-cookie.ts'
import { resolveProvider, type Provider } from './providers.ts'
import { loadPhoneSettings, savePhoneSettings, type PhoneSettings } from './settings.ts'
import { startTunnel } from './tunnel.ts'

/**
 * The one Promise edge the plugin's `setup` calls: one runtime per activation, spawning through the Host's `subprocess`
 * service, reading files through the Host's file system and the native listener through `fetch`. Every operation is
 * an Effect in its own module; this only runs it.
 */
export const phoneRuntime = (ctx: Context) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(DshChildProcessSpawner.layer, tracerLayer, nodeFileSystemLayer, FetchHttpClient.layer).pipe(
      Layer.provide(HostContext.layer({ ctx, packageId: '@dshfiles/phone-pairing' })),
    ),
  )
  return {
    resolveProvider: (preferred: Provider | undefined) => runtime.runPromise(resolveProvider(preferred)),
    startTunnel: (port: number, provider: Provider) => runtime.runPromise(startTunnel(port, provider)),
    stopTunnel: (stop: Effect.Effect<void>) => runtime.runPromise(stop),
    /** `undefined` when the native listener refuses or is unreachable. */
    mintNativeCookie: (url: string) => runtime.runPromise(mintNativeCookie(url).pipe(Effect.orElseSucceed(() => undefined))),
    loadSettings: (path: string) => runtime.runPromise(loadPhoneSettings(path)),
    saveSettings: (path: string, next: PhoneSettings) => runtime.runPromise(savePhoneSettings(path, next)),
    dispose: () => runtime.dispose(),
  }
}
