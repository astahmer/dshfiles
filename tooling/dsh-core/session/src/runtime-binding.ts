import { z } from 'zod'

const opaqueIdentifier = z.string().min(1).max(512).refine(
  value => !/[\u0000-\u001f\u007f]/u.test(value),
)

export const sessionRuntimeBindingSchema = z.object({
  driverKind: z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/),
  instanceId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  nativeSessionId: opaqueIdentifier.optional(),
}).strict()

export type SessionRuntimeBinding = z.infer<typeof sessionRuntimeBindingSchema>
export type SessionRuntimeSelection = Pick<SessionRuntimeBinding, 'driverKind' | 'instanceId'>
