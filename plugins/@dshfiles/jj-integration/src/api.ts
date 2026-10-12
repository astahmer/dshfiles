import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import {
  integrationCandidateSchema,
  integrationEventSchema,
  repositoryRecordSchema,
  workspaceRecordSchema,
} from './types.js'

const candidateIdSchema = z.string().uuid()
const workspaceIdSchema = z.string().uuid()

export const candidateDetailSchema = z
  .object({
    candidate: integrationCandidateSchema,
    alreadyIntegrated: z.boolean(),
    sourceStale: z.boolean(),
    sourceMissing: z.boolean(),
    changedFiles: z.array(z.string().max(1024)).max(500),
    spineChangedFiles: z.array(z.string().max(1024)).max(500),
    overlappingFiles: z.array(z.string().max(1024)).max(500),
    dependencies: z.array(z.object({ id: z.string(), state: z.string() }).strict()).max(32),
  })
  .strict()
export type CandidateDetail = z.infer<typeof candidateDetailSchema>

export const integrationOverviewSchema = z
  .object({
    spineBookmark: z.string().min(1).max(128),
    repositories: z.array(repositoryRecordSchema).max(64),
    workspaces: z.array(workspaceRecordSchema).max(256),
    candidates: z.array(integrationCandidateSchema).max(512),
    counts: z
      .object({
        queued: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        integrated: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type IntegrationOverview = z.infer<typeof integrationOverviewSchema>

export const integrationRunReceiptSchema = z
  .object({
    outcome: z.enum(['integrated', 'blocked', 'failed', 'already-integrated', 'stale']),
    candidateId: candidateIdSchema,
    detail: z.string().max(500),
  })
  .strict()
export type IntegrationRunReceipt = z.infer<typeof integrationRunReceiptSchema>

export const jjIntegrationApi = defineApi({
  id: 'jj-integration',
  version: 1,
  methods: {
    overview: method({ input: z.object({}).strict(), output: integrationOverviewSchema }),
    inspect: method({ input: z.object({ candidateId: candidateIdSchema }).strict(), output: candidateDetailSchema }),
    events: method({
      input: z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
      output: z.object({ events: z.array(integrationEventSchema).max(500) }).strict(),
    }),
    run: method({ input: z.object({ candidateId: candidateIdSchema }).strict(), output: integrationRunReceiptSchema }),
    retry: method({ input: z.object({ candidateId: candidateIdSchema }).strict(), output: integrationCandidateSchema }),
    cancel: method({ input: z.object({ candidateId: candidateIdSchema }).strict(), output: integrationCandidateSchema }),
    move: method({
      input: z.object({ candidateId: candidateIdSchema, direction: z.enum(['up', 'down']) }).strict(),
      output: integrationCandidateSchema,
    }),
    refreshWorkspace: method({ input: z.object({ workspaceId: workspaceIdSchema }).strict(), output: workspaceRecordSchema }),
    markReady: method({ input: z.object({ workspaceId: workspaceIdSchema }).strict(), output: workspaceRecordSchema }),
    submit: method({
      input: z.object({ workspaceId: workspaceIdSchema, sessionId: z.string().min(1).max(256).nullable() }).strict(),
      output: integrationCandidateSchema,
    }),
    acquireWriter: method({
      input: z.object({ workspaceId: workspaceIdSchema, sessionId: z.string().min(1).max(256) }).strict(),
      output: workspaceRecordSchema,
    }),
    releaseWriter: method({
      input: z.object({ workspaceId: workspaceIdSchema, sessionId: z.string().min(1).max(256) }).strict(),
      output: workspaceRecordSchema,
    }),
    transferWriter: method({
      input: z
        .object({ workspaceId: workspaceIdSchema, toSessionId: z.string().min(1).max(256), acknowledgeStopped: z.boolean() })
        .strict(),
      output: workspaceRecordSchema,
    }),
  },
})
