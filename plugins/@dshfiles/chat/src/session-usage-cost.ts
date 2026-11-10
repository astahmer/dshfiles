import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'

/** Token buckets the session usage dialog lists, in its row order. */
export type SessionUsageBucket = 'input' | 'cacheRead' | 'cacheWrite' | 'output'

/** Where the composer's usage pill asks for a cost: after its label, or beside one bucket row of its dialog. */
export type SessionUsageCostPlacement = 'pill' | SessionUsageBucket

/** Pricing projection and placement offered to the composer's session usage pill. */
export interface SessionUsageCostOwnerProps {
  readonly placement: SessionUsageCostPlacement
  readonly useProjection: UseProjection
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional estimated cost inside the composer's usage pill and beside each bucket of its dialog. */
    'conversation.composer.usageCost': { kind: 'list'; scope: 'session'; owner: SessionUsageCostOwnerProps }
  }
}
