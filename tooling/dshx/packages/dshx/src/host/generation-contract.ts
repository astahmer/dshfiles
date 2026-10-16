import { z } from 'zod'

export const HOST_GENERATION_DIRECTORY = '.dshx-host-generations'
export const HOST_GENERATION_MANIFEST = '.dshx-host-manifest.json'

/** Generation ids become file names, so they stay inside one safe, flat segment. */
export const generationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)

export const hostGenerationManifestSchema = z
  .object({
    version: z.literal(1),
    generation: generationIdSchema,
    hostContractVersion: z.string().trim().min(1),
  })
  .strict()

export type HostGenerationManifest = z.infer<typeof hostGenerationManifestSchema>
