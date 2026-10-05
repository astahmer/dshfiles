import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const pendingOperationSchema = z
  .object({
    id: z.string().uuid(),
    turn: z.number().int().positive(),
    step: z.number().int().positive(),
    startedAt: z.number().int().nonnegative(),
  })
  .strict()

export const cursorSessionRecordSchema = z.discriminatedUnion('state', [
  z
    .object({
      instanceId: z.string().min(1).max(64),
      state: z.literal('creating'),
      operationId: z.string().uuid(),
      startedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      instanceId: z.string().min(1).max(64),
      state: z.literal('ready'),
      nativeSessionId: z.string().min(1).max(512),
      pendingOperation: pendingOperationSchema.optional(),
    })
    .strict(),
])

export type CursorSessionRecord = z.infer<typeof cursorSessionRecordSchema>

export const cursorSessionDomain = defineDomain({
  name: 'cursor_agent_sessions',
  version: 1,
  tables: {
    sessions: {
      valueSchema: cursorSessionRecordSchema,
      __key: 'sessions',
    },
  },
})
