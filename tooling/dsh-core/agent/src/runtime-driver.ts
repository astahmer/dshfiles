import { z } from 'zod'

export const runtimeDriverDescriptorSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(160),
  protocolVersion: z.literal(1),
  capabilities: z.object({
    create: z.boolean(),
    resume: z.boolean(),
    fork: z.boolean(),
    steering: z.boolean(),
    rollback: z.boolean(),
  }).strict(),
}).strict()

export type RuntimeDriverDescriptor = z.infer<typeof runtimeDriverDescriptorSchema>
