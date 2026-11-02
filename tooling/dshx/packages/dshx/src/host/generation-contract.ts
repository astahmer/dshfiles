import * as Schema from 'effect/Schema'

export const HOST_GENERATION_DIRECTORY = '.dshx-host-generations'
export const HOST_GENERATION_MANIFEST = '.dshx-host-manifest.json'

/** Generation ids become file names, so they stay inside one safe, flat segment. */
export const generationIdSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/u))

export const hostGenerationManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  generation: generationIdSchema,
  hostContractVersion: Schema.Trim.check(Schema.isMinLength(1)),
})

export type HostGenerationManifest = (typeof hostGenerationManifestSchema)['Type']
