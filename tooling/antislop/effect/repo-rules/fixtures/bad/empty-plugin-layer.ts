import { Effect, Layer } from 'effect'

declare const DshxEffect: { plugin: (options: { layer: unknown; setup: () => unknown }) => unknown }
declare const DshxPlugin: { make: (options: { name: string; layer: unknown }) => unknown }

export const legacy = DshxEffect.plugin({ layer: Layer.empty, setup: () => Effect.void })
export const current = DshxPlugin.make({ name: 'x', layer: Layer.empty })
