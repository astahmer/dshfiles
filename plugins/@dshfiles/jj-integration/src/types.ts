import { z } from 'zod'

export const jjRevisionSchema = z
  .object({
    changeId: z.string().min(1).max(64),
    commitId: z.string().regex(/^[0-9a-f]{40,64}$/),
    description: z.string().max(200),
  })
  .strict()
export type JjRevision = z.infer<typeof jjRevisionSchema>

export const workspaceLifecycleSchema = z.enum([
  'created',
  'active',
  'idle',
  'ready',
  'integrating',
  'integrated',
  'blocked',
  'abandoned',
  'archived',
])
export type WorkspaceLifecycle = z.infer<typeof workspaceLifecycleSchema>

export const candidateStateSchema = z.enum([
  'queued',
  'running',
  'blocked',
  'failed',
  'integrated',
  'cancelled',
  'stale',
  'already-integrated',
])
export type CandidateState = z.infer<typeof candidateStateSchema>

export const writerLeaseSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    /** Monotonic per-workspace writer generation; every transfer and reclaim advances it. */
    epoch: z.number().int().positive(),
    acquiredAt: z.number().int().nonnegative(),
    /** Refreshed while the writer works; a lease this quiet is reclaimable. */
    heartbeatAt: z.number().int().nonnegative(),
    host: z.string().min(1).max(256).nullable(),
  })
  .strict()
export type WriterLease = z.infer<typeof writerLeaseSchema>

export const workspaceObserverSchema = z
  .object({ sessionId: z.string().min(1).max(256), since: z.number().int().nonnegative() })
  .strict()
export type WorkspaceObserver = z.infer<typeof workspaceObserverSchema>

export const integrationEventTypeSchema = z.enum([
  'workspace.created',
  'workspace.attached',
  'workspace.detached',
  'workspace.refreshed',
  'workspace.ready',
  'workspace.missing',
  'workspace.writer_acquired',
  'workspace.writer_reclaimed',
  'workspace.writer_released',
  'workspace.writer_transferred',
  'workspace.writer_fenced',
  'workspace.observer_added',
  'workspace.observer_removed',
  'integration.queued',
  'integration.started',
  'integration.blocked',
  'integration.validation_failed',
  'integration.completed',
  'integration.already_integrated',
  'integration.stale',
  'integration.cancelled',
  'integration.failed',
  'integration.staging_reaped',
])
export type IntegrationEventType = z.infer<typeof integrationEventTypeSchema>

export const workspaceOwnerSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    attachedAt: z.number().int().nonnegative(),
    detachedAt: z.number().int().nonnegative().nullable(),
    source: z.enum(['session-cwd', 'agent-tool', 'human']),
  })
  .strict()
export type WorkspaceOwner = z.infer<typeof workspaceOwnerSchema>

export const workspaceRecordSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    name: z.string().min(1).max(128),
    path: z.string().min(1).max(2048),
    lifecycle: workspaceLifecycleSchema,
    currentRevision: jjRevisionSchema.nullable(),
    owners: z.array(workspaceOwnerSchema).max(64),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastObservedAt: z.number().int().nonnegative().nullable(),
    missing: z.boolean(),
    notes: z.string().max(500).nullable(),
    /**
     * True only for workspaces this plugin provisioned for one coding thread.
     * Ownership is enforced for these; workspaces merely discovered from a
     * Session cwd stay unenforced, so existing sessions are never migrated.
     */
    isolated: z.boolean().default(false),
    writerEpoch: z.number().int().nonnegative().default(0),
    writerLease: writerLeaseSchema.nullable().default(null),
    observers: z.array(workspaceObserverSchema).max(64).default([]),
  })
  .strict()
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>

export const conflictRecordSchema = z
  .object({
    files: z.array(z.string().max(1024)).max(200),
    detectedAt: z.number().int().nonnegative(),
    note: z.string().max(500),
  })
  .strict()
export type ConflictRecord = z.infer<typeof conflictRecordSchema>

export const validationRecordSchema = z
  .object({
    kind: z.enum(['none', 'command']),
    revision: jjRevisionSchema.nullable(),
    command: z.string().max(500).nullable(),
    exitCode: z.number().int().nullable(),
    outputExcerpt: z.string().max(2000),
    ranAt: z.number().int().nonnegative().nullable(),
  })
  .strict()
export type ValidationRecord = z.infer<typeof validationRecordSchema>

export const integrationAttemptSchema = z
  .object({
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    outcome: z.enum(['running', 'integrated', 'blocked', 'failed', 'already-integrated', 'stale']),
    spineBefore: jjRevisionSchema.nullable(),
    spineAfter: jjRevisionSchema.nullable(),
    resultRevision: jjRevisionSchema.nullable(),
    duplicateAbandoned: z.boolean().nullable().default(null),
    leakedRevision: jjRevisionSchema.nullable().default(null),
    conflicts: conflictRecordSchema.nullable(),
    validation: validationRecordSchema,
    error: z.string().max(500).nullable(),
  })
  .strict()
export type IntegrationAttempt = z.infer<typeof integrationAttemptSchema>

export const integrationCandidateSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceSessionId: z.string().min(1).max(256).nullable(),
    sourceRevision: jjRevisionSchema,
    spineAtSubmit: jjRevisionSchema.nullable(),
    dependsOn: z.array(z.string().uuid()).max(32),
    state: candidateStateSchema,
    correlationId: z.string().min(1).max(128).nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    attempts: z.array(integrationAttemptSchema).max(20),
    resultRevision: jjRevisionSchema.nullable(),
    conflict: conflictRecordSchema.nullable(),
    validation: validationRecordSchema,
    error: z.string().max(500).nullable(),
    queuePosition: z.number().int().nonnegative(),
  })
  .strict()
export type IntegrationCandidate = z.infer<typeof integrationCandidateSchema>

export const repositoryRecordSchema = z
  .object({
    id: z.string().uuid(),
    root: z.string().min(1).max(2048),
    spineBookmark: z.string().min(1).max(128),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export type RepositoryRecord = z.infer<typeof repositoryRecordSchema>

export const integrationEventSchema = z
  .object({
    id: z.string().uuid(),
    type: integrationEventTypeSchema,
    at: z.number().int().nonnegative(),
    repositoryId: z.string().uuid().nullable(),
    workspaceId: z.string().uuid().nullable(),
    sessionId: z.string().min(1).max(256).nullable(),
    candidateId: z.string().uuid().nullable(),
    correlationId: z.string().min(1).max(128).nullable(),
    revisions: z
      .object({
        source: jjRevisionSchema.nullable(),
        spineBefore: jjRevisionSchema.nullable(),
        spineAfter: jjRevisionSchema.nullable(),
        result: jjRevisionSchema.nullable(),
      })
      .strict(),
    outcome: z.string().max(200).nullable(),
    detail: z.string().max(500).nullable(),
  })
  .strict()
export type IntegrationEvent = z.infer<typeof integrationEventSchema>

export const jjIntegrationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    repositories: z.array(repositoryRecordSchema).max(64),
    workspaces: z.array(workspaceRecordSchema).max(256),
    candidates: z.array(integrationCandidateSchema).max(512),
    events: z.array(integrationEventSchema).max(2000),
  })
  .strict()
export type JjIntegrationState = z.infer<typeof jjIntegrationStateSchema>

export const noneValidation = (): ValidationRecord => ({ kind: 'none', revision: null, command: null, exitCode: null, outputExcerpt: '', ranAt: null })

export const integrationLockSchema = z
  .object({
    pid: z.number().int().positive(),
    startedAt: z.number().int().nonnegative(),
    token: z.string().min(1).max(128).optional(),
  })
  .strict()
export type IntegrationLock = z.infer<typeof integrationLockSchema>

export const stagingJournalEntrySchema = z
  .object({
    name: z.string().min(1).max(128),
    path: z.string().min(1).max(2048),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
export type StagingJournalEntry = z.infer<typeof stagingJournalEntrySchema>

export const stagingJournalSchema = z.array(stagingJournalEntrySchema).max(64)
