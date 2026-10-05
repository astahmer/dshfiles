import { z } from 'zod'

export const sessionRuntimeSelectionSchema = z.object({
  driverKind: z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/),
  instanceId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
}).strict()

export const sessionRuntimeBindingSchema = sessionRuntimeSelectionSchema

export type SessionRuntimeBinding = z.infer<typeof sessionRuntimeBindingSchema>
export type SessionRuntimeSelection = z.infer<typeof sessionRuntimeSelectionSchema>
