import { Schema } from 'effect'

/**
 * A Host that cannot read workspace activity in time queues the integration instead of refusing it; its RPC error
 * carries this code so a surface shows the queued state rather than a failure the person cannot act on.
 */
const QUEUED_INTEGRATION_CODE = 'integration-queued'

const remoteErrorSchema = Schema.Struct({ remoteCode: Schema.String })

export const IntegrationRecovery = {
  isQueued: (error: unknown): boolean => {
    try {
      return Schema.decodeUnknownSync(remoteErrorSchema)(error).remoteCode === QUEUED_INTEGRATION_CODE
    } catch {
      return false
    }
  },
  /**
   * A manual request the Host cannot verify queues itself instead of dead-ending. An Agent's own call and the queued
   * retry's attempt report back instead, so a stuck verification stays visible to both.
   */
  queuesInsteadOfRefusing: (input: { readonly fromAgent: boolean; readonly retrying: boolean }): boolean => !input.fromAgent && !input.retrying,
}
