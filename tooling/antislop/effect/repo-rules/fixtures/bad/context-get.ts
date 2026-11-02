import { Effect, Layer as L } from 'effect'

export const rootLayer = L.succeed(Service, {})
export const service = Effect.sync(() => ctx.get('database'))
