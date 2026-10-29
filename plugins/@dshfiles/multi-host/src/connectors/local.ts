import { runtimeLocatorSchema } from '../records.js'
import { connectGateway, GatewayUnavailableError, type Gateway } from './gateway.js'
import { createLoopbackForward } from './loopback.js'

export const connectLocal = ({
  launchUrl,
  originPort,
  signal,
}: {
  readonly launchUrl: string
  readonly originPort?: number
  readonly signal?: AbortSignal | undefined
}): Promise<Gateway> => {
  const locator = runtimeLocatorSchema.parse({ kind: 'local', launchUrl })
  if (locator.kind !== 'local') throw new GatewayUnavailableError('invalid-runtime-locator', 'The local runtime locator is invalid.')
  return connectGateway({
    launchUrl: locator.launchUrl,
    signal,
    createTransport: async (origin, requestSignal) => {
      const forward = await createLoopbackForward({
        target: origin,
        ...(originPort !== undefined && { originPort }),
        ...(requestSignal !== undefined && { signal: requestSignal }),
      })
      const launch = new URL(locator.launchUrl)
      launch.hostname = forward.address
      launch.port = String(forward.port)
      return { origin: launch.origin, launchUrl: launch.toString(), dispose: forward.dispose }
    },
  })
}
