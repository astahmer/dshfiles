import { createRequire } from 'node:module'
import { type ProfileManifest, readProfileManifest, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect'

const DSH_BIN_NAME = 'dshx-plugin-marketplace'
const MAX_MANIFEST_BYTES = 512 * 1024

/** The Profile the running DSH serves, and the exact bundle list its manifest declares. */
export interface MarketplaceProfile {
  readonly name: string
  readonly dir: string
  readonly manifest: ProfileManifest
  readonly bundles: readonly string[]
}

/** The CLI entry `dsh plugin add` runs, resolved from the installed `@deepseek-ai/dsh` manifest. */
export interface DshCliResolution {
  readonly cliPath: string
  readonly version: string
}

/** A Profile the Loader does not point at, or a manifest and CLI entry this Host cannot read. */
export class MarketplaceProfileFailed extends Schema.TaggedError<MarketplaceProfileFailed>()(
  'MarketplaceProfileFailed',
  {
    reason: Schema.Literals(['not-local', 'not-the-profile', 'unreadable-manifest', 'no-bundles', 'no-cli', 'unreadable-package']),
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'marketplace-profile-failed' },
) {
  override get message(): string {
    if (this.reason === 'not-local') return 'The plugin marketplace is only available from a local DSH profile.'
    if (this.reason === 'not-the-profile') return 'The Loader base URL is not the current local DSH profile directory.'
    if (this.reason === 'no-bundles') return 'The current DSH profile has no valid bundle list.'
    if (this.reason === 'no-cli') return '@deepseek-ai/dsh does not declare the dsh CLI entry.'
    return 'The current DSH profile could not be read.'
  }
}

/** The bundle list a Profile manifest declares; empty when the manifest is not one DSH can load. */
export const bundlesOfManifest = (manifest: ProfileManifest): readonly string[] => {
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string' && bundle.length > 0)) return []
  return bundles
}

const dshManifestSchema = Schema.Struct({
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  bin: Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)]),
})

const fileUrlPath = (baseUrl: string): string | undefined => {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : undefined
  } catch {
    return undefined
  }
}

export interface MarketplaceFilesOptions {
  /** Harness home the Profile directories live under; the real one when omitted. */
  readonly harnessHome?: string | undefined
}

/**
 * Profile and installation files the marketplace reads: one Profile resolution that verifies the Loader base URL is
 * this machine's profile directory, its manifest, the activation list after an install, and the DSH CLI entry.
 */
export class MarketplaceFiles extends Context.Service<
  MarketplaceFiles,
  {
    readonly currentProfile: (baseUrl: string) => Effect.Effect<MarketplaceProfile, MarketplaceProfileFailed>
    readonly bundlesOf: (dir: string) => Effect.Effect<readonly string[], MarketplaceProfileFailed>
    readonly dshCli: Effect.Effect<DshCliResolution, MarketplaceProfileFailed>
  }
>()('@dshfiles/plugin-marketplace/MarketplaceFiles') {
  static readonly makeLayer = (options: MarketplaceFilesOptions = {}) =>
    Layer.effect(
      MarketplaceFiles,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const readManifest = (dir: string) =>
          Effect.try({
            try: () => readProfileManifest(DSH_BIN_NAME, dir),
            catch: cause => new MarketplaceProfileFailed({ reason: 'unreadable-manifest', path: dir, cause }),
          })

        const currentProfile = Effect.fn('marketplace current profile')(function* (baseUrl: string) {
          const requested = fileUrlPath(baseUrl)
          if (requested === undefined) return yield* new MarketplaceProfileFailed({ reason: 'not-local' })
          const dir = yield* fs
            .realPath(requested)
            .pipe(Effect.mapError(cause => new MarketplaceProfileFailed({ reason: 'unreadable-manifest', path: requested, cause })))
          const name = path.basename(dir)
          if (name === '' || name === '.' || name === '..') return yield* new MarketplaceProfileFailed({ reason: 'not-the-profile', path: dir })
          const expected = yield* fs
            .realPath(resolveProfileDir(name, options.harnessHome))
            .pipe(Effect.mapError(cause => new MarketplaceProfileFailed({ reason: 'unreadable-manifest', path: dir, cause })))
          if (dir !== expected) return yield* new MarketplaceProfileFailed({ reason: 'not-the-profile', path: dir })
          const manifest = yield* readManifest(dir)
          const bundles = bundlesOfManifest(manifest)
          if (bundles.length === 0) return yield* new MarketplaceProfileFailed({ reason: 'no-bundles', path: dir })
          return { name, dir, manifest, bundles } satisfies MarketplaceProfile
        })

        const bundlesOf = Effect.fn('marketplace profile bundles')(function* (dir: string) {
          const manifest = yield* readManifest(dir)
          const bundles = bundlesOfManifest(manifest)
          if (bundles.length === 0) return yield* new MarketplaceProfileFailed({ reason: 'no-bundles', path: dir })
          return bundles
        })

        const dshCli = Effect.gen(function* () {
          const manifestPath = yield* Effect.try({
            try: () => createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'),
            catch: cause => new MarketplaceProfileFailed({ reason: 'unreadable-package', cause }),
          })
          const text = yield* fs
            .readFileString(manifestPath)
            .pipe(Effect.mapError(cause => new MarketplaceProfileFailed({ reason: 'unreadable-package', path: manifestPath, cause })))
          if (text.length > MAX_MANIFEST_BYTES) return yield* new MarketplaceProfileFailed({ reason: 'unreadable-package', path: manifestPath })
          const manifest = yield* Schema.decodeUnknownEffect(dshManifestSchema)(JSON.parse(text)).pipe(
            Effect.mapError(cause => new MarketplaceProfileFailed({ reason: 'unreadable-package', path: manifestPath, cause })),
          )
          const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.dsh
          if (bin === undefined || bin.length === 0) return yield* new MarketplaceProfileFailed({ reason: 'no-cli', path: manifestPath })
          return { cliPath: path.resolve(path.dirname(manifestPath), bin), version: manifest.version } satisfies DshCliResolution
        })

        return MarketplaceFiles.of({ currentProfile, bundlesOf, dshCli })
      }),
    )

  static readonly layer = MarketplaceFiles.makeLayer()

}
