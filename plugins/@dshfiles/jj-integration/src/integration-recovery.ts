import { z } from 'zod'

/**
 * A Host that cannot read workspace activity in time queues the integration instead of refusing it; its RPC error
 * carries this code so a surface shows the queued state rather than a failure the person cannot act on.
 */
const QUEUED_INTEGRATION_CODE = 'integration-queued'

const remoteErrorSchema = z.object({ remoteCode: z.string() })

export const IntegrationRecovery = {
  isQueued: (error: unknown): boolean => {
    const parsed = remoteErrorSchema.safeParse(error)
    return parsed.success && parsed.data.remoteCode === QUEUED_INTEGRATION_CODE
  },
  /**
   * A manual request the Host cannot verify queues itself instead of dead-ending. An Agent's own call and the queued
   * retry's attempt report back instead, so a stuck verification stays visible to both.
   */
  queuesInsteadOfRefusing: (input: { readonly fromAgent: boolean; readonly retrying: boolean }): boolean => !input.fromAgent && !input.retrying,
}
