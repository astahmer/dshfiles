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
export type ReadyCursorSessionRecord = Extract<CursorSessionRecord, { state: 'ready' }>

export const cursorSessionRecordForResume = (record: CursorSessionRecord | undefined, instanceId: string): ReadyCursorSessionRecord => {
  if (record === undefined) throw new Error('Cursor provider session record is missing; refusing to create a replacement.')
  if (record.instanceId !== instanceId) throw new Error('Cursor provider session belongs to a different runtime instance.')
  if (record.state === 'creating') throw new Error('Cursor session creation outcome is uncertain; refusing to create a replacement.')
  if (record.pendingOperation !== undefined) throw new Error('Cursor prompt outcome is uncertain; refusing to replay possible workspace changes.')
  return record
}

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
