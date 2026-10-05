import { z } from 'zod'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from './types.ts'

export const runtimeDriverDescriptorSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(160),
  protocolVersion: z.literal(1),
  capabilities: z.object({
    create: z.boolean(),
    resume: z.boolean(),
    fork: z.boolean(),
    historyReplay: z.boolean().default(false),
    steering: z.boolean(),
    rollback: z.boolean(),
  }).strict(),
}).strict()

export type RuntimeDriverDescriptor = z.infer<typeof runtimeDriverDescriptorSchema>

export const runtimeDriverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), text: z.string().max(32_768) }).strict(),
  z.object({
    type: z.literal('activity'),
    id: z.string().min(1).max(100),
    category: z.enum(['reasoning', 'tool', 'file', 'terminal', 'search', 'other']),
    state: z.enum(['started', 'updated', 'completed', 'failed']),
  }).strict(),
])

export const runtimeDriverStatusSchema = z.object({
  availability: z.enum(['available', 'unavailable', 'unknown']),
  authentication: z.enum(['authenticated', 'missing', 'unknown']),
  identity: z.string().min(1).max(160).optional(),
  reason: z.enum(['executable-missing', 'authentication-missing', 'probe-failed']).optional(),
}).strict()

export type RuntimeDriverApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface RuntimeDriverPermissionRequest {
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal: AbortSignal
}

export type RuntimeDriverEvent = z.infer<typeof runtimeDriverEventSchema>

export interface RuntimeDriverHistoryMessage {
  readonly seq: number
  readonly speaker: 'user' | 'assistant'
  readonly parts: readonly string[]
}

export interface RuntimeDriverHistoryOmission {
  readonly fromSeq: number
  readonly throughSeq: number
  readonly reason: 'agent-context' | 'attachment' | 'private-content' | 'tool-state' | 'history-budget'
  readonly count: number
}

export interface RuntimeDriverHistory {
  readonly throughSeq: number
  readonly messages: readonly RuntimeDriverHistoryMessage[]
  readonly omissions: readonly RuntimeDriverHistoryOmission[]
  readonly omittedCount: number
  readonly omissionIndexComplete: boolean
}

export interface RuntimeDriverOpenRequest {
  readonly agent: Agent
  readonly session: Session
  readonly instanceId: string
  /** Safe, bounded prior conversation only when the adapter opted into replay. */
  readonly history?: RuntimeDriverHistory
  readonly signal: AbortSignal
  readonly requestPermission: (request: RuntimeDriverPermissionRequest) => Promise<RuntimeDriverApprovalOutcome>
}

export interface RuntimeDriverPromptRequest {
  readonly messages: readonly UserMessage[]
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

export const runtimeDriverPromptResultSchema = z.object({
  outcome: z.enum(['completed', 'max-tokens']),
}).strict()

export type RuntimeDriverPromptResult = z.infer<typeof runtimeDriverPromptResultSchema>

export interface RuntimeDriverSession {
  prompt(
    request: RuntimeDriverPromptRequest,
    publish: (event: RuntimeDriverEvent) => void,
  ): Promise<RuntimeDriverPromptResult>
  /** Acknowledge provider progress only after DSH durably settles this step. */
  acknowledgePrompt(): Promise<void>
  cancel(): void | Promise<void>
  dispose(): Promise<void>
}

export type RuntimeDriverStatus = z.infer<typeof runtimeDriverStatusSchema>

export interface RuntimeDriverStatusRequest {
  readonly instanceId: string
  readonly signal?: AbortSignal
}

export interface RuntimeDriverAdapter {
  readonly descriptor: RuntimeDriverDescriptor
  create(request: RuntimeDriverOpenRequest): Promise<RuntimeDriverSession>
  resume(request: RuntimeDriverOpenRequest): Promise<RuntimeDriverSession>
  status(request: RuntimeDriverStatusRequest): Promise<RuntimeDriverStatus>
}
