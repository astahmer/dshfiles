import type { ActivityIngest, ActivityLevel, ActivityReference } from './types.js'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

export const sessionActivity = (input: {
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

export const communicationActivity = (input: {
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

export const communicationMessage = (input: {
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

export const integrationActivity = (input: {
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

export const workspaceActivity = (input: {
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
