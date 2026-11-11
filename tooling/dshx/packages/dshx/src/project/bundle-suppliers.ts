import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'

/**
 * A bundle whose client keeps an owned package external (shared-runtime) cannot load without it, so a profile that
 * composes the bundle needs that supplier too. This file loads under Node type stripping for scripts/profile-sync.ts,
 * so it imports no relative module.
 */

const clientExternalsSchema = Schema.fromJsonString(
  Schema.Struct({
    dsh: Schema.optional(Schema.Struct({ client: Schema.optional(Schema.Struct({ external: Schema.optional(Schema.Array(Schema.String)) })) })),
  }),
)

const withSuppliers = <Bundle extends { readonly packageId: string }>(input: {
  readonly bundles: readonly Bundle[]
  readonly manifestPath: (bundle: Bundle) => string
  /** The supplier bundle for an owned package id, or undefined when this checkout has none. */
  readonly supplier: (packageId: string) => Bundle | undefined
}): readonly Bundle[] => {
  const composed = [...input.bundles]
  for (const bundle of composed) {
    const manifest = Schema.decodeUnknownSync(clientExternalsSchema)(readFileSync(input.manifestPath(bundle), 'utf8'))
    for (const external of manifest.dsh?.client?.external ?? []) {
      if (!external.startsWith('@dshfiles/') || composed.some(item => item.packageId === external)) continue
      const supplier = input.supplier(external)
      if (supplier !== undefined) composed.push(supplier)
    }
  }
  return composed
}

export class BundleSuppliers {
  static readonly withSuppliers = withSuppliers
}
