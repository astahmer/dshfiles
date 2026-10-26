import { z } from 'zod'

export const networkFormSchema = z
  .object({
    lanEnabled: z.boolean(),
    bindAddress: z.string().nullable(),
    // Compatibility with a still-running old Host; desired localhost is always on.
    localhostEnabled: z
      .boolean()
      .default(true)
      .transform(() => true as const),
    port: z.number().int().min(0).max(65535),
  })
  .strict()

export type NetworkForm = z.infer<typeof networkFormSchema>

export const networkSaveSchema = networkFormSchema.extend({
  localhostEnabled: z.literal(true).default(true),
  expectedRevision: z.number().int().nonnegative(),
})

export const networkSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  writable: z.boolean(),
  saved: networkFormSchema,
  active: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    localhostEnabled: z.boolean(),
    urls: z.array(z.string()),
  }),
  addresses: z.array(
    z.object({
      address: z.string(),
      interfaceName: z.string(),
      family: z.enum(['IPv4', 'IPv6']),
    }),
  ),
  cliOverrides: z.object({ host: z.string().nullable(), port: z.number().int().min(0).max(65535).nullable() }),
  pendingRestart: z.boolean(),
  integration: z.enum(['managed', 'needs-setup', 'unsupported']),
  unavailableReason: z.string().nullable(),
})

export type NetworkSnapshot = z.infer<typeof networkSnapshotSchema>
