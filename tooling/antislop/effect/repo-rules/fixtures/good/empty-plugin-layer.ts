import { Context, Effect, Layer } from 'effect'

declare const DshxPlugin: { make: (options: { name: string; layer: unknown }) => unknown }

class Store extends Context.Service<Store, { readonly read: Effect.Effect<string> }>()('@dshfiles/fixture/Store') {
  static readonly layer = Layer.succeed(Store, { read: Effect.succeed('value') })
}

export const plugin = DshxPlugin.make({ name: 'x', layer: Store.layer })
export const merged = Layer.mergeAll(Layer.empty, Store.layer)
