import type { ActivityIngest, ActivityLevel, ActivityReference, BacklogActivityInput, VerificationReceiptSummary } from './types.js'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

export class ActivityTimelineAdapters {
  static sessionActivity = (input: {
    readonly kind: 'created' | 'disposed' | 'status' | 'error' | 'input'
    readonly at: number
    readonly sessionId: string
    readonly status?: string
    readonly detail?: string
    readonly correlationId?: string
  }): ActivityIngest => {
    const base = { at: input.at, source: 'session' as const, sessionId: input.sessionId, provenance: 'observed' as const }
    const reference: ActivityReference = { kind: 'session', id: input.sessionId, label: null }
    if (input.kind === 'created')
      return {
        ...base,
        id: `session:created:${input.sessionId}:${String(input.at)}`,
        type: 'session.started',
        level: 'notable',
        summary: 'Agent started work',
        references: [reference],
      }
    if (input.kind === 'disposed')
      return {
        ...base,
        id: `session:disposed:${input.sessionId}:${String(input.at)}`,
        type: 'session.disposed',
        level: 'notable',
        summary: 'Agent session disposed',
        references: [reference],
      }
    if (input.kind === 'status')
      return {
        ...base,
        id: `session:status:${input.sessionId}:${String(input.at)}`,
        type: 'session.status',
        level: 'routine',
        summary: `Agent became ${input.status ?? 'unknown'}`,
        metadata: { status: input.status ?? null },
        references: [reference],
      }
    if (input.kind === 'input')
      return {
        ...base,
        id: `session:input:${input.sessionId}:${String(input.at)}`,
        type: 'session.input',
        level: 'notable',
        summary: 'Input delivered to an agent',
        detail: input.detail === undefined ? null : clamp(input.detail, 2000),
        references: [reference],
      }
    return {
      ...base,
      id: `session:error:${input.sessionId}:${String(input.at)}`,
      type: 'session.error',
      level: 'attention',
      summary: 'Agent reported an error',
      detail: input.detail === undefined ? null : clamp(input.detail, 2000),
      references: [reference],
    }
  }

  static communicationActivity = (input: {
    readonly at: number
    readonly sessionId: string | null
    readonly operation: string
    readonly outcome: 'success' | 'failure'
    readonly callId: string
    readonly rootCallId: string | null
    readonly correlationId?: string
    readonly errorCode?: string | null
  }): ActivityIngest => ({
    id: `communication:activity:${input.callId}`,
    at: input.at,
    source: 'communication',
    type: 'communication.activity',
    level: input.outcome === 'failure' ? 'attention' : 'routine',
    sessionId: input.sessionId,
    correlationId: input.correlationId ?? null,
    causationId: input.rootCallId,
    summary: `${input.operation} ${input.outcome === 'failure' ? 'failed' : 'succeeded'}`,
    detail: input.errorCode === undefined || input.errorCode === null ? null : `error: ${input.errorCode}`,
    metadata: { operation: input.operation, outcome: input.outcome, callId: input.callId },
    references: input.sessionId === null ? [] : [{ kind: 'session', id: input.sessionId, label: null }],
    provenance: 'observed',
  })

  static communicationMessage = (input: {
    readonly at: number
    readonly messageId: string
    readonly senderId: string
    readonly recipientCount: number
    readonly intent: 'notice' | 'request'
    readonly topic: string | null
    readonly correlationId?: string | undefined
    readonly sessionId?: string | null | undefined
  }): ActivityIngest => ({
    id: `communication:message:${input.messageId}`,
    at: input.at,
    source: 'communication',
    type: 'communication.message',
    level: input.intent === 'request' ? 'notable' : 'routine',
    sessionId: input.sessionId ?? null,
    correlationId: input.correlationId ?? null,
    summary:
      input.topic === null
        ? `Direct message from ${input.senderId} to ${String(input.recipientCount)} agent(s)`
        : `Message from ${input.senderId} on ${input.topic}`,
    metadata: { intent: input.intent, topic: input.topic, recipientCount: input.recipientCount, senderId: input.senderId },
    references: [{ kind: 'message', id: input.messageId, label: input.topic }],
    provenance: 'observed',
  })

  static integrationActivity = (input: {
    readonly id: string
    readonly at: number
    readonly type: string
    readonly workspaceId: string | null
    readonly sessionId: string | null
    readonly candidateId: string | null
    readonly correlationId: string | null
    readonly detail: string | null
    readonly outcome: string | null
  }): ActivityIngest => {
    const level: ActivityLevel =
      input.type === 'integration.blocked' ||
      input.type === 'integration.validation_failed' ||
      input.type === 'integration.failed' ||
      input.type === 'workspace.missing'
        ? 'attention'
        : input.type === 'integration.queued' || input.type === 'integration.started'
          ? 'notable'
          : 'routine'
    const references: ActivityReference[] = []
    if (input.candidateId !== null) references.push({ kind: 'integration-candidate', id: input.candidateId, label: null })
    if (input.workspaceId !== null) references.push({ kind: 'workspace', id: input.workspaceId, label: null })
    return {
      id: `integration:${input.id}`,
      at: input.at,
      source: 'integration',
      type: input.type,
      level,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      correlationId: input.correlationId,
      summary: input.detail ?? input.outcome ?? input.type,
      detail: input.detail,
      metadata: { outcome: input.outcome },
      references,
      provenance: 'observed',
    }
  }

  /**
   * Backlog item changes reported by `@dshfiles/backlog` (moves, links, comments, requests for input). The backlog keeps
   * the item's full history; the timeline gets one event per change so the shared activity room shows backlog work.
   */
  static backlogActivity = (input: BacklogActivityInput): ActivityIngest => {
    const references: ActivityReference[] = []
    if (input.sessionId !== null) references.push({ kind: 'session', id: input.sessionId, label: null })
    if (input.revision !== null) references.push({ kind: 'revision', id: input.revision, label: null })
    return {
      id: input.id,
      at: input.at,
      source: 'system',
      type: input.type,
      level: input.level,
      summary: input.summary,
      detail: input.detail,
      sessionId: input.sessionId,
      metadata: { itemId: input.itemId },
      references,
      provenance: 'reported',
    }
  }

  static workspaceActivity = (input: {
    readonly id: string
    readonly at: number
    readonly type:
      | 'workspace.provisioned'
      | 'workspace.provision_refused'
      | 'workspace.writer_acquired'
      | 'workspace.writer_reclaimed'
      | 'workspace.writer_released'
      | 'workspace.writer_transferred'
      | 'workspace.writer_fenced'
      | 'workspace.observer_added'
      | 'workspace.observer_removed'
      | 'workspace.quarantined'
      | 'workspace.refused'
    readonly level: ActivityLevel
    readonly summary: string
    readonly detail: string | null
    readonly sessionId: string | null
    readonly workspaceId: string | null
    readonly workspaceName: string | null
  }): ActivityIngest => {
    const references: ActivityReference[] = []
    if (input.sessionId !== null) references.push({ kind: 'session', id: input.sessionId, label: null })
    if (input.workspaceId !== null) references.push({ kind: 'workspace', id: input.workspaceId, label: input.workspaceName })
    return {
      id: input.id,
      at: input.at,
      source: 'workspace',
      type: input.type,
      level: input.level,
      sessionId: input.sessionId,
      summary: clamp(input.summary, 200),
      detail: input.detail === null ? null : clamp(input.detail, 2000),
      metadata: { workspaceId: input.workspaceId, workspaceName: input.workspaceName },
      references,
      provenance: 'observed',
    }
  }
}

export const verificationReceiptActivity = (receipt: VerificationReceiptSummary): ActivityIngest => {
  const statusLabel = receipt.status === 'timed-out' ? 'timed out' : receipt.status
  const modeLabel = receipt.automatic ? `automatic · attempt ${receipt.attempt} · verification turn ${receipt.verificationTurn ?? 'unknown'}` : 'manual'
  const revisionLabel = (revision: string | null): string => (revision === null ? 'unavailable' : revision)
  const level: ActivityLevel =
    receipt.status === 'failed' || receipt.status === 'timed-out' ? 'attention' : receipt.status === 'cancelled' ? 'notable' : 'routine'

  return {
    id: `verification:${receipt.receiptId}`,
    at: receipt.finishedAt,
    source: 'integration',
    type: `verification.${receipt.status}`,
    level,
    sessionId: receipt.sessionId,
    correlationId: receipt.receiptId,
    summary: `${receipt.label} ${statusLabel} · ${modeLabel} · ${receipt.durationMs} ms`,
    detail: `Recorded source revision before ${revisionLabel(receipt.sourceRevisionBefore)} and after ${revisionLabel(receipt.sourceRevisionAfter)}. Current source freshness is not asserted here; action-configuration equivalence is unknown. This bounded Project Checks receipt may have expired, so this Activity item is only a historical summary. Open the Session and Project Checks for current freshness.`,
    metadata: {
      receiptId: receipt.receiptId,
      actionId: receipt.actionId,
      status: receipt.status,
      failure: receipt.failure,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      durationMs: receipt.durationMs,
      exitCode: receipt.exitCode,
      automatic: receipt.automatic,
      verificationTurn: receipt.verificationTurn,
      attempt: receipt.attempt,
      sourceRevisionBefore: receipt.sourceRevisionBefore,
      sourceRevisionAfter: receipt.sourceRevisionAfter,
      configurationFreshness: 'unknown',
    },
    references: [{ kind: 'session', id: receipt.sessionId, label: null }],
    provenance: 'observed',
  }
}
export const communicationActivity = ActivityTimelineAdapters.communicationActivity
export const communicationMessage = ActivityTimelineAdapters.communicationMessage
export const integrationActivity = ActivityTimelineAdapters.integrationActivity
export const sessionActivity = ActivityTimelineAdapters.sessionActivity
export const workspaceActivity = ActivityTimelineAdapters.workspaceActivity
export const backlogActivity = ActivityTimelineAdapters.backlogActivity
