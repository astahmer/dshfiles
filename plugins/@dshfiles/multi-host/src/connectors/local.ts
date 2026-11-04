import { Effect, Schema } from 'effect'
import { InvalidRuntimeLocator } from '../errors.js'
import { runtimeLocatorSchema } from '../records.js'
import { connectGateway } from './gateway.js'
import { Loopback } from './loopback.js'

const decodeLocator = Schema.decodeUnknownEffect(runtimeLocatorSchema, { onExcessProperty: 'error' })

/** A runtime on this machine, reached through a private loopback forward on its stable origin port. */
export const connectLocal = Effect.fnUntraced(function* (input: { readonly launchUrl: string; readonly originPort?: number | undefined }) {
  const locator = yield* decodeLocator({ kind: 'local', launchUrl: input.launchUrl }).pipe(Effect.mapError(() => new InvalidRuntimeLocator()))
  if (locator.kind !== 'local') return yield* new InvalidRuntimeLocator()
  return yield* connectGateway({
    launchUrl: locator.launchUrl,
    transport: origin =>
      Effect.map(Loopback.forward({ target: origin, originPort: input.originPort }), endpoint => {
        const launch = new URL(locator.launchUrl)
        launch.hostname = endpoint.address
        launch.port = String(endpoint.port)
        return { origin: launch.origin, launchUrl: launch.toString(), closed: Effect.never }
      }),
  })
})
