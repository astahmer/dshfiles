import type { SecretCatalogCredentialBridge, SecretCatalogValues } from '@dshfiles/credential-port'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { importCredentialKey, listCredentialKeys, type SecretKeyImportRequest } from './credential-bridge.js'
import { resolveSecretValue } from './secret-reference-resolver.js'

/** Other plugins pass an AbortSignal; its abort interrupts the work and rejects with the signal's reason. */
const abortable =
  (signal: AbortSignal | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, unknown, R> => {
    if (signal === undefined) return effect
    const aborted = Effect.callback<never, unknown>(resume => {
      const onAbort = (): void => resume(Effect.fail(signal.reason))
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      return Effect.sync(() => signal.removeEventListener('abort', onAbort))
    })
    return Effect.raceFirst(effect, aborted)
  }

/**
 * The Promise ports other plugins call on the Cordis Context: `secretCatalogValues` reveals one reference on the Host,
 * `secretCatalogCredentials` lists and imports keys. Both run in this plugin's services.
 */
export const CatalogPorts = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const resolve = yield* DshxPlugin.callback((input: Parameters<SecretCatalogValues['resolve']>[0]) =>
      abortable(input.signal)(
        resolveSecretValue({ reference: input.reference, cwd: input.cwd, ...(input.expectedScope !== undefined && { expectedScope: input.expectedScope }) }),
      ),
    )
    const listKeys = yield* DshxPlugin.callback((cwd: string | null, signal?: AbortSignal) => abortable(signal)(listCredentialKeys(cwd)))
    const importKey = yield* DshxPlugin.callback((request: SecretKeyImportRequest, signal?: AbortSignal) => abortable(signal)(importCredentialKey(request)))
    const values: SecretCatalogValues = { supportsExpectedScope: true, resolve }
    const credentials: SecretCatalogCredentialBridge = { listKeys, importKey }
    yield* Effect.sync(() => {
      host.ctx.provide('secretCatalogValues', values)
      host.ctx.provide('secretCatalogCredentials', credentials)
    })
  }),
)
