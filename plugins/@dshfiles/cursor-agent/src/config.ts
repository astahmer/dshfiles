import { z } from 'zod'

const instanceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/)
const credentialRefSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

export const cursorInstanceSchema = z
  .object({
    id: instanceIdSchema,
    label: z.string().trim().min(1).max(120),
    credentialRef: credentialRefSchema,
    credentialKind: z.enum(['api-key', 'auth-token']),
  })
  .strict()

export const Config = z
  .object({
    instances: z.array(cursorInstanceSchema).max(32).default([]),
  })
  .strict()
  .superRefine((config, context) => {
    const seen = new Set<string>()
    config.instances.forEach((instance, index) => {
      if (seen.has(instance.id)) {
        context.addIssue({ code: 'custom', path: ['instances', index, 'id'], message: 'Cursor instance ids must be unique.' })
      }
      seen.add(instance.id)
    })
  })

export type CursorInstanceConfig = z.infer<typeof cursorInstanceSchema>
export type CursorAgentConfig = z.infer<typeof Config>

export const cursorCredentialEnvironment = (kind: CursorInstanceConfig['credentialKind']): 'CURSOR_API_KEY' | 'CURSOR_AUTH_TOKEN' =>
  kind === 'api-key' ? 'CURSOR_API_KEY' : 'CURSOR_AUTH_TOKEN'
