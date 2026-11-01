import { Effect, Layer } from 'effect'

export const layer = Layer.effect(
  Service,
  Effect.sync(() => ctx.get('database')),
)
