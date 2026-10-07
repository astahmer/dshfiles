import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import { z } from 'zod'
import { CURSOR_AGENT_DRIVER_KIND } from './constants.js'
import type { CursorRecoveryReceipt } from './cursor-session-store.js'

const targetSessionIdSchema = z.string().min(1).max(256)

const inputSchema = z.union([
  z.tuple([z.literal('list')]),
  z.tuple([z.literal('status'), targetSessionIdSchema]),
  z.tuple([z.literal('confirm'), targetSessionIdSchema, z.string().uuid(), z.literal('verified')]),
])

export interface CursorRecoveryOperations {
  recoveryReceipt(sessionId: string, instanceId?: string): Promise<CursorRecoveryReceipt | undefined>
  recoveryReceipts(): Promise<readonly CursorRecoveryReceipt[]>
  reconcilePrompt(sessionId: string, operationId: string, instanceId?: string): Promise<void>
}

export type CursorRecoveryTarget =
  | {
      readonly kind: 'agent'
      readonly sessionId: string
      readonly runtimeBinding: Agent['session']['header']['runtimeBinding']
      readonly runMaintenance: Agent['runMaintenance']
    }
  | { readonly kind: 'initializing' }
  | { readonly kind: 'absent' }

export interface CursorRecoveryInput {
  readonly sourceSessionId: string
  readonly rawInput: string
  readonly commandSignal: AbortSignal
  readonly sourceMaintenanceSignal: AbortSignal
  readonly flushSourceSession: () => Promise<boolean>
  readonly resolveTarget: (sessionId: string) => CursorRecoveryTarget
}

const receiptLine = (receipt: CursorRecoveryReceipt): string =>
  receipt.kind === 'creation'
    ? `Session ${receipt.sessionId} (instance ${receipt.instanceId}), uncertain provider-session creation, receipt ${receipt.operationId}`
    : `Session ${receipt.sessionId} (instance ${receipt.instanceId}), turn ${receipt.operation.turn}, step ${receipt.operation.step}, receipt ${receipt.operation.id}`

const listRecoveryReceipts = async (operations: CursorRecoveryOperations): Promise<CommandResult> => {
  const receipts = [...(await operations.recoveryReceipts())].sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  if (receipts.length === 0) return { kind: 'success', text: 'No unsettled Cursor runtime receipts exist.' }

  const visible = receipts.slice(0, 20)
  const remaining = receipts.length - visible.length
  return {
    kind: 'success',
    text: [
      ...visible.map(receiptLine),
      ...(remaining === 0 ? [] : [`Showing 20 of ${receipts.length} receipts.`]),
      'Inspect Cursor and each workspace before confirming a receipt.',
    ].join('\n'),
  }
}

export const executeCursorRecoveryCommand = async (input: CursorRecoveryInput, operations: CursorRecoveryOperations): Promise<CommandResult> => {
  const parsed = inputSchema.safeParse(input.rawInput.trim().split(/\s+/))
  if (!parsed.success) {
    return {
      kind: 'error',
      text: 'Usage: /cursor-reconcile list | status <session-id> | confirm <session-id> <operation-id> verified. Check Cursor and the workspace before confirming.',
    }
  }

  if (parsed.data[0] === 'list') return listRecoveryReceipts(operations)

  const targetSessionId = parsed.data[1]
  const isConfirmation = parsed.data[0] === 'confirm'
  const operationId = isConfirmation ? parsed.data[2] : undefined
  const target = input.resolveTarget(targetSessionId)
  if (target.kind === 'initializing') {
    return { kind: 'error', text: 'The target Session is still being initialized or restored. Wait until setup settles before reconciling it.' }
  }

  const targetAgent = target.kind === 'agent' ? target : undefined
  if (targetAgent !== undefined && targetAgent.sessionId !== targetSessionId) {
    return { kind: 'error', text: 'The live Agent identity did not match the requested Session.' }
  }

  const runtimeBinding = targetAgent?.runtimeBinding
  if (targetAgent !== undefined && runtimeBinding?.driverKind !== CURSOR_AGENT_DRIVER_KIND) {
    return { kind: 'error', text: 'The target Session is not bound to the Cursor Agent runtime.' }
  }
  const instanceId = runtimeBinding?.instanceId

  const executeForTarget = async (targetMaintenanceSignal?: AbortSignal): Promise<CommandResult> => {
    const assertActive = (): void => {
      input.commandSignal.throwIfAborted()
      input.sourceMaintenanceSignal.throwIfAborted()
      targetMaintenanceSignal?.throwIfAborted()
    }

    assertActive()
    const receipt = await operations.recoveryReceipt(targetSessionId, instanceId)
    if (receipt === undefined) {
      return isConfirmation
        ? { kind: 'error', text: 'No unsettled Cursor runtime receipt exists for the target Session.' }
        : { kind: 'success', text: 'No unsettled Cursor runtime receipt exists for the target Session.' }
    }

    if (receipt.kind === 'creation') {
      return isConfirmation
        ? {
            kind: 'error',
            text: 'This Cursor provider-session creation outcome cannot be confirmed safely because its native session id is unavailable. Leave the receipt unchanged and create a new Cursor-bound Session to continue.',
          }
        : {
            kind: 'success',
            text: `${receiptLine(receipt)}. Its native session id is unavailable, so this Session cannot resume safely; create a new Cursor-bound Session to continue. The receipt remains unchanged.`,
          }
    }

    if (!isConfirmation) {
      return {
        kind: 'success',
        text: `${receiptLine(receipt)}. Inspect Cursor and the workspace, and wait for provider work to settle before confirming.`,
      }
    }

    if (receipt.operation.id !== operationId) {
      return { kind: 'error', text: 'The operation id does not match the target Session’s current Cursor prompt receipt.' }
    }

    assertActive()
    let flushed: boolean
    try {
      flushed = await input.flushSourceSession()
    } catch {
      return { kind: 'error', text: 'The confirmation could not be persisted in the invoking Session; the Cursor receipt was not changed.' }
    }
    assertActive()
    if (!flushed) {
      return { kind: 'error', text: 'The confirmation was not flushed to durable Session history; the Cursor receipt was not changed.' }
    }

    await operations.reconcilePrompt(targetSessionId, receipt.operation.id, instanceId)
    return {
      kind: 'success',
      text: 'Your confirmation is durably recorded in the invoking Session and the exact Cursor receipt is cleared. The prior prompt was not replayed; later resume reuses the existing Cursor Session.',
    }
  }

  if (targetAgent === undefined || targetAgent.sessionId === input.sourceSessionId) {
    return executeForTarget()
  }

  let targetMaintenance: Promise<CommandResult>
  try {
    targetMaintenance = targetAgent.runMaintenance(executeForTarget)
  } catch {
    return { kind: 'error', text: 'The target Session is busy. Its Cursor receipt was not changed; retry after it becomes idle.' }
  }
  return targetMaintenance
}

export const createCursorRecoveryCommand = (operations: CursorRecoveryOperations): CommandDefinition => ({
  name: 'cursor-reconcile',
  description: 'Inspect or confirm an uncertain Cursor prompt after checking the provider and workspace state.',
  input: { hint: 'list | status <session-id> | confirm <session-id> <operation-id> verified' },
  recordInput: true,
  handler: ({ agent, rawInput, signal }) =>
    agent.runMaintenance(async sourceMaintenanceSignal => {
      signal.throwIfAborted()
      sourceMaintenanceSignal.throwIfAborted()
      return executeCursorRecoveryCommand(
        {
          sourceSessionId: agent.session.id,
          rawInput,
          commandSignal: signal,
          sourceMaintenanceSignal,
          flushSourceSession: () => agent.ctx.sessions.flush(agent.session),
          resolveTarget: sessionId => {
            const targetAgent = agent.ctx.agents.list().find(candidate => candidate.session.id === sessionId)
            if (targetAgent !== undefined) {
              return {
                kind: 'agent',
                sessionId: targetAgent.session.id,
                runtimeBinding: targetAgent.session.header.runtimeBinding,
                runMaintenance: job => targetAgent.runMaintenance(job),
              }
            }
            if (agent.ctx.sessions.list().some(session => session.id === sessionId)) return { kind: 'initializing' }
            return { kind: 'absent' }
          },
        },
        operations,
      )
    }),
})
