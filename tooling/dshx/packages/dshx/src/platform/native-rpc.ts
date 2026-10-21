import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(256)
const sessionRequest = <Schema extends z.ZodType>(schema: Schema) => z.object({ request: schema }).strict()
const sessionAddressSchema = z.object({ kind: z.literal('session'), sessionId: sessionIdSchema }).strict()

export const nativeRpcRequestSchema = z.union([
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('list'),
      args: z
        .object({
          _request: z
            .object({ projections: z.array(z.string()).optional() })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ namespace: z.literal('session'), method: z.literal('search'), args: sessionRequest(z.object({ query: z.string().max(4000) }).strict()) }).strict(),
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('create'),
      args: sessionRequest(z.object({ cwd: z.string().max(4096).optional(), agentPreset: z.string().max(128).optional() }).strict()),
    })
    .strict(),
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('fork'),
      args: sessionRequest(z.object({ sessionId: sessionIdSchema, atSeq: z.number().int().safe().nonnegative().optional() }).strict()),
    })
    .strict(),
  z.object({ namespace: z.literal('session'), method: z.literal('cancel'), args: sessionRequest(z.object({ sessionId: sessionIdSchema }).strict()) }).strict(),
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('rename'),
      args: sessionRequest(z.object({ sessionId: sessionIdSchema, title: z.string().max(512) }).strict()),
    })
    .strict(),
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('prompt'),
      args: sessionRequest(
        z
          .object({
            requestId: z.string().uuid(),
            sessionId: sessionIdSchema,
            mode: z.enum(['queue', 'steer']),
            content: z
              .array(z.object({ type: z.literal('text'), text: z.string().max(100_000) }).strict())
              .min(1)
              .max(64),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      namespace: z.literal('session'),
      method: z.literal('page'),
      args: sessionRequest(
        z
          .object({
            address: sessionAddressSchema,
            throughSeq: z.number().int().safe().min(-1),
            beforeSeq: z.number().int().safe().min(-1).optional(),
            maxMessages: z.number().int().min(1).max(1000).optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({ namespace: z.literal('workspace'), method: z.literal('archiveSession'), args: sessionRequest(z.object({ sessionId: sessionIdSchema }).strict()) })
    .strict(),
  z
    .object({
      namespace: z.literal('workspace'),
      method: z.literal('unarchiveSession'),
      args: sessionRequest(z.object({ sessionId: sessionIdSchema }).strict()),
    })
    .strict(),
])

export type NativeRpcRequest = z.infer<typeof nativeRpcRequestSchema>
